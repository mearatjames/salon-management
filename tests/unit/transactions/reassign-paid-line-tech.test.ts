// Unit tests for `reassignPaidLineTech` in
// `app/(studio)/transactions/actions.ts`.
//
// Coverage (Phase 3 / US1):
//   (a) writes exactly one audit row with action='ticket.line_tech_reassigned'
//   (b) audit payload matches FR-011 shape (ticket_id, previous_staff_id,
//       new_staff_id, closed_at, pay_period_start; acting_as_staff_id on the
//       row itself, via recordAudit's 5th arg)
//   (c) writes audit with previous_staff_id null when the line was unassigned
//   (d) no-op when input equals current — no UPDATE, no audit row, no
//       revalidatePath
//   (e) leaves all monetary and identity fields untouched — snapshot
//       ticket_items row before/after, assert only assigned_staff_id differs
//
// Constitution Principle IV — tests authored BEFORE the implementation;
// MUST fail with "module not found" on first run, then pass once T010
// lands `app/(studio)/transactions/actions.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks (declared before SUT import) ──────────────────────────────────────

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireStudioSession: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/db/settings", () => ({
  getSalonTimezone: vi.fn(async () => "America/Los_Angeles"),
}));

vi.mock("@/lib/payroll/finalized", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/payroll/finalized")>("@/lib/payroll/finalized");
  return {
    ...actual,
    // isPayPeriodFinalized is the only DB-touching export — replace it with a
    // mock so the test can stub finalized true/false independently of the
    // ticket fixture.
    isPayPeriodFinalized: vi.fn(async () => false),
  };
});

// ─── Imports of the SUT and the mocked modules ───────────────────────────────

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { isPayPeriodFinalized } from "@/lib/payroll/finalized";
import { revalidatePath } from "next/cache";

import { reassignPaidLineTech } from "@/app/(studio)/transactions/actions";
import {
  PayPeriodFinalizedError,
  PermissionDeniedError,
  StaffNotActiveError,
  TicketNotPaidError,
  TicketOrLineNotFoundError,
} from "@/app/(studio)/transactions/_errors";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TICKET_ID = "11111111-1111-1111-1111-111111111111";
const LINE_ID = "22222222-2222-2222-2222-222222222222";
const PREV_STAFF_ID = "33333333-3333-3333-3333-333333333333";
const NEW_STAFF_ID = "44444444-4444-4444-4444-444444444444";

const OWNER_VIEWER: StudioViewer = {
  deviceUserId: "device-owner-1",
  staff: {
    id: "staff-owner-1",
    display_name: "Test Owner",
    role: "owner",
    color_token: "--avatar-rose",
  },
};

// A ticket fixture whose closed_at sits squarely inside the 2026-05-16…
// 2026-05-31 half-month period.
const PAID_TICKET = {
  id: TICKET_ID,
  status: "paid",
  closed_at: "2026-05-20T20:00:00.000Z",
};

// All non-`assigned_staff_id` columns we read from `ticket_items` for the
// "no monetary field touched" snapshot (test e). The implementation's read
// list may be tighter — we project these from the fixture's `selectAll`
// return so the assertion is row-shape-faithful.
type TicketItemRow = {
  id: string;
  ticket_id: string;
  kind: string;
  qty: number;
  unit_price_cents: number;
  name_snapshot: string;
  ref_id: string | null;
  assigned_staff_id: string | null;
  discount_target_line_ids: readonly string[] | null;
};

const BASE_ITEM: TicketItemRow = {
  id: LINE_ID,
  ticket_id: TICKET_ID,
  kind: "service",
  qty: 1,
  unit_price_cents: 4500,
  name_snapshot: "Classic manicure",
  ref_id: "svc-mani-1",
  assigned_staff_id: PREV_STAFF_ID,
  discount_target_line_ids: null,
};

type AdminMockOpts = {
  ticket?: typeof PAID_TICKET | null;
  staff?: { id: string; active: boolean } | null;
  item?: TicketItemRow | null;
};

type AdminCounts = {
  updateCalls: Array<{ table: string; values: Record<string, unknown>; id: string }>;
  reads: Array<{ table: string; eqCol: string; eqVal: string }>;
};

