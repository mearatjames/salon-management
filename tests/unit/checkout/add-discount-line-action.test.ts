// @vitest-environment node

// Unit test for `addDiscountLine` (T024 / T027) — feature 013-cart-polish.
//
// The action wraps the contract from `contracts/server-actions.md § 2`:
//   (a) shape='flat', value=1000 → row inserted with unit_price_cents=-1000,
//       discount_pct=null, totals recomputed, audit `discount.added` with
//       payload {shape:'flat', value:1000, note}.
//   (b) shape='percent', value=15 on a $30 service-subtotal → row inserted
//       with discount_pct=15 (unit_price_cents starts at 0; recompute
//       writes the -450 amount based on the live service subtotal).
//   (c) shape='percent', value=0 → DiscountInvalidError{reason:'percent_out_of_range'}
//       — the zod schema's `.positive()` admits any positive int; the
//       per-shape range guard (1..100) lives in the action body.
//   (d) shape='percent', value=101 → same throw, same path.
//   (e) shape='flat', value=0 → DiscountInvalidError{reason:'flat_value_non_positive'}
//       (zod's `.positive()` catches this one — the action surfaces it as
//       the typed error so callers can branch on `reason`).
//   (f) note 81+ chars → zod rejects.
//   (g) `getSetting('discount.manager_threshold_cents')` returning null
//       still permits the action (FR-018 — v1 read is intentionally ignored).
//
// We mock the supabase service-role client, requireStudioSession, recordAudit,
// AND `getSetting` end-to-end so the test never touches the network. The mock
// tracks `from(table).insert/select/update/eq` calls per-table so the
// assertions can inspect what the action wrote.

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

