// @vitest-environment node

// Unit test for `splitTenderFromCart` Server Action (Feature 042 / T022 /
// contracts § Action 4). Promotes the in-memory ephemeral cart into an
// `open` ticket with line items so the existing mid-split-tender UI on
// `/checkout/<id>` can take over.
//
// Per the contract:
//   - status='open' (the ticket is mid-flight, no payment yet),
//   - N ticket_items rows,
//   - NO payments row at this point — the operator composes legs via
//     the existing `composeDraftLeg` Server Action after redirect.
//
// The contract excerpt mentions calling `pos_compose_payment_draft`
// inside the same transaction, but the RPC signature requires both a
// method and an amount (it composes a *specific* leg draft, not a
// no-arg "start fresh" state). The existing `[ticketId]` landing logic
// for empty open tickets does NOT pre-compose a leg either (see
// `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx:1254-1262`
// — `handlePickSplit` just toggles UI state). So the action only needs
// to insert the ticket + items and return its id.
//
// Constitution Principle IV — money paths are test-driven. Coverage:
//   - Schema-level rejection of malformed input (INVALID_CART).
//   - STALE_SERVICE / INACTIVE_TECH re-resolve errors return cleanly
//     without inserting anything.
//   - Happy path: ticket + items inserted, status='open', and NO
//     `pos_compose_payment_draft` RPC is invoked (the contract's
//     "compose initial draft state" requirement is satisfied by the
//     existing mid-split UI on redirect, not at action time).
//   - Compensating DELETE on ticket_items insert failure (matches the
//     pattern used by `insertTicketAndItems` for cash / gift / card).

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

import { splitTenderFromCart } from "@/app/(studio)/checkout/actions";

const SERVICE_ID_1 = "20000000-0000-0000-0000-000000000001";
const SERVICE_ID_2 = "20000000-0000-0000-0000-000000000002";
const TECH_ID = "30000000-0000-0000-0000-000000000001";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const NEW_TICKET_ID = "77777777-7777-7777-7777-777777777777";

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
  services?: ServiceRow[];
  techActive?: boolean;
  /** When true the ticket_items.insert step returns an error to exercise the rollback path. */
  itemsInsertFailsWith?: string;
};

type DeleteCall = { table: string; predicates: Array<{ col: string; val: unknown }> };
type InsertCall = { table: string; values: unknown };
type RpcCall = { fn: string; args: unknown };

function setupClient(opts: ClientSetupOpts) {
  const services = opts.services ?? [
    { id: SERVICE_ID_1, name: "Classic manicure", price_cents: 2500, duration_min: 30 },
    { id: SERVICE_ID_2, name: "Gel polish", price_cents: 3500, duration_min: 30 },
  ];
  const techActive = opts.techActive ?? true;

  const inserts: InsertCall[] = [];
  const deletes: DeleteCall[] = [];
  const rpcCalls: RpcCall[] = [];

  // splitTenderFromCart MUST NOT call any RPC. Any RPC invocation is
  // recorded so the happy-path test can assert zero calls.
  const rpc = vi.fn(async (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return { data: null, error: null };
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
          if (opts.itemsInsertFailsWith) {
            return { error: { message: opts.itemsInsertFailsWith } };
          }
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
      // Any Node-side write to payments at split-init is a contract violation
      // (the operator composes legs after redirect via composeDraftLeg).
      return {
        insert: vi.fn(() => {
          throw new Error("payments.insert from splitTenderFromCart is forbidden");
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

  return { rpc, fromSpy, inserts, deletes, rpcCalls };
}

function validCart(over: Partial<Record<string, unknown>> = {}) {
  return {
    customerId: null,
    techId: TECH_ID,
    items: [
      { serviceId: SERVICE_ID_1, techId: TECH_ID, note: null },
      { serviceId: SERVICE_ID_2, techId: TECH_ID, note: null },
    ],
    discount: null,
    notes: null,
    ...over,
  };
}

describe("splitTenderFromCart — input validation", () => {
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
    const result = await splitTenderFromCart(
      bad as unknown as Parameters<typeof splitTenderFromCart>[0]
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_CART");
    expect(rpc).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("returns INVALID_CART for an empty items array", async () => {
    setupClient({});
    const bad = validCart({ items: [] });
    const result = await splitTenderFromCart(
      bad as unknown as Parameters<typeof splitTenderFromCart>[0]
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_CART");
  });
});

describe("splitTenderFromCart — re-resolve failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("returns STALE_SERVICE without inserting anything when the service is gone", async () => {
    const { rpc, inserts } = setupClient({ services: [] });
    const result = await splitTenderFromCart(validCart());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("STALE_SERVICE");
    expect(rpc).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("returns INACTIVE_TECH without inserting anything when the tech is gone", async () => {
    const { rpc, inserts } = setupClient({ techActive: false });
    const result = await splitTenderFromCart(validCart());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INACTIVE_TECH");
    expect(rpc).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});

describe("splitTenderFromCart — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("inserts open ticket + items, does NOT call any RPC, returns the new ticket id", async () => {
    const { rpc, rpcCalls, inserts } = setupClient({
      services: [
        { id: SERVICE_ID_1, name: "Classic manicure", price_cents: 2500, duration_min: 30 },
        { id: SERVICE_ID_2, name: "Gel polish", price_cents: 3500, duration_min: 30 },
      ],
    });
    const result = await splitTenderFromCart(validCart());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticketId).toBe(NEW_TICKET_ID);

    // Inserts ordered ticket → items.
    const tk = inserts.find((i) => i.table === "tickets");
    const items = inserts.find((i) => i.table === "ticket_items");
    expect(tk).toBeDefined();
    expect(items).toBeDefined();
    expect(inserts.indexOf(tk!)).toBeLessThan(inserts.indexOf(items!));

    // Ticket lands as 'open' (mid-flight; the operator settles legs via
    // the existing mid-split-tender screen after redirect).
    const tkRow = tk!.values as Record<string, unknown>;
    expect(tkRow.status).toBe("open");
    // Totals carry through from the resolved cart (snapshot semantics).
    expect(tkRow.subtotal_cents).toBe(6000);
    expect(tkRow.total_cents).toBe(6000);

    // 2 service items emitted, both attached to the new ticket id.
    const itemRows = items!.values as Array<Record<string, unknown>>;
    expect(itemRows).toHaveLength(2);
    expect(itemRows.every((r) => r.ticket_id === NEW_TICKET_ID)).toBe(true);

    // NO RPC is invoked at split-init — the existing mid-split UI on
    // `/checkout/<id>` composes leg drafts lazily via composeDraftLeg
    // when the operator picks a method+amount. Calling
    // `pos_compose_payment_draft` here would write an empty/garbage
    // draft row.
    expect(rpc).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("splitTenderFromCart — compensating delete on items insert failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it("returns INTERNAL and deletes the just-inserted ticket when ticket_items insert errors", async () => {
    const { deletes } = setupClient({
      itemsInsertFailsWith: "duplicate key value violates unique constraint",
    });
    const result = await splitTenderFromCart(validCart());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INTERNAL");

    // `insertTicketAndItems` already deletes the orphan ticket inline
    // when the items insert fails (no ticket_items rows exist to delete).
    const tk = deletes.find((d) => d.table === "tickets");
    expect(tk).toBeDefined();
    expect(tk!.predicates[0]).toEqual({ col: "id", val: NEW_TICKET_ID });
  });
});
