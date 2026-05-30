"use server";

// Server Action layer for the Payroll page (feature 047, US3).
//
// `recordPayout` and `undoPayout` are the write surface for marking a
// technician paid for an open pay period. Both follow the established prelude
// (see `app/(studio)/end-of-day/actions.ts`):
//   1. `requireStudioSession()` → viewer (throws `AuthRedirectError` if
//      unauthenticated).
//   2. Role gate — owner | manager only; anything else → `FORBIDDEN`.
//   3. Parse + validate input.
//   4. Recompute the tech's payroll figures FRESH server-side via
//      `lib/payroll` — the client is never trusted with money (FR-024).
//   5. Call the SECURITY DEFINER RPC via the service-role client.
//   6. Map any Postgres error to a documented result code.
//   7. `revalidatePath()` the ledger + detail routes.
//   8. Return a discriminated result.
//
// Contract: specs/047-payroll-page/contracts/server-actions.md.

import { revalidatePath } from "next/cache";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalonTimezone } from "@/lib/db/settings";
import { loadPayrollLedger } from "@/lib/payroll/queries";
import { salonNow } from "@/lib/time/period-windows";
import { salonDateString } from "@/lib/time/format";

// ─── Result types ───────────────────────────────────────────────────────────

export type PayrollErrorCode =
  | "FORBIDDEN"
  | "PERIOD_CLOSED"
  | "ALREADY_PAID"
  | "NOT_PAID"
  | "INVALID"
  | "UNEXPECTED";

// `T` defaults to an empty object literal — `{ ok: true } & {}` is just
// `{ ok: true }`, so `undoPayout` can return a bare `{ ok: true }`. (An
// indexed `Record<string, never>` would make `ok` collide with the index
// signature; the empty object literal is the right "no extra fields" shape.)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ActionResult<T = {}> =
  | ({ ok: true } & T)
  | { ok: false; code: PayrollErrorCode; message: string };

const PAYOUT_METHODS = new Set(["cash", "zelle", "check"] as const);
type PayoutMethod = "cash" | "zelle" | "check";

const ROLES_ALLOWED = new Set(["owner", "manager"]);

export type RecordPayoutInput = {
  payPeriodId: string;
  staffId: string;
  method: PayoutMethod;
};

export type UndoPayoutInput = {
  payPeriodId: string;
  staffId: string;
};

export type ClosePeriodInput = {
  payPeriodId: string;
  /** `true` once the owner has confirmed the unpaid-techs warning. */
  confirmedUnpaid: boolean;
};

export type AddAdjustmentInput = {
  payPeriodId: string;
  staffId: string;
  /** Signed integer cents — positive adds, negative deducts. Never 0. */
  amountCents: number;
  /** Free-text reason, trimmed to 1–80 chars. */
  reason: string;
};

export type EditAdjustmentInput = {
  adjustmentId: string;
  amountCents: number;
  reason: string;
};

export type DeleteAdjustmentInput = {
  adjustmentId: string;
};

// Adjustment amount + reason validation, shared by add + edit. Amount is an
// integer cents value ≠ 0; reason is trimmed to 1–80 characters.
const ADJ_REASON_MAX = 80;
function validateAdjustment(amountCents: number, reason: string): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (
    !Number.isInteger(amountCents) ||
    amountCents === 0 ||
    trimmed.length < 1 ||
    trimmed.length > ADJ_REASON_MAX
  ) {
    return null;
  }
  return trimmed;
}

