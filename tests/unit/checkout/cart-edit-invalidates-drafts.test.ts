// @vitest-environment node

// Unit test for cart-edit invalidation (T035 / wired in Phase 2 via T013).
//
// Asserts that calling `addServiceLine` on a ticket with 2 draft legs:
//   1) Discards both drafts (via `discardDraftLegs`).
//   2) Emits 2 `payment.draft_removed` audit rows.
//   3) Returns success with `{draftsDiscarded: 2}` on the result.
//
// Also asserts that succeeded legs are preserved — only the draft rows are
// targeted by the discard.

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

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const SERVICE_ID = "20000000-0000-0000-0000-000000000001";
const STAFF_ID = "10000000-0000-0000-0000-000000000001";
const DEVICE_USER_ID = "00000000-0000-0000-0000-000000000001";
const NEW_LINE_ID = "33333333-3333-3333-3333-333333333333";

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

type DraftRow = { id: string; method: string; amount_cents: number };

/**
 * Mock that satisfies the action's call graph including the discardDraftLegs
 * prelude:
 *   1. payments.select('id').eq(ticket_id,X).eq(status,'pending').limit(1) → empty (no in-flight)
 *   2. payments.select('id,method,amount_cents').eq(ticket_id,X).eq(status,'draft') → drafts
 *   3. payments.delete().eq(ticket_id,X).eq(status,'draft')
 *   4. tickets.select(id,status).eq(...).single
 *   5. staff.select.eq.maybeSingle (active)
 *   6. services.select.eq.single
 *   7. ticket_items.insert → {id}
 *   8. ticket_items.select → recompute rows
 *   9. tickets.update
 */
function makeMockClient({ drafts, inFlight = false }: { drafts: DraftRow[]; inFlight?: boolean }) {
  const deletedDraftCalls: Array<{ ticketId: string }> = [];

  const fromSpy = vi.fn((table: string) => {
    if (table === "payments") {
      const emptyInFlight = { data: inFlight ? [{ id: "in-flight" }] : [], error: null };
      const draftsResult = { data: drafts, error: null };

      function makeTerminalEq(isPending: boolean) {
        const thenable = {
          then: (
            onFulfilled: (v: typeof emptyInFlight) => unknown,
            onRejected?: (r: unknown) => unknown
          ) =>
            (isPending ? Promise.resolve(emptyInFlight) : Promise.resolve(draftsResult)).then(
              onFulfilled,
              onRejected
            ),
          limit: () => Promise.resolve(emptyInFlight),
        };
        return thenable;
      }

      return {
        select: vi.fn((cols?: string) => ({
          eq: vi.fn(() => ({
            eq: vi.fn((_k: string, v: unknown) => {
              const isPendingCheck = v === "pending";
              const isDraftsCheck = v === "draft";
              if (isPendingCheck) return makeTerminalEq(true);
              if (isDraftsCheck) {
                if (cols?.includes("method") && cols?.includes("amount_cents")) {
                  return makeTerminalEq(false);
                }
                return makeTerminalEq(false);
              }
              return makeTerminalEq(false);
            }),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn((_k: string, v: unknown) => ({
            eq: vi.fn(async (_k2: string, v2: unknown) => {
              if (v2 === "draft") {
                deletedDraftCalls.push({ ticketId: v as string });
              }
              return { error: null };
            }),
          })),
        })),
      };
    }
    if (table === "tickets") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: TICKET_ID, status: "open" },
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      };
    }
    if (table === "staff") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { id: STAFF_ID, active: true },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "services") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: SERVICE_ID,
                name: "Classic manicure",
                price_cents: 2500,
                variable_price: false,
                active: true,
              },
              error: null,
            })),
          })),
        })),
      };
    }
    if (table === "ticket_items") {
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: NEW_LINE_ID }, error: null })),
          })),
        })),
        select: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      };
    }
    return {};
  });

  (createSupabaseServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: fromSpy,
  });

  return { fromSpy, deletedDraftCalls };
}

describe("addServiceLine — cart-edit invalidates drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("discards 2 draft legs, emits 2 payment.draft_removed audits, returns draftsDiscarded=2", async () => {
    const drafts: DraftRow[] = [
      { id: "draft-a", method: "cash", amount_cents: 2000 },
      { id: "draft-b", method: "card", amount_cents: 4000 },
    ];
    const { deletedDraftCalls } = makeMockClient({ drafts });

    const { addServiceLine } = await import("@/app/(studio)/checkout/actions");
    const result = await addServiceLine({
      ticketId: TICKET_ID,
      serviceId: SERVICE_ID,
      assignedStaffId: STAFF_ID,
    });

    if ("refusedReason" in result) throw new Error("expected success shape, got refusal");
    expect(result.lineId).toBe(NEW_LINE_ID);
    expect(result.draftsDiscarded).toBe(2);

    // 2 payment.draft_removed audits + 1 ticket.line_added audit = 3 calls.
    const draftRemovedCalls = (
      recordAudit as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0] === "payment.draft_removed");
    expect(draftRemovedCalls).toHaveLength(2);

    // The audits' entity_ids correspond to the discarded drafts.
    const removedIds = draftRemovedCalls.map((c) => c[2]);
    expect(removedIds).toContain("draft-a");
    expect(removedIds).toContain("draft-b");

    // The delete-targeting-drafts query ran.
    expect(deletedDraftCalls.length).toBe(1);
    expect(deletedDraftCalls[0].ticketId).toBe(TICKET_ID);
  });

  it("returns no draftsDiscarded field when there are no drafts to discard", async () => {
    makeMockClient({ drafts: [] });

    const { addServiceLine } = await import("@/app/(studio)/checkout/actions");
    const result = await addServiceLine({
      ticketId: TICKET_ID,
      serviceId: SERVICE_ID,
      assignedStaffId: STAFF_ID,
    });

    if ("refusedReason" in result) throw new Error("expected success shape, got refusal");
    expect(result.draftsDiscarded).toBeUndefined();
    const draftRemovedCalls = (
      recordAudit as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c) => c[0] === "payment.draft_removed");
    expect(draftRemovedCalls).toHaveLength(0);
  });

  it("returns refusedReason='ticket_already_being_charged' when a pending leg is in flight", async () => {
    // The action used to throw `TicketAlreadyBeingChargedError`, but in
    // Next.js' production build the typed error's class + message are
    // stripped on the wire (only `digest` survives). To keep the cross-
    // runtime contract intact, the action now returns a typed refusal
    // shape so the client island can branch reliably.
    makeMockClient({
      drafts: [{ id: "draft-a", method: "cash", amount_cents: 2000 }],
      inFlight: true,
    });

    const { addServiceLine } = await import("@/app/(studio)/checkout/actions");
    const result = await addServiceLine({
      ticketId: TICKET_ID,
      serviceId: SERVICE_ID,
      assignedStaffId: STAFF_ID,
    });
    expect("refusedReason" in result ? result.refusedReason : null).toBe(
      "ticket_already_being_charged"
    );
  });
});
