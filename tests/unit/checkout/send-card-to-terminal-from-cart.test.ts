// @vitest-environment node

// Unit test for `sendCardToTerminalFromCart` Server Action (Feature 042 /
// T018 / contracts § Action 3). Promotes the in-memory ephemeral cart
// into a brand-new open ticket + pending card payment in one sequenced
// flow, then hands off to a Square Terminal via `createCheckout`.
//
// Contract sequence:
//   1. Validate cart via `commitCartSchema`.
//   2. Re-resolve catalog via `resolveCartForCommit`.
//   3. Read `square_oauth` / `square_devices` to confirm connection +
//      resolve a device id (when none was passed).
//   4. Insert tickets (status='open') + bulk insert ticket_items.
//   5. Insert payments row (method='card', kind='sale', status='pending',
//      amount_cents=total). square_terminal_checkout_id null at this point.
//   6. Call Square `createTerminalCheckout` with idempotency key
//      `${ticketId}:${paymentId}`.
//   7. On success: update payments.square_terminal_checkout_id; return
//      { ok: true, ticketId }.
//   8. On Square failure: DELETE payments → DELETE ticket_items →
//      DELETE tickets, return TERMINAL_HANDOFF_FAILED.
//
// Constitution Principle IV — money paths are test-driven. This file
// covers:
//   - INVALID_CART for bad input (no DB / no Square touch).
//   - Happy path: ticket id returned, payments insert + Square call +
//     final UPDATE happen in order.
//   - Square API failure: returns TERMINAL_HANDOFF_FAILED AND the
//     compensating DELETEs run in payments → ticket_items → tickets
//     order (FK-safe; child rows first).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/square/terminal", () => ({
  createCheckout: vi.fn(),
  cancelCheckout: vi.fn(),
  getCheckout: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { createCheckout as squareCreateCheckout } from "@/lib/square/terminal";

import { sendCardToTerminalFromCart } from "@/app/(studio)/checkout/actions";

const SERVICE_ID_1 = "20000000-0000-0000-0000-000000000001";
const TECH_ID = "30000000-0000-0000-0000-000000000001";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const NEW_TICKET_ID = "44444444-4444-4444-4444-444444444444";
const PAYMENT_ID = "55555555-5555-5555-5555-555555555555";
const DEVICE_ID = "device:STUB_HAPPY";
const SQUARE_CHECKOUT_ID = "tco_stub_abc12345";

function mockSession() {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: "00000000-0000-0000-0000-000000000001",
    staff: {
      id: STAFF_ID,
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--avatar-rose",
    },
  });
}

type ServiceRow = { id: string; name: string; price_cents: number; duration_min: number };

type Setup = {
  services?: ServiceRow[];
  /** When true, Square's createCheckout throws. */
  squareFails?: boolean;
  /** When true, `square_oauth` returns no row (treated as INTERNAL). */
  squareNotConnected?: boolean;
};

type InsertCall = { table: string; values: unknown };
type DeleteCall = { table: string; predicates: Array<{ col: string; val: unknown }> };
type UpdateCall = {
  table: string;
  values: unknown;
  predicates: Array<{ col: string; val: unknown }>;
};

function setupClient(opts: Setup) {
  const services = opts.services ?? [
    { id: SERVICE_ID_1, name: "Classic manicure", price_cents: 2500, duration_min: 30 },
  ];
  const total = services.reduce((a, s) => a + s.price_cents, 0);

  const inserts: InsertCall[] = [];
  const deletes: DeleteCall[] = [];
  const updates: UpdateCall[] = [];

  (squareCreateCheckout as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    if (opts.squareFails) {
      throw new Error("square_unreachable");
    }
    return {
      squareTerminalCheckoutId: SQUARE_CHECKOUT_ID,
      status: "pending" as const,
    };
  });

  function fromFn(table: string) {
    if (table === "services") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: services, error: null })),
          })),
        })),
      };
    }
    if (table === "staff") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(async () => ({ data: [{ id: TECH_ID }], error: null })),
            })),
          })),
        })),
      };
    }
    if (table === "customers") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        })),
      };
    }
    if (table === "square_oauth") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () =>
              opts.squareNotConnected
                ? { data: null, error: null }
                : { data: { id: true, refresh_failed_at: null }, error: null }
            ),
          })),
        })),
      };
    }
    if (table === "square_devices") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { square_device_id: DEVICE_ID },
              error: null,
            })),
          })),
          limit: vi.fn(async () => ({
            data: [{ square_device_id: DEVICE_ID }],
            error: null,
          })),
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({
              data: [{ square_device_id: DEVICE_ID }],
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "tickets") {
      return {
        insert: vi.fn((row: unknown) => {
          inserts.push({ table: "tickets", values: row });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: NEW_TICKET_ID }, error: null })),
            })),
          };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(async (col: string, val: unknown) => {
            deletes.push({ table: "tickets", predicates: [{ col, val }] });
            return { error: null };
          }),
        })),
      };
    }
    if (table === "ticket_items") {
      return {
        insert: vi.fn(async (rows: unknown) => {
          inserts.push({ table: "ticket_items", values: rows });
          return { error: null };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(async (col: string, val: unknown) => {
            deletes.push({ table: "ticket_items", predicates: [{ col, val }] });
            return { error: null };
          }),
        })),
      };
    }
    if (table === "payments") {
      return {
        insert: vi.fn((row: unknown) => {
          inserts.push({ table: "payments", values: row });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: { id: PAYMENT_ID }, error: null })),
            })),
          };
        }),
        update: vi.fn((values: unknown) => ({
          eq: vi.fn(async (col: string, val: unknown) => {
            updates.push({
              table: "payments",
              values,
              predicates: [{ col, val }],
            });
            return { error: null };
          }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async (col: string, val: unknown) => {
            deletes.push({ table: "payments", predicates: [{ col, val }] });
            return { error: null };
          }),
        })),
      };
    }
    return {};
  }

  const fromSpy = vi.fn(fromFn);

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: vi.fn(async () => ({ data: null, error: { message: "no rpc expected" } })),
    from: fromSpy,
  });

  return { fromSpy, inserts, deletes, updates, total };
}