function mockAdminClient(opts: AdminMockOpts = {}): AdminCounts {
  const updateCalls: AdminCounts["updateCalls"] = [];
  const reads: AdminCounts["reads"] = [];

  const ticket = opts.ticket === undefined ? PAID_TICKET : opts.ticket;
  const staff = opts.staff === undefined ? { id: NEW_STAFF_ID, active: true } : opts.staff;
  const item = opts.item === undefined ? BASE_ITEM : opts.item;

  function selectFor(table: string) {
    return {
      // The select() call is chained as either .select(...).eq(...).single()
      // or .select(...).eq(...).maybeSingle(). Return a chainable shape that
      // supports both.
      select(_cols: string) {
        return {
          eq(col: string, val: string) {
            reads.push({ table, eqCol: col, eqVal: val });
            const data =
              table === "tickets"
                ? ticket
                : table === "staff"
                  ? staff
                  : table === "ticket_items"
                    ? item
                    : null;
            const notFound = data === null;
            return {
              async single() {
                if (notFound) return { data: null, error: { message: "not found" } };
                return { data, error: null };
              },
              async maybeSingle() {
                if (notFound) return { data: null, error: null };
                return { data, error: null };
              },
            };
          },
        };
      },
      update(values: Record<string, unknown>) {
        return {
          async eq(col: string, val: string) {
            updateCalls.push({ table, values, id: val });
            return { error: null };
          },
        };
      },
    };
  }

  (createSupabaseServiceRoleClient as unknown as Mocked<() => unknown>).mockReturnValue({
    from: (table: string) => selectFor(table),
  });

  return { updateCalls, reads };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("reassignPaidLineTech — US1 (success path + audit shape + no-op)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
    (isPayPeriodFinalized as unknown as Mocked<() => Promise<boolean>>).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) writes exactly one audit row with action='ticket.line_tech_reassigned' (FR-010)", async () => {
    mockAdminClient();

    const result = await reassignPaidLineTech({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      newAssignedStaffId: NEW_STAFF_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledTimes(1);
    const call = (recordAudit as unknown as Mocked<typeof recordAudit>).mock.calls[0];
    expect(call[0]).toBe("ticket.line_tech_reassigned");
  });

  it("(b) audit payload matches FR-011 shape (ticket_id, previous_staff_id, new_staff_id, closed_at, pay_period_start)", async () => {
    mockAdminClient();

    await reassignPaidLineTech({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      newAssignedStaffId: NEW_STAFF_ID,
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [action, actorUserId, entityId, payload, actingAsStaffId] = (
      recordAudit as unknown as Mocked<typeof recordAudit>
    ).mock.calls[0];
    expect(action).toBe("ticket.line_tech_reassigned");
    expect(actorUserId).toBe(OWNER_VIEWER.deviceUserId);
    expect(entityId).toBe(LINE_ID);
    expect(actingAsStaffId).toBe(OWNER_VIEWER.staff.id);
    expect(payload).toEqual({
      ticket_id: TICKET_ID,
      previous_staff_id: PREV_STAFF_ID,
      new_staff_id: NEW_STAFF_ID,
      closed_at: PAID_TICKET.closed_at,
      pay_period_start: "2026-05-16",
    });
  });

  it("(c) writes audit with previous_staff_id null when the line was unassigned (FR-006)", async () => {
    mockAdminClient({ item: { ...BASE_ITEM, assigned_staff_id: null } });

    await reassignPaidLineTech({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      newAssignedStaffId: NEW_STAFF_ID,
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const payload = (recordAudit as unknown as Mocked<typeof recordAudit>).mock.calls[0][3] as {
      previous_staff_id: string | null;
    };
    expect(payload.previous_staff_id).toBeNull();
  });

  it("(d) no-op when input equals current — no UPDATE, no audit row, no revalidatePath (FR-013)", async () => {
    const counts = mockAdminClient({
      item: { ...BASE_ITEM, assigned_staff_id: NEW_STAFF_ID },
    });

    const result = await reassignPaidLineTech({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      newAssignedStaffId: NEW_STAFF_ID,
    });

    expect(result).toEqual({ ok: true });
    expect(counts.updateCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("(e) leaves all monetary and identity fields untouched — UPDATE sets only assigned_staff_id (FR-007, SC-006)", async () => {
    const counts = mockAdminClient();

    await reassignPaidLineTech({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      newAssignedStaffId: NEW_STAFF_ID,
    });

    expect(counts.updateCalls).toHaveLength(1);
    const update = counts.updateCalls[0];
    expect(update.table).toBe("ticket_items");
    expect(update.id).toBe(LINE_ID);
    // The single column written. No other key in the values payload.
    expect(Object.keys(update.values).sort()).toEqual(["assigned_staff_id"]);
    expect(update.values.assigned_staff_id).toBe(NEW_STAFF_ID);
  });

  it("on success, revalidates /transactions, /dashboard, /report, /payroll", async () => {
    mockAdminClient();

    await reassignPaidLineTech({
      ticketId: TICKET_ID,
      lineId: LINE_ID,
      newAssignedStaffId: NEW_STAFF_ID,
    });

    const calls = (revalidatePath as unknown as Mocked<typeof revalidatePath>).mock.calls.map(
      (c) => c[0]
    );
    expect(calls).toEqual(
      expect.arrayContaining(["/transactions", "/dashboard", "/report", "/payroll"])
    );
  });
});

// ─── US2 — non-privileged role gate ──────────────────────────────────────────
//
// FR-003, FR-012 (a), FR-014: every non-owner / non-manager StudioViewer
// role MUST be rejected at step 3 of the action (role check) — before any
// DB read, any UPDATE, any audit row, any revalidate. The StudioRole union
// in `lib/auth/session.ts` is exactly:
//
//   "owner" | "manager" | "technician" | "front_desk"
//
// so the two non-privileged values below cover the complete enumeration.

describe("reassignPaidLineTech — US2 (role gate — PermissionDeniedError)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (isPayPeriodFinalized as unknown as Mocked<() => Promise<boolean>>).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["technician", "front_desk"] as const)(
    "rejects %s viewers with PermissionDeniedError and writes nothing (FR-012 (a), FR-014)",
    async (role) => {
      (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue({
        ...OWNER_VIEWER,
        staff: { ...OWNER_VIEWER.staff, role },
      });
      const counts = mockAdminClient();

      await expect(
        reassignPaidLineTech({
          ticketId: TICKET_ID,
          lineId: LINE_ID,
          newAssignedStaffId: NEW_STAFF_ID,
        })
      ).rejects.toBeInstanceOf(PermissionDeniedError);

      // Zero side effects: no DB read, no UPDATE, no audit row, no revalidate.
      // (FR-014 — the server gate is the authority; FR-012 (a) — no audit on
      // rejection.)
      expect(counts.reads).toEqual([]);
      expect(counts.updateCalls).toEqual([]);
      expect(recordAudit).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );
});

// ─── US3 — remaining typed-error gates ───────────────────────────────────────
//
// Spec coverage:
//   - PayPeriodFinalizedError  → FR-002, FR-004, FR-012 (c)
//   - TicketNotPaidError       → FR-012 (b)
//   - StaffNotActiveError      → FR-005 race, FR-012 (d)
//   - TicketOrLineNotFoundError × 2 → FR-012 (e)
//
// Each: the action throws the typed error, no `UPDATE` is issued on
// `ticket_items`, no audit row is written, no `revalidatePath` runs.
//
// The viewer is owner for every case so the role gate (step 3) cannot
// short-circuit; the test isolates the specific downstream gate.

describe("reassignPaidLineTech — US3 (remaining typed-error gates)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireStudioSession as unknown as Mocked<() => Promise<StudioViewer>>).mockResolvedValue(
      OWNER_VIEWER
    );
    // Default: open period — individual tests override for the finalized branch.
    (isPayPeriodFinalized as unknown as Mocked<() => Promise<boolean>>).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PayPeriodFinalizedError when the period is finalized — no UPDATE, no audit (FR-002, FR-004, FR-012 (c))", async () => {
    // The action loads the ticket (step 5), passes the paid gate (step 6),
    // then calls `isPayPeriodFinalized` at step 8. We stub it `true` to
    // trip the finalized branch without going near the actual
    // pay_periods / payroll_payouts query chain.
    (isPayPeriodFinalized as unknown as Mocked<() => Promise<boolean>>).mockResolvedValue(true);
    const counts = mockAdminClient();

    await expect(
      reassignPaidLineTech({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        newAssignedStaffId: NEW_STAFF_ID,
      })
    ).rejects.toBeInstanceOf(PayPeriodFinalizedError);

    expect(counts.updateCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("TicketNotPaidError when the ticket is still open — no UPDATE, no audit (FR-012 (b))", async () => {
    // Ticket exists but its status is 'open' (not 'paid'). The paid-state
    // gate at step 6 must reject before any further read or write.
    const counts = mockAdminClient({
      ticket: { ...PAID_TICKET, status: "open" },
    });

    await expect(
      reassignPaidLineTech({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        newAssignedStaffId: NEW_STAFF_ID,
      })
    ).rejects.toBeInstanceOf(TicketNotPaidError);

    expect(counts.updateCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("StaffNotActiveError when the target staff is offboarded (active=false) — no UPDATE, no audit (FR-005 race, FR-012 (d))", async () => {
    // Race scenario: staff went inactive between drawer render and action
    // dispatch. Server gate at step 9 must reject; also covers the missing-
    // row branch (the implementation throws StaffNotActiveError on either
    // `!staff` OR `staff.active !== true` — both flow through the same
    // guard).
    const counts = mockAdminClient({
      staff: { id: NEW_STAFF_ID, active: false },
    });

    await expect(
      reassignPaidLineTech({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        newAssignedStaffId: NEW_STAFF_ID,
      })
    ).rejects.toBeInstanceOf(StaffNotActiveError);

    expect(counts.updateCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("TicketOrLineNotFoundError when the ticket row is missing — no UPDATE, no audit (FR-012 (e))", async () => {
    // Ticket id doesn't resolve — step 5 rejects before any other read.
    const counts = mockAdminClient({ ticket: null });

    await expect(
      reassignPaidLineTech({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        newAssignedStaffId: NEW_STAFF_ID,
      })
    ).rejects.toBeInstanceOf(TicketOrLineNotFoundError);

    expect(counts.updateCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("TicketOrLineNotFoundError when the line's ticket_id does not match input.ticketId — no UPDATE, no audit (FR-012 (e))", async () => {
    // Line exists but belongs to a different ticket. Step 10 catches the
    // mismatch and rejects.
    const counts = mockAdminClient({
      item: { ...BASE_ITEM, ticket_id: "99999999-9999-9999-9999-999999999999" },
    });

    await expect(
      reassignPaidLineTech({
        ticketId: TICKET_ID,
        lineId: LINE_ID,
        newAssignedStaffId: NEW_STAFF_ID,
      })
    ).rejects.toBeInstanceOf(TicketOrLineNotFoundError);

    expect(counts.updateCalls).toEqual([]);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
