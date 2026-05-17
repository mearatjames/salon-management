// @vitest-environment node

// Unit test for `setLinePrice` (T014). The action wraps the typed-error
// contract from `contracts/server-actions.md § 1`:
//   - happy path on an unconfirmed service row → row updated, totals
//     recomputed, audit row written with `was_unconfirmed=true`
//   - override path on a confirmed row → same write, audit payload
//     reflects `was_unconfirmed=false`
//   - attempting to price a discount row → `InvalidPriceError`
//   - non-positive `unitPriceCents` → `InvalidPriceError` (server-side
//     defense even though the zod schema also catches this client-side)
//
// We mock the supabase service-role client end-to-end so the test never
// touches the network. The mock tracks `from(table).select/update/eq`
// calls per-table so the assertions can inspect what the action wrote.

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
import { recordAudit } from "@/lib/auth/audit";

import { setLinePrice } from "@/app/(studio)/checkout/actions";
import { InvalidPriceError, TicketNotOpenError } from "@/app/(studio)/checkout/_errors";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const LINE_ID = "22222222-2222-2222-2222-222222222222";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const DEVICE_USER_ID = "00000000-0000-0000-0000-000000000001";

type LineRow = {
  id: string;
  ticket_id: string;
  kind: "service" | "discount";
  unit_price_cents: number;
  qty: number;
  price_unconfirmed: boolean;
  discount_pct: number | null;
};

function mockSession() {
  (requireStudioSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    deviceUserId: DEVICE_USER_ID,
    staff: {
      id: STAFF_ID,
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--avatar-rose",
    },
  });
}

/**
 * Returns a supabase mock that satisfies the action's call graph:
 *   1. tickets.select(id,status).eq(id).single → ticket
 *   2. ticket_items.select("id,kind,…").eq("id",lineId).single → namedLine
 *   3. ticket_items.update({unit_price_cents,price_unconfirmed}).eq("id",lineId)
 *   4. recomputeTicketTotals: ticket_items.select(…).eq("ticket_id",…) → rows
 *      then tickets.update({subtotal_cents,total_cents}).eq("id",ticketId)
 */
