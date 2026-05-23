// @vitest-environment node

// Unit test for `editDiscountLine` (T027 / feature 049-per-service-discount).
//
// Contract: `specs/049-per-service-discount/contracts/server-actions.md § 2`.
// Validation order: ticketId+lineId uuid → shape/value/note → scope shape →
// scope membership → kind='discount' on this ticket. The action emits a
// `discount.edited` audit row with `before` + `after` blocks per
// `data-model.md § 6`.
//
// We mock the supabase service-role client, requireStudioSession, recordAudit
// end-to-end so the test never touches the network — mirrors the
// add-discount-line-action.test.ts pattern.

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

import { editDiscountLine } from "@/app/(studio)/checkout/actions";
import { DiscountInvalidError, TicketNotOpenError } from "@/app/(studio)/checkout/_errors";

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const LINE_ID = "33333333-3333-3333-3333-333333333333";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const DEVICE_USER_ID = "00000000-0000-0000-0000-000000000001";

const SERVICE_LINE_ID_1 = "44444444-4444-4444-4444-444444444444";
const SERVICE_LINE_ID_2 = "55555555-5555-5555-5555-555555555555";
const UNKNOWN_LINE_ID = "77777777-7777-7777-7777-777777777777";
const OFF_TICKET_LINE_ID = "66666666-6666-6666-6666-666666666666";

type RecomputeRow = {
  id: string;
  kind: "service" | "discount";
  unit_price_cents: number;
  qty: number;
  price_unconfirmed: boolean;
  discount_pct: number | null;
  discount_target_line_ids?: string[] | null;
};