// ─── Postgres-error → result-code mapping ───────────────────────────────────
//
// The DEFINER RPCs `raise exception '<token>'` with errcode P0001; the token
// arrives in `error.message`. `payroll_cash_mismatch` should be impossible
// here — both the action and the RPC re-derive cash the same way — so it is
// logged as a server bug and surfaced as a generic failure.
function mapRpcError(error: { message?: string | null }): {
  code: PayrollErrorCode;
  message: string;
} {
  const msg = error.message ?? "";
  if (msg.includes("payroll_period_not_open")) {
    return {
      code: "PERIOD_CLOSED",
      message: "This pay period is closed — payouts can no longer change.",
    };
  }
  if (msg.includes("payroll_payout_exists")) {
    return {
      code: "ALREADY_PAID",
      message: "This technician is already marked paid for the period.",
    };
  }
  if (msg.includes("payroll_payout_missing")) {
    return {
      code: "NOT_PAID",
      message: "This technician has no recorded payout to undo.",
    };
  }
  if (msg.includes("payroll_adjustment_missing")) {
    return {
      code: "INVALID",
      message: "That adjustment no longer exists.",
    };
  }
  // The adjustment RPCs validate amount / reason as a backstop — the action
  // validates first, so this should never surface to a user.
  if (msg.includes("payroll_invalid")) {
    return {
      code: "INVALID",
      message: "That adjustment is not valid.",
    };
  }
  if (msg.includes("payroll_cash_mismatch")) {
    console.error("payroll recordPayout cash mismatch — server bug", error);
    return { code: "UNEXPECTED", message: "Could not record the payout." };
  }
  console.error("payroll RPC failed", error);
  return { code: "UNEXPECTED", message: "Could not complete the request." };
}

// ─── recordPayout ───────────────────────────────────────────────────────────

/**
 * Records a technician's payout for an open pay period.
 *
 * The payout snapshot is recomputed FRESH from the current rates + ticket data
 * — the client only names the tech, the period, and the method. An ineligible
 * tech (zero earnings — a `no_work` row) is refused with `INVALID` before any
 * RPC call; the RPC additionally re-derives cash and rejects a mismatch.
 */
export async function recordPayout(
  input: RecordPayoutInput
): Promise<ActionResult<{ payoutId: string }>> {
  // 1. Viewer + role gate.
  const viewer = await requireStudioSession();
  if (!ROLES_ALLOWED.has(viewer.staff.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners and managers can record payouts.",
    };
  }

  // 2. Validate input shape.
  if (
    typeof input.payPeriodId !== "string" ||
    input.payPeriodId === "" ||
    typeof input.staffId !== "string" ||
    input.staffId === "" ||
    !PAYOUT_METHODS.has(input.method)
  ) {
    return { ok: false, code: "INVALID", message: "Invalid payout request." };
  }

  // 3. Recompute the tech's payroll figures fresh for the open period window.
  //    `loadPayrollLedger` resolves the open period (offset 0) and projects
  //    every active tech's figures from live ticket data — the same path
  //    `/payroll` renders, so the snapshot is authoritative.
  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);
  const ledger = await loadPayrollLedger(supabase, tz, 0);

  // The action only ever pays the open period — guard against a stale id.
  if (ledger.period.id !== input.payPeriodId) {
    return {
      ok: false,
      code: "PERIOD_CLOSED",
      message: "This pay period is closed — payouts can no longer change.",
    };
  }
  if (ledger.readOnly) {
    return {
      ok: false,
      code: "PERIOD_CLOSED",
      message: "This pay period is closed — payouts can no longer change.",
    };
  }

  const row = ledger.rows.find((r) => r.staffId === input.staffId);
  if (!row) {
    return { ok: false, code: "INVALID", message: "Technician not found in this period." };
  }
  if (row.state === "no_work") {
    return {
      ok: false,
      code: "INVALID",
      message: "This technician has no earnings to pay this period.",
    };
  }
  if (row.state === "paid") {
    return {
      ok: false,
      code: "ALREADY_PAID",
      message: "This technician is already marked paid for the period.",
    };
  }

  // `paid_on` is today in the salon timezone (SALON_TZ via salon settings).
  const paidOn = salonDateString(tz, salonNow(tz));

  // 4. Call the record RPC with the freshly computed snapshot.
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc("payroll_record_payout", {
    p_pay_period_id: input.payPeriodId,
    p_staff_id: input.staffId,
    p_method: input.method,
    p_paid_on: paidOn,
    p_commissionable_cents: row.commissionableCents,
    p_income_after_split_cents: row.incomeAfterSplitCents,
    p_card_tips_cents: row.cardTipsCents,
    p_tips_after_split_cents: row.tipsAfterSplitCents,
    p_check_portion_cents: row.checkPortionCents,
    p_cash_payment_cents: row.cashPaymentCents,
    p_service_commission_pct: row.serviceCommissionPct,
    p_tip_split_pct: row.tipSplitPct,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
  });

  if (error) {
    return { ok: false, ...mapRpcError(error) };
  }

  // 5. Bust the ledger + this tech's detail screen so the next render reflects
  //    the recorded payout (state badge, KPI cash-remaining).
  revalidatePath("/payroll");
  revalidatePath("/payroll/" + input.staffId);
  return { ok: true, payoutId: data as string };
}

