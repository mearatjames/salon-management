// @vitest-environment node

// Unit test for `submitCashFromCart` Server Action (Feature 042 / T013 /
// contracts § Action 1). Promotes the in-memory ephemeral cart into a
// fully-paid cash ticket in a single sequence: insert tickets → bulk
// insert ticket_items → call `pos_take_cash` RPC. On any failure after
// the ticket+items inserts, runs compensating DELETEs (no orphan rows).
//
// Constitution Principle IV — money paths are test-driven. This file
// covers:
//   - Schema-level rejection of malformed input (INVALID_CART).
//   - Insufficient cash short-circuit BEFORE any insert (INSUFFICIENT_CASH).
//   - Happy path: ticket id returned, RPC called with the freshly-
//     inserted ticket id, payment row not Node-inserted (the RPC owns it).
//   - Compensating deletes on RPC failure (the ticket + items rows must
//     not survive a failed `pos_take_cash`).

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

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";

import { submitCashFromCart } from "@/app/(studio)/checkout/actions";

const SERVICE_ID_1 = "20000000-0000-0000-0000-000000000001";
const SERVICE_ID_2 = "20000000-0000-0000-0000-000000000002";
const TECH_ID = "30000000-0000-0000-0000-000000000001";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const NEW_TICKET_ID = "44444444-4444-4444-4444-444444444444";
const PAYMENT_ID = "55555555-5555-5555-5555-555555555555";

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

type ClientSetupOpts = {
  /** Services to return from the `services` table re-resolve. */
  services?: ServiceRow[];
  /** Whether the active-staff lookup should return the tech as active. */
  techActive?: boolean;
  /**
   * RPC behavior. When `failsWith` is set, `pos_take_cash` returns
   * `{ error: { message: failsWith } }` and the action must run
   * compensating deletes. Otherwise it returns `{ data: PAYMENT_ID }`.
   */
  rpcFailsWith?: string;
  /**
   * `tickets.total_cents` to return on the post-charge read-back.
   * Defaults to the sum of `services[*].price_cents` for the happy path.
   */
  postChargeTotal?: number;
};

type DeleteCall = { table: string; predicates: Array<{ col: string; val: unknown }> };
type InsertCall = { table: string; values: unknown };

function setupClient(opts: ClientSetupOpts) {
  const services = opts.services ?? [
    { id: SERVICE_ID_1, name: "Classic manicure", price_cents: 2500, duration_min: 30 },
  ];
  const techActive = opts.techActive ?? true;

  const inserts: InsertCall[] = [];
  const deletes: DeleteCall[] = [];

  const rpc = vi.fn(async (fn: string) => {
    if (fn !== "pos_take_cash") {
      return { data: null, error: { message: "unexpected rpc " + fn } };
    }
    if (opts.rpcFailsWith) {
      return { data: null, error: { message: opts.rpcFailsWith } };
    }
    return { data: PAYMENT_ID, error: null };
  });

  function fromFn(table: string) {
    if (table === "services") {
      // .select(...).in(...).eq('active', true)
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: services, error: null })),
          })),
        })),
      };
    }
    if (table === "staff") {
      // .select(...).in(...).eq('active', true).is('removed_at', null)
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(async () => ({
                data: techActive ? [{ id: TECH_ID }] : [],
                error: null,
              })),
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
    if (table === "tickets") {
      // Two surfaces:
      //   .insert(row).select('id').single() — returns NEW_TICKET_ID
      //   .delete().eq('id', ...) — compensating delete on failure
      return {
        insert: vi.fn((row: unknown) => {
          inserts.push({ table: "tickets", values: row });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: NEW_TICKET_ID },
                error: null,
              })),
            })),
          };
        }),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                total_cents:
                  opts.postChargeTotal ?? services.reduce((a, s) => a + s.price_cents, 0),
              },
              error: null,
            })),
          })),
        })),
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
      // Any Node-side write to payments is a contract violation.
      return {
        insert: vi.fn(() => {
          throw new Error("payments.insert from Node is forbidden");
        }),
        select: vi.fn(),
      };
    }
    return {};
  }

  const fromSpy = vi.fn(fromFn);

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    from: fromSpy,
  });

  return { rpc, fromSpy, inserts, deletes };
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

