"use server";

// Server Action layer for the Past Cash Counts edit affordance.
//
// `editCashDrawerAction` is the single write surface for in-place
// corrections to a closed `cash_drawer_sessions` row. It role-gates to
// owner|manager, validates the input shape, and invokes the SECURITY
// DEFINER `pos_edit_cash_drawer` RPC via the service-role client. The
// RPC re-asserts the note-required-when-variance rule and writes a
// `cash_drawer.edited` audit row in the same transaction.
//
// Unlike `closeCashDrawerAction`, this action does NOT consume the
// salon timezone or derive a business day — edits operate on an
// existing row, never insert a new one.
//
// Contract: specs/020-past-cash-counts/contracts/server-action.md.

import { revalidatePath } from "next/cache";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";

export type EditCashDrawerInput = {
  sessionId: string;
  countedCents: number;
  notes: string;
};

export type EditCashDrawerResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "NOT_CLOSED" | "NOTE_REQUIRED" | "BAD_INPUT" | "UNEXPECTED";
      message: string;
    };

const ROLES_ALLOWED = new Set(["owner", "manager"] as const);

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export async function editCashDrawerAction(
  input: EditCashDrawerInput
): Promise<EditCashDrawerResult> {
  // 1. Resolve viewer + role gate. Only owners and managers can edit a
  //    past count (matches the close-action policy).
  const viewer = await requireStudioSession();
  if (!ROLES_ALLOWED.has(viewer.staff.role as "owner" | "manager")) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners and managers can edit a past cash count.",
    };
  }

  // 2. Validate input shape. The RPC also defends each rule (RLS-safe
  //    by design) but we bounce the request early so the audit_log is
  //    only touched when the caller's intent is well-formed.
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    return {
      ok: false,
      code: "BAD_INPUT",
      message: "Session id is required.",
    };
  }
  if (!isNonNegativeInt(input.countedCents)) {
    return {
      ok: false,
      code: "BAD_INPUT",
      message: "Counted amount must be a non-negative integer (in cents).",
    };
  }

  // 3. Invoke the edit RPC via the service-role client. The RPC is the
  //    only legitimate writer for `cash_drawer_sessions` post-close.
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc("pos_edit_cash_drawer", {
    p_session_id: input.sessionId,
    p_counted_cents: input.countedCents,
    p_notes: input.notes,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("cash_drawer_session_missing")) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "That cash count no longer exists.",
      };
    }
    if (msg.includes("cash_drawer_session_not_closed")) {
      return {
        ok: false,
        code: "NOT_CLOSED",
        message: "This session has not been closed yet, so it cannot be edited.",
      };
    }
    if (msg.includes("cash_drawer_note_required")) {
      return {
        ok: false,
        code: "NOTE_REQUIRED",
        message: "A note is required to record a variance.",
      };
    }
    console.error("editCashDrawerAction RPC failed", error);
    return {
      ok: false,
      code: "UNEXPECTED",
      message: "Could not save the cash count edit.",
    };
  }

  // 4. Success — bust both the list and the detail caches so the next
  //    render of either picks up the new counted/variance/notes.
  revalidatePath("/end-of-day/history");
  revalidatePath(`/end-of-day/history/${input.sessionId}`);
  return { ok: true, sessionId: data as string };
}