// ─── undoPayout ─────────────────────────────────────────────────────────────

/**
 * Removes a technician's payout for an open pay period — the payout row is
 * deleted (audit-before-delete inside the RPC) and the tech returns to
 * `pending`. The RPC refuses a closed period or a missing payout.
 */
export async function undoPayout(input: UndoPayoutInput): Promise<ActionResult> {
  // 1. Viewer + role gate.
  const viewer = await requireStudioSession();
  if (!ROLES_ALLOWED.has(viewer.staff.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners and managers can undo payouts.",
    };
  }

  // 2. Validate input shape.
  if (
    typeof input.payPeriodId !== "string" ||
    input.payPeriodId === "" ||
    typeof input.staffId !== "string" ||
    input.staffId === ""
  ) {
    return { ok: false, code: "INVALID", message: "Invalid undo request." };
  }

  // 3. Call the undo RPC — it locks the period, refuses a closed one
  //    (`payroll_period_not_open`) and a missing payout (`payroll_payout_missing`).
  const admin = createSupabaseServiceRoleClient();
  const { error } = await admin.rpc("payroll_undo_payout", {
    p_pay_period_id: input.payPeriodId,
    p_staff_id: input.staffId,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
  });

  if (error) {
    return { ok: false, ...mapRpcError(error) };
  }

  // 4. Bust the ledger + detail screen.
  revalidatePath("/payroll");
  revalidatePath("/payroll/" + input.staffId);
  return { ok: true };
}

// ─── closePeriod ────────────────────────────────────────────────────────────

// Closing is OWNER-ONLY — a manager can record/undo payouts but not lock a
// period (FR-029). A separate, stricter gate than `ROLES_ALLOWED`.
const ROLE_CLOSE_ALLOWED = new Set(["owner"]);

/**
 * Closes the open pay period — terminal in v1.
 *
 * The full ledger is recomputed FRESH server-side (the client is never trusted
 * with money — FR-024). Eligible-but-unpaid techs are frozen as `paid = false`
 * placeholder snapshots; techs already marked paid keep their existing payout
 * row. If unpaid eligible techs exist and the owner has not yet confirmed the
 * warning (`confirmedUnpaid` false), the action returns `INVALID` naming them
 * so the UI can surface the confirmation dialog (FR-030).
 */