vi.mock("@/lib/settings/read", () => ({
  getSetting: vi.fn(async () => null),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getSetting } from "@/lib/settings/read";

import { addDiscountLine } from "@/app/(studio)/checkout/actions";
import { DiscountInvalidError, TicketNotOpenError } from "@/app/(studio)/checkout/_errors";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const NEW_LINE_ID = "33333333-3333-3333-3333-333333333333";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const DEVICE_USER_ID = "00000000-0000-0000-0000-000000000001";

type RecomputeRow = {
  id: string;
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
 * Supabase mock that satisfies the action's call graph:
 *   1. tickets.select(id,status).eq("id",ticketId).single → ticket
 *   2. ticket_items.insert({...}).select("id").single → { id: newLineId }
 *   3. ticket_items.select("id,kind,...").eq("ticket_id",ticketId) → recompute rows
 *      (and any per-row UPDATEs the recompute issues for drifted percent discounts)
 *   4. tickets.update({subtotal_cents,total_cents}).eq("id",ticketId)
 */
function makeMockClient(opts: {
  ticketStatus: "open" | "paid" | "discarded";
  /**
   * Rows the recompute SELECT returns. Should INCLUDE the row that the
   * insert step just created — the action issues the SELECT after the
   * insert returns, so a realistic mock includes the new row.
   */
  recomputeRows: RecomputeRow[];
}) {
  const writes: Array<{
    op: "insert" | "update";
    table: string;
    values: Record<string, unknown>;
    id?: string;
  }> = [];

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
            writes.push({ op: "update", table, values, id });
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
        // A Promise-like object that resolves to emptyResult AND has a
        // `.limit()` method also resolving to emptyResult. Awaiting it
        // directly satisfies the drafts read; calling `.limit()` then
        // awaiting satisfies the in-flight check.
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
      return {
        insert: vi.fn((values: Record<string, unknown>) => {
          writes.push({ op: "insert", table, values });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: NEW_LINE_ID },
                error: null,
              })),
            })),
          };
        }),
        select: vi.fn(() => ({
          eq: vi.fn((col: string) => {
            if (col === "ticket_id") {
              // Recompute SELECT — return current rows shape verbatim.
              return Promise.resolve({
                data: opts.recomputeRows.map((r) => ({
                  id: r.id,
                  kind: r.kind,
                  unit_price_cents: r.unit_price_cents,
                  qty: r.qty,
                  price_unconfirmed: r.price_unconfirmed,
                  discount_pct: r.discount_pct,
                })),
                error: null,
              });
            }
            return {
              single: vi.fn(async () => ({ data: null, error: null })),
            };
          }),
        })),
        update: vi.fn((values: Record<string, unknown>) => ({
          eq: vi.fn(async (_col: string, id: string) => {
            writes.push({ op: "update", table, values, id });
            // Mutate the in-mock recompute snapshot so subsequent inspections
            // (and the discountTotal sum) reflect the per-row UPDATE.
            const row = opts.recomputeRows.find((r) => r.id === id);
            if (row && typeof values.unit_price_cents === "number") {
              row.unit_price_cents = values.unit_price_cents;
            }
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

  return { fromSpy, writes };
}

describe("addDiscountLine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    // Default: setting returns null (FR-018 — read is ignored in v1).
    (getSetting as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) shape='flat', value=1000 → inserts discount row with unit_price_cents=-1000, audit emits payload", async () => {
    // A confirmed $30 service line is already on the ticket; the recompute
    // sees it plus the freshly-inserted discount row.
    const recomputeRows: RecomputeRow[] = [
      {
        id: "service-line-1",
        kind: "service",
        unit_price_cents: 3000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
      {
        id: NEW_LINE_ID,
        kind: "discount",
        unit_price_cents: -1000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
    ];
    const { writes } = makeMockClient({ ticketStatus: "open", recomputeRows });

    const result = await addDiscountLine({
      ticketId: TICKET_ID,
      shape: "flat",
      value: 1000,
      note: "Loyalty perk",
    });

    expect(result).toEqual({
      lineId: NEW_LINE_ID,
      // 3000 service - 1000 discount = 2000
      subtotalCents: 2000,
      totalCents: 2000,
    });

    const insert = writes.find((w) => w.op === "insert" && w.table === "ticket_items");
    expect(insert).toBeDefined();
    expect(insert!.values).toMatchObject({
      ticket_id: TICKET_ID,
      kind: "discount",
      ref_id: null,
      assigned_staff_id: null,
      name_snapshot: "Discount",
      unit_price_cents: -1000,
      qty: 1,
      discount_pct: null,
      note: "Loyalty perk",
    });

    // tickets.update happened with new totals.
    const ticketUpdate = writes.find((w) => w.op === "update" && w.table === "tickets");
    expect(ticketUpdate).toBeDefined();
    expect(ticketUpdate!.values).toMatchObject({
      subtotal_cents: 2000,
      total_cents: 2000,
    });

    // Audit emitted with the contract payload shape.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [verb, deviceUserId, entityId, payload, actingAsStaffId] = (
      recordAudit as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(verb).toBe("discount.added");
    expect(deviceUserId).toBe(DEVICE_USER_ID);
    expect(entityId).toBe(NEW_LINE_ID);
    expect(actingAsStaffId).toBe(STAFF_ID);
    expect(payload).toMatchObject({
      ticket_id: TICKET_ID,
      shape: "flat",
      value: 1000,
      note: "Loyalty perk",
    });
  });

  it("(b) shape='percent', value=15 on $30 service subtotal → recompute writes unit_price_cents=-450", async () => {
    // Insert lands with unit_price_cents=0 (per the contract); recompute
    // walks the rows, computes -round(15 * 3000 / 100) = -450, and writes
    // it back via a targeted UPDATE on the discount row.
    const recomputeRows: RecomputeRow[] = [
      {
        id: "service-line-1",
        kind: "service",
        unit_price_cents: 3000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
      {
        id: NEW_LINE_ID,
        kind: "discount",
        unit_price_cents: 0, // post-insert value before recompute
        qty: 1,
        price_unconfirmed: false,
        discount_pct: 15,
      },
    ];
    const { writes } = makeMockClient({ ticketStatus: "open", recomputeRows });

    const result = await addDiscountLine({
      ticketId: TICKET_ID,
      shape: "percent",
      value: 15,
    });

    expect(result).toEqual({
      lineId: NEW_LINE_ID,
      // 3000 - 450 = 2550
      subtotalCents: 2550,
      totalCents: 2550,
    });

    // Insert carried discount_pct=15 + unit_price_cents=0.
    const insert = writes.find((w) => w.op === "insert" && w.table === "ticket_items");
    expect(insert).toBeDefined();
    expect(insert!.values).toMatchObject({
      ticket_id: TICKET_ID,
      kind: "discount",
      name_snapshot: "Discount · 15%",
      unit_price_cents: 0,
      discount_pct: 15,
      note: null,
    });

    // The recompute issued a targeted UPDATE on the discount row to write
    // the -450 amount back.
    const rowUpdate = writes.find(
      (w) => w.op === "update" && w.table === "ticket_items" && w.id === NEW_LINE_ID
    );
    expect(rowUpdate).toBeDefined();
    expect(rowUpdate!.values).toMatchObject({ unit_price_cents: -450 });

    // tickets.update reflects the recomputed totals.
    const ticketUpdate = writes.find((w) => w.op === "update" && w.table === "tickets");
    expect(ticketUpdate!.values).toMatchObject({
      subtotal_cents: 2550,
      total_cents: 2550,
    });
  });

  it("(c) shape='percent', value=0 → DiscountInvalidError{reason:'percent_out_of_range'}", async () => {
    makeMockClient({ ticketStatus: "open", recomputeRows: [] });

    // zod's `.positive()` rejects 0 → comes back as a zod issue. The action
    // catches that AND non-zod cases and surfaces `DiscountInvalidError` with
    // the right `reason` for percent shape. (Either route lands here, and
    // the typed error gives the UI a stable branch.)
    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "percent",
        value: 0,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("percent_out_of_range");

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(d) shape='percent', value=101 → DiscountInvalidError{reason:'percent_out_of_range'}", async () => {
    makeMockClient({ ticketStatus: "open", recomputeRows: [] });

    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "percent",
        value: 101,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("percent_out_of_range");

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(e) shape='flat', value=0 → DiscountInvalidError{reason:'flat_value_non_positive'}", async () => {
    makeMockClient({ ticketStatus: "open", recomputeRows: [] });

    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "flat",
        value: 0,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("flat_value_non_positive");

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(f) note 81+ chars → zod rejects (DiscountInvalidError{reason:'note_too_long'})", async () => {
    makeMockClient({ ticketStatus: "open", recomputeRows: [] });
    const overflowNote = "x".repeat(81);

    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "flat",
        value: 500,
        note: overflowNote,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("note_too_long");

    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(g) getSetting returns null → action still succeeds (FR-018, v1 ignores the threshold)", async () => {
    (getSetting as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const recomputeRows: RecomputeRow[] = [
      {
        id: "service-line-1",
        kind: "service",
        unit_price_cents: 5000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
      {
        id: NEW_LINE_ID,
        kind: "discount",
        unit_price_cents: -500,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
    ];
    makeMockClient({ ticketStatus: "open", recomputeRows });

    const result = await addDiscountLine({
      ticketId: TICKET_ID,
      shape: "flat",
      value: 500,
    });

    expect(result.lineId).toBe(NEW_LINE_ID);
    expect(result.subtotalCents).toBe(4500);
    expect(getSetting).toHaveBeenCalledWith("discount.manager_threshold_cents");
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("refuses with TicketNotOpenError when the ticket is paid", async () => {
    makeMockClient({ ticketStatus: "paid", recomputeRows: [] });

    await expect(
      addDiscountLine({ ticketId: TICKET_ID, shape: "flat", value: 500 })
    ).rejects.toBeInstanceOf(TicketNotOpenError);

    expect(recordAudit).not.toHaveBeenCalled();
  });

  // -------- 049-per-service-discount: targetLineIds validation surface ----
  //
  // The new `targetLineIds` argument extends `AddDiscountLineInput` per
  // `contracts/server-actions.md § 1`. Validation order: shape/value/note
  // first (covered above), then for `targetLineIds` (when provided):
  //   1. each entry is a uuid + dedupe → non-empty → else `scope_empty`
  //   2. each entry resolves to a same-ticket service row → else
  //      `scope_target_unknown` (entry not in `ticket_items`) or
  //      `scope_off_ticket` (entry IS a ticket_items row but ticket_id != arg).
  // The `discount.added` audit payload carries `scope: { kind:
  // "selected_services", line_ids: [...] }` only when scoped.

  const SERVICE_LINE_ID = "44444444-4444-4444-4444-444444444444";
  const OTHER_SERVICE_LINE_ID = "55555555-5555-5555-5555-555555555555";
  const OFF_TICKET_LINE_ID = "66666666-6666-6666-6666-666666666666";
  const UNKNOWN_LINE_ID = "77777777-7777-7777-7777-777777777777";

  /**
   * Variant of the mock that also serves a `ticket_items.select("id,
   * ticket_id, kind").in("id", [...])` lookup used by the scope resolver
   * to confirm every target is a same-ticket service row.
   */
  function makeMockClientWithScopeLookup(opts: {
    ticketStatus: "open" | "paid" | "discarded";
    recomputeRows: RecomputeRow[];
    /** Rows the scope-resolver `ticket_items.select(...).in("id", ids)` returns. */
    scopeRows?: Array<{ id: string; ticket_id: string; kind: "service" | "discount" }>;
  }) {
    const writes: Array<{
      op: "insert" | "update";
      table: string;
      values: Record<string, unknown>;
      id?: string;
    }> = [];

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
              writes.push({ op: "update", table, values, id });
              return { error: null };
            }),
          })),
        };
      }
      if (table === "payments") {
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
        return {
          insert: vi.fn((values: Record<string, unknown>) => {
            writes.push({ op: "insert", table, values });
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: NEW_LINE_ID },
                  error: null,
                })),
              })),
            };
          }),
          // Two-arity select: the scope resolver uses
          // .select("id,ticket_id,kind").in("id", ids); the recompute uses
          // .select("id, kind, ...").eq("ticket_id", ticketId). We discriminate
          // by which terminal method (`.in` vs `.eq`) is called.
          select: vi.fn(() => ({
            in: vi.fn(async (_col: string, _ids: string[]) => ({
              data: opts.scopeRows ?? [],
              error: null,
            })),
            eq: vi.fn((col: string) => {
              if (col === "ticket_id") {
                return Promise.resolve({
                  data: opts.recomputeRows.map((r) => ({
                    id: r.id,
                    kind: r.kind,
                    unit_price_cents: r.unit_price_cents,
                    qty: r.qty,
                    price_unconfirmed: r.price_unconfirmed,
                    discount_pct: r.discount_pct,
                    discount_target_line_ids: null,
                  })),
                  error: null,
                });
              }
              return {
                single: vi.fn(async () => ({ data: null, error: null })),
              };
            }),
          })),
          update: vi.fn((values: Record<string, unknown>) => ({
            eq: vi.fn(async (_col: string, id: string) => {
              writes.push({ op: "update", table, values, id });
              const row = opts.recomputeRows.find((r) => r.id === id);
              if (row && typeof values.unit_price_cents === "number") {
                row.unit_price_cents = values.unit_price_cents;
              }
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

    return { fromSpy, writes };
  }

  it("(049 a) targetLineIds=[] → DiscountInvalidError{reason:'scope_empty'}", async () => {
    makeMockClientWithScopeLookup({
      ticketStatus: "open",
      recomputeRows: [],
      scopeRows: [],
    });

    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "percent",
        value: 10,
        targetLineIds: [],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("scope_empty");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(049 b) targetLineIds=[dup, dup] dedupes to [dup] (non-empty, accepted)", async () => {
    // A single duplicate-only array dedupes to one entry — non-empty after
    // dedupe, so it must NOT throw scope_empty. The resolver then accepts
    // the single id as a real service row on this ticket.
    const recomputeRows: RecomputeRow[] = [
      {
        id: SERVICE_LINE_ID,
        kind: "service",
        unit_price_cents: 5000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
      {
        id: NEW_LINE_ID,
        kind: "discount",
        unit_price_cents: 0,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: 10,
      },
    ];
    makeMockClientWithScopeLookup({
      ticketStatus: "open",
      recomputeRows,
      scopeRows: [{ id: SERVICE_LINE_ID, ticket_id: TICKET_ID, kind: "service" }],
    });

    const result = await addDiscountLine({
      ticketId: TICKET_ID,
      shape: "percent",
      value: 10,
      targetLineIds: [SERVICE_LINE_ID, SERVICE_LINE_ID],
    });
    expect(result.lineId).toBe(NEW_LINE_ID);
    // Audit fired with scope present + the deduped id list.
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [, , , payload] = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({
      scope: { kind: "selected_services", line_ids: [SERVICE_LINE_ID] },
    });
  });

  it("(049 c) targetLineIds with an unknown id → DiscountInvalidError{reason:'scope_target_unknown'}", async () => {
    makeMockClientWithScopeLookup({
      ticketStatus: "open",
      recomputeRows: [],
      // Scope-lookup returns ONLY the known id; UNKNOWN_LINE_ID is not in
      // ticket_items at all.
      scopeRows: [{ id: SERVICE_LINE_ID, ticket_id: TICKET_ID, kind: "service" }],
    });

    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "percent",
        value: 10,
        targetLineIds: [SERVICE_LINE_ID, UNKNOWN_LINE_ID],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("scope_target_unknown");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(049 d) targetLineIds with an id from another ticket → DiscountInvalidError{reason:'scope_off_ticket'}", async () => {
    makeMockClientWithScopeLookup({
      ticketStatus: "open",
      recomputeRows: [],
      // The id exists in ticket_items but on a DIFFERENT ticket.
      scopeRows: [
        {
          id: OFF_TICKET_LINE_ID,
          ticket_id: "99999999-9999-9999-9999-999999999999",
          kind: "service",
        },
      ],
    });

    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "percent",
        value: 10,
        targetLineIds: [OFF_TICKET_LINE_ID],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("scope_off_ticket");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(049 e) targetLineIds pointing at a discount row → DiscountInvalidError{reason:'scope_target_unknown'}", async () => {
    // A discount target must resolve to a kind='service' row. Pointing at
    // an existing same-ticket discount row is "unknown" from the service-
    // target resolver's perspective.
    makeMockClientWithScopeLookup({
      ticketStatus: "open",
      recomputeRows: [],
      scopeRows: [{ id: OTHER_SERVICE_LINE_ID, ticket_id: TICKET_ID, kind: "discount" }],
    });

    let caught: unknown = null;
    try {
      await addDiscountLine({
        ticketId: TICKET_ID,
        shape: "percent",
        value: 10,
        targetLineIds: [OTHER_SERVICE_LINE_ID],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("scope_target_unknown");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(049 f) scoped success — writes discount_target_line_ids on insert and emits scope in audit", async () => {
    const recomputeRows: RecomputeRow[] = [
      {
        id: SERVICE_LINE_ID,
        kind: "service",
        unit_price_cents: 6000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
      {
        id: OTHER_SERVICE_LINE_ID,
        kind: "service",
        unit_price_cents: 4000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
      {
        id: NEW_LINE_ID,
        kind: "discount",
        unit_price_cents: 0,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: 50,
      },
    ];
    const { writes } = makeMockClientWithScopeLookup({
      ticketStatus: "open",
      recomputeRows,
      scopeRows: [{ id: SERVICE_LINE_ID, ticket_id: TICKET_ID, kind: "service" }],
    });

    const result = await addDiscountLine({
      ticketId: TICKET_ID,
      shape: "percent",
      value: 50,
      targetLineIds: [SERVICE_LINE_ID],
    });

    expect(result.lineId).toBe(NEW_LINE_ID);

    // Insert carried the scope column.
    const insert = writes.find((w) => w.op === "insert" && w.table === "ticket_items");
    expect(insert).toBeDefined();
    expect(insert!.values).toMatchObject({
      ticket_id: TICKET_ID,
      kind: "discount",
      discount_pct: 50,
      discount_target_line_ids: [SERVICE_LINE_ID],
    });

    // Audit payload carries scope (only on scoped — unscoped passes omitted).
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [verb, , entityId, payload] = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(verb).toBe("discount.added");
    expect(entityId).toBe(NEW_LINE_ID);
    expect(payload).toMatchObject({
      ticket_id: TICKET_ID,
      shape: "percent",
      value: 50,
      scope: { kind: "selected_services", line_ids: [SERVICE_LINE_ID] },
    });
  });

  it("(049 g) unscoped (targetLineIds omitted) → audit payload has NO scope key", async () => {
    const recomputeRows: RecomputeRow[] = [
      {
        id: SERVICE_LINE_ID,
        kind: "service",
        unit_price_cents: 5000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
      {
        id: NEW_LINE_ID,
        kind: "discount",
        unit_price_cents: -500,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
      },
    ];
    makeMockClientWithScopeLookup({
      ticketStatus: "open",
      recomputeRows,
    });

    await addDiscountLine({
      ticketId: TICKET_ID,
      shape: "flat",
      value: 500,
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [, , , payload] = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).not.toHaveProperty("scope");
  });
});