function makeMockClient(opts: {
  ticketStatus: "open" | "paid" | "discarded";
  namedLine: LineRow;
  recomputeRows: LineRow[];
}) {
  const updates: Array<{ table: string; values: Record<string, unknown>; id?: string }> = [];

  const fromSpy = vi.fn((table: string) => {
    if (table === "tickets") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: TICKET_ID, status: opts.ticketStatus },
              error: null,
            })),
          })),
        })),
        update: vi.fn((values: Record<string, unknown>) => ({
          eq: vi.fn(async (_col: string, id: string) => {
            updates.push({ table, values, id });
            return { error: null };
          }),
        })),
      };
    }
    if (table === "payments") {
      // Feature 018 — `discardDraftLegs` runs at the head of every
      // line-mutation action. This mock makes it a no-op: no pending
      // rows (FR-019a guard passes), no drafts to delete. The chain has
      // two shapes — `.select.eq.eq.limit` (in-flight) and
      // `.select.eq.eq` (drafts read) — so the second .eq returns a
      // thenable that also exposes `.limit`.
      const emptyResult = { data: [], error: null };
      function makeTerminalEq() {
        const thenable = {
          then: (
            onFulfilled: (v: typeof emptyResult) => unknown,
            onRejected?: (r: unknown) => unknown
          ) => Promise.resolve(emptyResult).then(onFulfilled, onRejected),
          limit: () => Promise.resolve(emptyResult),
        };
        return thenable;
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => makeTerminalEq()),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        })),
      };
    }
    if (table === "ticket_items") {
      // Two distinct shapes:
      //  - .select("id, ticket_id, kind, unit_price_cents, qty, price_unconfirmed, discount_pct").eq("id", lineId).single()
      //  - .select("id, kind, unit_price_cents, qty, price_unconfirmed, discount_pct").eq("ticket_id", ticketId)
      return {
        select: vi.fn((cols: string) => ({
          eq: vi.fn((col: string, value: string) => {
            if (col === "id" && value === opts.namedLine.id) {
              return {
                single: vi.fn(async () => ({
                  data: opts.namedLine,
                  error: null,
                })),
              };
            }
            if (col === "ticket_id") {
              // Mirrors the recomputeTicketTotals SELECT result shape.
              const rowsForRecompute = opts.recomputeRows.map((r) => ({
                id: r.id,
                kind: r.kind,
                unit_price_cents: r.unit_price_cents,
                qty: r.qty,
                price_unconfirmed: r.price_unconfirmed,
                discount_pct: r.discount_pct,
              }));
              // Recompute expects a thenable result (no .single chain),
              // so return a Promise-like object directly.
              return Promise.resolve({ data: rowsForRecompute, error: null });
            }
            // Fallback
            return {
              single: vi.fn(async () => ({ data: null, error: null })),
            };
          }),
          // Unused but defensive.
          _cols: cols,
        })),
        update: vi.fn((values: Record<string, unknown>) => ({
          eq: vi.fn(async (_col: string, id: string) => {
            updates.push({ table, values, id });
            return { error: null };
          }),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: fromSpy,
  });

  return { fromSpy, updates };
}

describe("setLinePrice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) happy path: unconfirmed service row → updates row, recomputes totals, emits audit with was_unconfirmed=true", async () => {
    const line: LineRow = {
      id: LINE_ID,
      ticket_id: TICKET_ID,
      kind: "service",
      unit_price_cents: 0,
      qty: 1,
      price_unconfirmed: true,
      discount_pct: null,
    };
    // After the update, the recompute sees the new amount (5000c) on the
    // same row with price_unconfirmed=false.
    const { updates } = makeMockClient({
      ticketStatus: "open",
      namedLine: line,
      recomputeRows: [{ ...line, unit_price_cents: 5000, price_unconfirmed: false }],
    });

    const totals = await setLinePrice({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      unitPriceCents: 5000,
    });

    expect(totals).toEqual({ subtotalCents: 5000, totalCents: 5000 });

    // ticket_items.update happened with unit_price_cents=5000, price_unconfirmed=false.
    const itemUpdate = updates.find((u) => u.table === "ticket_items" && u.id === LINE_ID);
    expect(itemUpdate).toBeDefined();
    expect(itemUpdate!.values).toMatchObject({
      unit_price_cents: 5000,
      price_unconfirmed: false,
    });

    // tickets.update happened with the new totals.
    const ticketUpdate = updates.find((u) => u.table === "tickets");
    expect(ticketUpdate).toBeDefined();
    expect(ticketUpdate!.values).toMatchObject({
      subtotal_cents: 5000,
      total_cents: 5000,
    });

    // Audit row was written with was_unconfirmed=true.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [verb, deviceUserId, entityId, payload, actingAsStaffId] = (
      recordAudit as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(verb).toBe("line.price_set");
    expect(deviceUserId).toBe(DEVICE_USER_ID);
    expect(entityId).toBe(LINE_ID);
    expect(actingAsStaffId).toBe(STAFF_ID);
    expect(payload).toMatchObject({
      ticket_id: TICKET_ID,
      previous_unit_price_cents: 0,
      new_unit_price_cents: 5000,
      was_unconfirmed: true,
    });
  });

  it("(b) override path: confirmed row → same write path, audit payload was_unconfirmed=false", async () => {
    const line: LineRow = {
      id: LINE_ID,
      ticket_id: TICKET_ID,
      kind: "service",
      unit_price_cents: 2500,
      qty: 1,
      price_unconfirmed: false,
      discount_pct: null,
    };
    makeMockClient({
      ticketStatus: "open",
      namedLine: line,
      recomputeRows: [{ ...line, unit_price_cents: 3000 }],
    });

    const totals = await setLinePrice({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      unitPriceCents: 3000,
    });

    expect(totals).toEqual({ subtotalCents: 3000, totalCents: 3000 });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const payload = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock.calls[0][3];
    expect(payload).toMatchObject({
      ticket_id: TICKET_ID,
      previous_unit_price_cents: 2500,
      new_unit_price_cents: 3000,
      was_unconfirmed: false,
    });
  });

  // T021 [US2]: explicit override-path coverage. The action's
  // `was_unconfirmed` branch is the US1 / US2 disambiguator in the audit
  // log. Case (b) above asserts it on a 2500 → 3000 bump; this case
  // exercises a different concrete pair (4500 → 6000) and additionally
  // asserts that `ticket_items.update` carried `price_unconfirmed=false`
  // verbatim (no toggle on the already-confirmed row).
  it("(b2) US2 override-path on a confirmed row → unit_price_cents written, price_unconfirmed stays false, audit was_unconfirmed=false", async () => {
    const line: LineRow = {
      id: LINE_ID,
      ticket_id: TICKET_ID,
      kind: "service",
      unit_price_cents: 4500,
      qty: 1,
      price_unconfirmed: false,
      discount_pct: null,
    };
    const { updates } = makeMockClient({
      ticketStatus: "open",
      namedLine: line,
      recomputeRows: [{ ...line, unit_price_cents: 6000 }],
    });

    const totals = await setLinePrice({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      unitPriceCents: 6000,
    });

    expect(totals).toEqual({ subtotalCents: 6000, totalCents: 6000 });

    // The ticket_items.update wrote price_unconfirmed=false (re-asserted,
    // not toggled — the override path takes the same UPDATE as the auto-
    // open path; the only behavioral difference lives client-side in the
    // Remove-button visibility).
    const itemUpdate = updates.find((u) => u.table === "ticket_items" && u.id === LINE_ID);
    expect(itemUpdate).toBeDefined();
    expect(itemUpdate!.values).toMatchObject({
      unit_price_cents: 6000,
      price_unconfirmed: false,
    });

    // Audit payload reflects the override (was_unconfirmed=false) AND the
    // previous + new amounts in cents.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [verb, , entityId, payload] = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(verb).toBe("line.price_set");
    expect(entityId).toBe(LINE_ID);
    expect(payload).toMatchObject({
      ticket_id: TICKET_ID,
      previous_unit_price_cents: 4500,
      new_unit_price_cents: 6000,
      was_unconfirmed: false,
    });
  });

  it("(c) refuses with InvalidPriceError when the line is a discount row", async () => {
    const discount: LineRow = {
      id: LINE_ID,
      ticket_id: TICKET_ID,
      kind: "discount",
      unit_price_cents: -500,
      qty: 1,
      price_unconfirmed: false,
      discount_pct: null,
    };
    makeMockClient({
      ticketStatus: "open",
      namedLine: discount,
      recomputeRows: [discount],
    });

    await expect(
      setLinePrice({ ticketId: TICKET_ID, lineId: LINE_ID, unitPriceCents: 1000 })
    ).rejects.toBeInstanceOf(InvalidPriceError);

    // No write, no audit.
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(d) refuses with InvalidPriceError when unitPriceCents <= 0", async () => {
    const line: LineRow = {
      id: LINE_ID,
      ticket_id: TICKET_ID,
      kind: "service",
      unit_price_cents: 0,
      qty: 1,
      price_unconfirmed: true,
      discount_pct: null,
    };
    makeMockClient({
      ticketStatus: "open",
      namedLine: line,
      recomputeRows: [line],
    });

    await expect(
      setLinePrice({ ticketId: TICKET_ID, lineId: LINE_ID, unitPriceCents: 0 })
    ).rejects.toBeInstanceOf(InvalidPriceError);

    await expect(
      setLinePrice({ ticketId: TICKET_ID, lineId: LINE_ID, unitPriceCents: -100 })
    ).rejects.toBeInstanceOf(InvalidPriceError);

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses with TicketNotOpenError when the ticket is paid", async () => {
    const line: LineRow = {
      id: LINE_ID,
      ticket_id: TICKET_ID,
      kind: "service",
      unit_price_cents: 0,
      qty: 1,
      price_unconfirmed: true,
      discount_pct: null,
    };
    makeMockClient({
      ticketStatus: "paid",
      namedLine: line,
      recomputeRows: [line],
    });

    await expect(
      setLinePrice({ ticketId: TICKET_ID, lineId: LINE_ID, unitPriceCents: 5000 })
    ).rejects.toBeInstanceOf(TicketNotOpenError);
  });
});