export async function closePeriod(input: ClosePeriodInput): Promise<ActionResult> {
  // 1. Viewer + owner-only gate.
  const viewer = await requireStudioSession();
  if (!ROLE_CLOSE_ALLOWED.has(viewer.staff.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners can close a pay period.",
    };
  }

  // 2. Validate input shape.
  if (typeof input.payPeriodId !== "string" || input.payPeriodId === "") {
    return { ok: false, code: "INVALID", message: "Invalid close request." };
  }

  // 3. Recompute the open period's full ledger fresh — the close always
  //    targets the open period (offset 0).
  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);
  const ledger = await loadPayrollLedger(supabase, tz, 0);

  if (ledger.period.id !== input.payPeriodId || ledger.readOnly) {
    return {
      ok: false,
      code: "PERIOD_CLOSED",
      message: "This pay period is closed — it can no longer be changed.",
    };
  }

  // 4. Eligible-but-unpaid techs — every eligible row that is not yet paid.
  //    For an open period these are `pending` rows (live-computed).
  const unpaidRows = ledger.rows.filter(
    (r) => r.state === "pending" || r.state === "unpaid_closed"
  );

  if (unpaidRows.length > 0 && input.confirmedUnpaid !== true) {
    const names = unpaidRows.map((r) => r.displayName).join(", ");
    const noun = unpaidRows.length === 1 ? "tech is" : "techs are";
    return {
      ok: false,
      code: "INVALID",
      message: `${unpaidRows.length} ${noun} still unpaid: ${names}`,
    };
  }

  // 5. Build the frozen-rows JSONB payload — one object per eligible-unpaid
  //    tech (already-paid techs keep their existing payout row in the RPC).
  const frozenRows = unpaidRows.map((r) => ({
    staff_id: r.staffId,
    commissionable_cents: r.commissionableCents,
    income_after_split_cents: r.incomeAfterSplitCents,
    card_tips_cents: r.cardTipsCents,
    tips_after_split_cents: r.tipsAfterSplitCents,
    check_portion_cents: r.checkPortionCents,
    cash_payment_cents: r.cashPaymentCents,
    service_commission_pct: r.serviceCommissionPct,
    tip_split_pct: r.tipSplitPct,
  }));

  // Period totals — an audit-payload summary of the whole closed period.
  const periodTotals = {
    technician_count: ledger.totals.technicianCount,
    ticket_count: ledger.totals.ticketCount,
    commissionable_cents: ledger.totals.commissionableCents,
    income_after_split_cents: ledger.totals.incomeAfterSplitCents,
    card_tips_cents: ledger.totals.cardTipsCents,
    tips_after_split_cents: ledger.totals.tipsAfterSplitCents,
    check_cents: ledger.totals.checkPortionCents,
    cash_cents: ledger.totals.cashPaymentCents,
  };

  // 6. Call the close RPC — it locks the period, freezes the rows, flips it
  //    to `closed`, and writes the audit row, all in one transaction.
  const admin = createSupabaseServiceRoleClient();
  const { error } = await admin.rpc("payroll_close_period", {
    p_pay_period_id: input.payPeriodId,
    p_frozen_rows: frozenRows,
    p_period_totals: periodTotals,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
  });

  if (error) {
    return { ok: false, ...mapRpcError(error) };
  }

  // 7. Bust the ledger — the period now renders read-only.
  revalidatePath("/payroll");
  return { ok: true };
}

// ─── addAdjustment ───────────────────────────────────────────────────────────

/**
 * Adds a manual payout adjustment to a working tech in the OPEN period
 * (feature 053, US2). Owner + manager only (NO PIN). The amount is a signed
 * integer cents ≠ 0; the reason is trimmed 1–80. The open ledger is recomputed
 * fresh — a closed/read-only period, a missing/`no_work` tech, or an
 * already-paid tech is refused before any RPC call (FR-007, FR-012/013).
 */
export async function addAdjustment(
  input: AddAdjustmentInput
): Promise<ActionResult<{ adjustmentId: string }>> {
  // 1. Viewer + role gate.
  const viewer = await requireStudioSession();
  if (!ROLES_ALLOWED.has(viewer.staff.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners and managers can add adjustments.",
    };
  }

  // 2. Validate input shape + amount / reason.
  const reason = validateAdjustment(input.amountCents, input.reason);
  if (
    typeof input.payPeriodId !== "string" ||
    input.payPeriodId === "" ||
    typeof input.staffId !== "string" ||
    input.staffId === "" ||
    reason === null
  ) {
    return { ok: false, code: "INVALID", message: "Invalid adjustment request." };
  }

  // 3. Recompute the OPEN ledger fresh — the adjustment only ever targets the
  //    open period (the client is never trusted with the period state).
  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);
  const ledger = await loadPayrollLedger(supabase, tz, 0);

  if (ledger.period.id !== input.payPeriodId || ledger.readOnly) {
    return {
      ok: false,
      code: "PERIOD_CLOSED",
      message: "This pay period is closed — adjustments can no longer change.",
    };
  }

  const row = ledger.rows.find((r) => r.staffId === input.staffId);
  if (!row || row.state === "no_work") {
    return {
      ok: false,
      code: "INVALID",
      message: "This technician has no work this period to adjust.",
    };
  }
  if (row.state === "paid") {
    return {
      ok: false,
      code: "ALREADY_PAID",
      message: "This technician is already paid — adjustments are locked.",
    };
  }

  // 4. Call the add RPC via the service role.
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc("payroll_add_adjustment", {
    p_pay_period_id: input.payPeriodId,
    p_staff_id: input.staffId,
    p_amount_cents: input.amountCents,
    p_reason: reason,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
  });

  if (error) {
    return { ok: false, ...mapRpcError(error) };
  }

  // 5. Bust the ledger + this tech's detail screen.
  revalidatePath("/payroll");
  revalidatePath("/payroll/" + input.staffId);
  return { ok: true, adjustmentId: data as string };
}