type DiscountRowSnapshot = {
  id: string;
  ticket_id: string;
  kind: "discount" | "service";
  unit_price_cents: number;
  qty: number;
  discount_pct: number | null;
  note: string | null;
  discount_target_line_ids: string[] | null;
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
 *   2. ticket_items.select("id, ticket_id, kind, unit_price_cents, qty, discount_pct, note, discount_target_line_ids").eq("id", lineId).single → existing line
 *   3. (scope) ticket_items.select("id, ticket_id, kind").in("id", ids) → resolver rows
 *   4. ticket_items.update({...}).eq("id", lineId) → applied
 *   5. ticket_items.select(...).eq("ticket_id", ticketId) → recompute rows
 *   6. ticket_items.update({...}).eq("id", row.id) → drifted recompute writes
 *   7. tickets.update({subtotal_cents,total_cents}).eq("id", ticketId)
 */
function makeMockClient(opts: {
  ticketStatus: "open" | "paid" | "discarded";
  /** Existing line returned by the "read the named line" select. */
  existingLine: DiscountRowSnapshot | null;
  /** Rows the scope resolver returns. */
  scopeRows?: Array<{ id: string; ticket_id: string; kind: "service" | "discount" }>;
  /** Rows the recompute SELECT returns AFTER the update. */
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
      // discardDraftLegs no-op: no in-flight or draft legs.
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
        select: vi.fn(() => ({
          // (b) Scope resolver: .in("id", ids)
          in: vi.fn(async (_col: string, _ids: string[]) => ({
            data: opts.scopeRows ?? [],
            error: null,
          })),
          // (a) Single-line read: .eq("id", lineId).single()
          // (c) Recompute: .eq("ticket_id", ticketId) (returns promise directly)
          eq: vi.fn((col: string, _value: string) => {
            if (col === "id") {
              return {
                single: vi.fn(async () => {
                  if (!opts.existingLine) {
                    return { data: null, error: { message: "not found" } };
                  }
                  return {
                    data: opts.existingLine,
                    error: null,
                  };
                }),
              };
            }
            if (col === "ticket_id") {
              return Promise.resolve({
                data: opts.recomputeRows.map((r) => ({
                  id: r.id,
                  kind: r.kind,
                  unit_price_cents: r.unit_price_cents,
                  qty: r.qty,
                  price_unconfirmed: r.price_unconfirmed,
                  discount_pct: r.discount_pct,
                  discount_target_line_ids: r.discount_target_line_ids ?? null,
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
            // Mutate the recompute snapshot so subsequent inspections reflect
            // per-row UPDATEs (recompute writes).
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

function defaultExistingFlatLine(): DiscountRowSnapshot {
  return {
    id: LINE_ID,
    ticket_id: TICKET_ID,
    kind: "discount",
    unit_price_cents: -1000,
    qty: 1,
    discount_pct: null,
    note: "Loyalty perk",
    discount_target_line_ids: null,
  };
}

function defaultRecomputeRowsAfterFlatEdit(amount: number): RecomputeRow[] {
  return [
    {
      id: SERVICE_LINE_ID_1,
      kind: "service",
      unit_price_cents: 5000,
      qty: 1,
      price_unconfirmed: false,
      discount_pct: null,
      discount_target_line_ids: null,
    },
    {
      id: LINE_ID,
      kind: "discount",
      unit_price_cents: -amount,
      qty: 1,
      price_unconfirmed: false,
      discount_pct: null,
      discount_target_line_ids: null,
    },
  ];
}

describe("editDiscountLine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(1) invalid shape → DiscountInvalidError (treated as flat_value_non_positive bucket)", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        // @ts-expect-error invalid shape
        shape: "bogus",
        value: 500,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(2) flat value ≤ 0 → DiscountInvalidError{reason:'flat_value_non_positive'}", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
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

  it("(3) percent ∉ [1,100] → DiscountInvalidError{reason:'percent_out_of_range'}", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
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

  it("(4) note > 80 chars → DiscountInvalidError{reason:'note_too_long'}", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        shape: "flat",
        value: 500,
        note: "x".repeat(81),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("note_too_long");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(5) targetLineIds=[] → DiscountInvalidError{reason:'scope_empty'}", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
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

  it("(6) targetLineIds with an unknown id → DiscountInvalidError{reason:'scope_target_unknown'}", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      // Resolver sees only the known id; UNKNOWN_LINE_ID isn't in ticket_items.
      scopeRows: [{ id: SERVICE_LINE_ID_1, ticket_id: TICKET_ID, kind: "service" }],
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        shape: "percent",
        value: 10,
        targetLineIds: [SERVICE_LINE_ID_1, UNKNOWN_LINE_ID],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("scope_target_unknown");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(7) targetLineIds with an id on another ticket → DiscountInvalidError{reason:'scope_off_ticket'}", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      scopeRows: [
        {
          id: OFF_TICKET_LINE_ID,
          ticket_id: "99999999-9999-9999-9999-999999999999",
          kind: "service",
        },
      ],
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
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

  it("(8) lineId points at a service row → DiscountInvalidError{reason:'not_a_discount_line'}", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: {
        id: LINE_ID,
        ticket_id: TICKET_ID,
        kind: "service",
        unit_price_cents: 5000,
        qty: 1,
        discount_pct: null,
        note: null,
        discount_target_line_ids: null,
      },
      recomputeRows: [],
    });

    let caught: unknown = null;
    try {
      await editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        shape: "flat",
        value: 500,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiscountInvalidError);
    expect((caught as DiscountInvalidError).reason).toBe("not_a_discount_line");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("(9) happy path — flat edit with scope going from null → [svc-1]: audit before/after matches contract", async () => {
    makeMockClient({
      ticketStatus: "open",
      existingLine: defaultExistingFlatLine(),
      scopeRows: [{ id: SERVICE_LINE_ID_1, ticket_id: TICKET_ID, kind: "service" }],
      recomputeRows: defaultRecomputeRowsAfterFlatEdit(800),
    });

    const result = await editDiscountLine({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      shape: "flat",
      value: 800,
      note: "Updated perk",
      targetLineIds: [SERVICE_LINE_ID_1],
    });

    expect(result.subtotalCents).toBe(5000 - 800);
    expect(result.totalCents).toBe(5000 - 800);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [verb, deviceUserId, entityId, payload, actingAsStaffId] = (
      recordAudit as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(verb).toBe("discount.edited");
    expect(deviceUserId).toBe(DEVICE_USER_ID);
    expect(entityId).toBe(LINE_ID);
    expect(actingAsStaffId).toBe(STAFF_ID);
    expect(payload).toMatchObject({
      ticket_id: TICKET_ID,
      before: {
        shape: "flat",
        value: 1000,
        note: "Loyalty perk",
        scope: null,
      },
      after: {
        shape: "flat",
        value: 800,
        note: "Updated perk",
        scope: { kind: "selected_services", line_ids: [SERVICE_LINE_ID_1] },
      },
    });
  });

  it("(10) happy path — percent edit, scope going from [svc-1, svc-2] → null: audit before/after matches contract", async () => {
    const existing: DiscountRowSnapshot = {
      id: LINE_ID,
      ticket_id: TICKET_ID,
      kind: "discount",
      unit_price_cents: 0,
      qty: 1,
      discount_pct: 15,
      note: null,
      discount_target_line_ids: [SERVICE_LINE_ID_1, SERVICE_LINE_ID_2],
    };
    const recomputeRows: RecomputeRow[] = [
      {
        id: SERVICE_LINE_ID_1,
        kind: "service",
        unit_price_cents: 5000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
        discount_target_line_ids: null,
      },
      {
        id: SERVICE_LINE_ID_2,
        kind: "service",
        unit_price_cents: 3000,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: null,
        discount_target_line_ids: null,
      },
      {
        id: LINE_ID,
        kind: "discount",
        unit_price_cents: 0,
        qty: 1,
        price_unconfirmed: false,
        discount_pct: 20,
        discount_target_line_ids: null,
      },
    ];
    makeMockClient({
      ticketStatus: "open",
      existingLine: existing,
      recomputeRows,
    });

    const result = await editDiscountLine({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      shape: "percent",
      value: 20,
      targetLineIds: null,
    });

    // 20% of 8000 = 1600. subtotal = 8000 - 1600 = 6400.
    expect(result.subtotalCents).toBe(6400);
    expect(result.totalCents).toBe(6400);

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [verb, , , payload] = (recordAudit as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(verb).toBe("discount.edited");
    expect(payload).toMatchObject({
      ticket_id: TICKET_ID,
      before: {
        shape: "percent",
        value: 15,
        note: null,
        scope: {
          kind: "selected_services",
          line_ids: [SERVICE_LINE_ID_1, SERVICE_LINE_ID_2],
        },
      },
      after: {
        shape: "percent",
        value: 20,
        note: null,
        scope: null,
      },
    });
  });

  it("refuses with TicketNotOpenError when the ticket is paid", async () => {
    makeMockClient({
      ticketStatus: "paid",
      existingLine: defaultExistingFlatLine(),
      recomputeRows: [],
    });

    await expect(
      editDiscountLine({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        shape: "flat",
        value: 500,
      })
    ).rejects.toBeInstanceOf(TicketNotOpenError);

    expect(recordAudit).not.toHaveBeenCalled();
  });
});