describe("submitCashFromCart — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns INVALID_CART for a non-UUID serviceId without touching the DB", async () => {
    const { rpc, fromSpy } = setupClient({});
    const bad = validCart({
      items: [{ serviceId: "not-a-uuid", techId: TECH_ID, note: null }],
    });
    const result = await submitCashFromCart(
      bad as unknown as Parameters<typeof submitCashFromCart>[0],
      10000
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_CART");
    // No DB touch.
    expect(rpc).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns INVALID_CART for an empty items array", async () => {
    setupClient({});
    const bad = validCart({ items: [] });
    const result = await submitCashFromCart(
      bad as unknown as Parameters<typeof submitCashFromCart>[0],
      10000
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_CART");
  });
});

describe("submitCashFromCart — insufficient cash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("returns INSUFFICIENT_CASH when tendered < total_cents and inserts NOTHING", async () => {
    // Service costs $25.00; operator only enters $20.00.
    const { rpc, inserts, deletes } = setupClient({
      services: [
        { id: SERVICE_ID_1, name: "Classic manicure", price_cents: 2500, duration_min: 30 },
      ],
    });

    const result = await submitCashFromCart(validCart(), 2000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INSUFFICIENT_CASH");

    // No ticket / items inserted. No RPC call.
    expect(inserts.filter((i) => i.table === "tickets")).toHaveLength(0);
    expect(inserts.filter((i) => i.table === "ticket_items")).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    // And no compensating deletes (there was nothing to compensate).
    expect(deletes).toHaveLength(0);
  });
});

describe("submitCashFromCart — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("inserts ticket + items, calls pos_take_cash with the new ticket id, and returns ok with that ticket id", async () => {
    const { rpc, inserts } = setupClient({
      services: [
        { id: SERVICE_ID_1, name: "Classic manicure", price_cents: 2500, duration_min: 30 },
        { id: SERVICE_ID_2, name: "Polish change", price_cents: 1500, duration_min: 15 },
      ],
    });

    const cart = validCart({
      items: [
        { serviceId: SERVICE_ID_1, techId: TECH_ID, note: null },
        { serviceId: SERVICE_ID_2, techId: TECH_ID, note: "ring finger only" },
      ],
    });
    const result = await submitCashFromCart(cart, 5000);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticketId).toBe(NEW_TICKET_ID);

    // Inserts happened in the right order: ticket → items.
    const tk = inserts.find((i) => i.table === "tickets");
    const items = inserts.find((i) => i.table === "ticket_items");
    expect(tk).toBeDefined();
    expect(items).toBeDefined();
    expect(inserts.indexOf(tk!)).toBeLessThan(inserts.indexOf(items!));

    // ticket row carries the canonical totals.
    const tkRow = tk!.values as Record<string, unknown>;
    expect(tkRow.subtotal_cents).toBe(4000);
    expect(tkRow.total_cents).toBe(4000);
    // Insert goes in as 'open' to satisfy the closed-consistency check;
    // pos_take_cash flips it to 'paid' (verified end-to-end in e2e).
    expect(tkRow.status).toBe("open");

    // 2 service items emitted.
    const itemRows = items!.values as Array<Record<string, unknown>>;
    expect(itemRows).toHaveLength(2);
    expect(itemRows.every((r) => r.ticket_id === NEW_TICKET_ID)).toBe(true);

    // RPC called with the new ticket id.
    expect(rpc).toHaveBeenCalledWith("pos_take_cash", {
      p_ticket_id: NEW_TICKET_ID,
      p_operator: STAFF_ID,
    });
  });
});

describe("submitCashFromCart — compensating deletes on RPC failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("runs DELETE on ticket_items then tickets when pos_take_cash fails", async () => {
    const { deletes } = setupClient({
      rpcFailsWith: "deadlock detected",
    });

    const result = await submitCashFromCart(validCart(), 5000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INTERNAL");

    // Compensating order: ticket_items first (child rows), then tickets.
    const items = deletes.find((d) => d.table === "ticket_items");
    const tk = deletes.find((d) => d.table === "tickets");
    expect(items).toBeDefined();
    expect(tk).toBeDefined();
    expect(deletes.indexOf(items!)).toBeLessThan(deletes.indexOf(tk!));

    // Both predicates scoped to the new ticket id.
    expect(items!.predicates[0]).toEqual({ col: "ticket_id", val: NEW_TICKET_ID });
    expect(tk!.predicates[0]).toEqual({ col: "id", val: NEW_TICKET_ID });
  });
});

describe("submitCashFromCart — stale catalog re-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("returns STALE_SERVICE without inserting anything when the service is no longer active", async () => {
    const { rpc, inserts } = setupClient({
      services: [], // re-resolve returns no rows — the service id is stale.
    });
    const result = await submitCashFromCart(validCart(), 5000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("STALE_SERVICE");
    expect(rpc).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});