function validCart(over: Partial<Record<string, unknown>> = {}) {
  return {
    customerId: null,
    techId: TECH_ID,
    items: [{ serviceId: SERVICE_ID_1, techId: TECH_ID, note: null }],
    discount: null,
    notes: null,
    ...over,
  };
}

describe("sendCardToTerminalFromCart — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns INVALID_CART for a malformed cart and never touches Square or the DB", async () => {
    const { fromSpy } = setupClient({});
    const bad = validCart({
      items: [{ serviceId: "not-a-uuid", techId: TECH_ID, note: null }],
    });
    const result = await sendCardToTerminalFromCart(
      bad as unknown as Parameters<typeof sendCardToTerminalFromCart>[0],
      DEVICE_ID
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_CART");
    expect(squareCreateCheckout).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe("sendCardToTerminalFromCart — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("inserts ticket + items + pending payment, calls Square, persists the checkout id, returns ok", async () => {
    const { inserts, updates, total } = setupClient({});

    const result = await sendCardToTerminalFromCart(validCart(), DEVICE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticketId).toBe(NEW_TICKET_ID);

    // Insert order: ticket → items → payments.
    const tk = inserts.find((i) => i.table === "tickets");
    const items = inserts.find((i) => i.table === "ticket_items");
    const pay = inserts.find((i) => i.table === "payments");
    expect(tk).toBeDefined();
    expect(items).toBeDefined();
    expect(pay).toBeDefined();
    expect(inserts.indexOf(tk!)).toBeLessThan(inserts.indexOf(items!));
    expect(inserts.indexOf(items!)).toBeLessThan(inserts.indexOf(pay!));

    // Ticket inserted as 'open'.
    expect((tk!.values as Record<string, unknown>).status).toBe("open");

    // Payment row carries the canonical contract fields.
    const payRow = pay!.values as Record<string, unknown>;
    expect(payRow.ticket_id).toBe(NEW_TICKET_ID);
    expect(payRow.method).toBe("card");
    expect(payRow.status).toBe("pending");
    expect(payRow.amount_cents).toBe(total);

    // Square was called exactly once with our ticket + payment + device.
    expect(squareCreateCheckout).toHaveBeenCalledTimes(1);
    const sqArgs = (squareCreateCheckout as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sqArgs.ticketId).toBe(NEW_TICKET_ID);
    expect(sqArgs.paymentId).toBe(PAYMENT_ID);
    expect(sqArgs.deviceId).toBe(DEVICE_ID);
    expect(sqArgs.amountCents).toBe(total);

    // Square's checkout id was persisted on the payments row.
    const updatedRow = updates.find(
      (u) =>
        u.table === "payments" &&
        (u.values as Record<string, unknown>).square_terminal_checkout_id === SQUARE_CHECKOUT_ID
    );
    expect(updatedRow).toBeDefined();
    expect(updatedRow!.predicates[0]).toEqual({ col: "id", val: PAYMENT_ID });
  });
});

describe("sendCardToTerminalFromCart — Square failure rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("returns TERMINAL_HANDOFF_FAILED and runs compensating DELETEs in payments → items → tickets order", async () => {
    const { deletes } = setupClient({ squareFails: true });

    const result = await sendCardToTerminalFromCart(validCart(), DEVICE_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TERMINAL_HANDOFF_FAILED");
    expect(result.message).toMatch(/square/i);

    // Compensating deletes: payments first (so we can free the ticket
    // for cleanup), then ticket_items (child rows), then tickets.
    const pay = deletes.find((d) => d.table === "payments");
    const items = deletes.find((d) => d.table === "ticket_items");
    const tk = deletes.find((d) => d.table === "tickets");
    expect(pay).toBeDefined();
    expect(items).toBeDefined();
    expect(tk).toBeDefined();
    expect(deletes.indexOf(pay!)).toBeLessThan(deletes.indexOf(items!));
    expect(deletes.indexOf(items!)).toBeLessThan(deletes.indexOf(tk!));

    // Each delete scoped to the new ticket id.
    expect(pay!.predicates[0]).toEqual({ col: "ticket_id", val: NEW_TICKET_ID });
    expect(items!.predicates[0]).toEqual({ col: "ticket_id", val: NEW_TICKET_ID });
    expect(tk!.predicates[0]).toEqual({ col: "id", val: NEW_TICKET_ID });
  });
});