// ─── editAdjustment ──────────────────────────────────────────────────────────

/**
 * Edits an existing adjustment's amount + reason (feature 053, US2). Owner +
 * manager only. The RPC re-derives the period / staff from the row and enforces
 * the open-period lock (a closed period or a paid tech → refused); it returns
 * the affected `staff_id` for the revalidate. An unknown id → `INVALID`.
 *
 * US3 lock (FR-012, no clawback): the server is the security boundary even when
 * the UI renders the card read-only. `payroll_edit_adjustment` calls
 * `payroll_assert_adjustable`, which raises `payroll_period_not_open` for a
 * closed period (→ `PERIOD_CLOSED`) and `payroll_payout_exists` once the tech is
 * paid (→ `ALREADY_PAID`). A stale edit fired after a close/payout is refused
 * here, not silently applied.
 */
export async function editAdjustment(input: EditAdjustmentInput): Promise<ActionResult> {
  // 1. Viewer + role gate.
  const viewer = await requireStudioSession();
  if (!ROLES_ALLOWED.has(viewer.staff.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners and managers can edit adjustments.",
    };
  }

  // 2. Validate input shape + amount / reason.
  const reason = validateAdjustment(input.amountCents, input.reason);
  if (typeof input.adjustmentId !== "string" || input.adjustmentId === "" || reason === null) {
    return { ok: false, code: "INVALID", message: "Invalid adjustment request." };
  }

  // 3. The RPC re-derives the period / staff and enforces the open lock.
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc("payroll_edit_adjustment", {
    p_adjustment_id: input.adjustmentId,
    p_amount_cents: input.amountCents,
    p_reason: reason,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
  });

  if (error) {
    return { ok: false, ...mapRpcError(error) };
  }

  // 4. Bust the ledger + the affected tech's detail screen.
  revalidatePath("/payroll");
  if (typeof data === "string" && data) {
    revalidatePath("/payroll/" + data);
  }
  return { ok: true };
}

// ─── deleteAdjustment ────────────────────────────────────────────────────────

/**
 * Hard-deletes an adjustment (feature 053, US2). Owner + manager only. The RPC
 * writes the audit row before the delete, enforces the open-period lock, and
 * returns the affected `staff_id`. An unknown id → `INVALID`.
 *
 * US3 lock (FR-012, no clawback): same guard as edit — `payroll_assert_adjustable`
 * inside `payroll_delete_adjustment` raises `payroll_period_not_open` for a closed
 * period (→ `PERIOD_CLOSED`) and `payroll_payout_exists` once the tech is paid
 * (→ `ALREADY_PAID`), so a stale delete cannot claw back a frozen adjustment.
 */
export async function deleteAdjustment(input: DeleteAdjustmentInput): Promise<ActionResult> {
  // 1. Viewer + role gate.
  const viewer = await requireStudioSession();
  if (!ROLES_ALLOWED.has(viewer.staff.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners and managers can remove adjustments.",
    };
  }

  // 2. Validate input shape.
  if (typeof input.adjustmentId !== "string" || input.adjustmentId === "") {
    return { ok: false, code: "INVALID", message: "Invalid adjustment request." };
  }

  // 3. The RPC enforces the open lock, audits, then hard-deletes.
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc("payroll_delete_adjustment", {
    p_adjustment_id: input.adjustmentId,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
  });

  if (error) {
    return { ok: false, ...mapRpcError(error) };
  }

  // 4. Bust the ledger + the affected tech's detail screen.
  revalidatePath("/payroll");
  if (typeof data === "string" && data) {
    revalidatePath("/payroll/" + data);
  }
  return { ok: true };
}
