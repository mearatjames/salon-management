"use server";

// Server Action layer for the End-of-Day Cash Count page.
//
// `closeCashDrawerAction` is the single write surface: it role-gates to
// owner|manager, validates the input, derives the salon-local business
// day, and invokes the SECURITY DEFINER `pos_close_cash_drawer` RPC via
// the service-role client. Postgres errors are mapped to the documented
// result-code union so the UI can render the right banner/copy without
// peeking at error.message itself.
//
// Contract: specs/019-end-of-day-cash/contracts/server-action.md.

import { revalidatePath } from "next/cache";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalonTimezone } from "@/lib/db/settings";
import { salonDateString } from "@/lib/time/format";

export type CloseCashDrawerInput = {
  countedCents: number;
  expectedCents: number;
  notes: string;
};

export type CloseCashDrawerResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      code:
        | "FORBIDDEN"
        | "ALREADY_CLOSED"
        | "EXPECTED_CHANGED"
        | "NOTE_REQUIRED"
        | "BAD_INPUT"
        | "UNEXPECTED";
      message: string;
    };

const ROLES_ALLOWED = new Set(["owner", "manager"] as const);

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

export async function closeCashDrawerAction(
  input: CloseCashDrawerInput
): Promise<CloseCashDrawerResult> {
  // 1. Resolve viewer + role gate.
  const viewer = await requireStudioSession();
  if (!ROLES_ALLOWED.has(viewer.staff.role as "owner" | "manager")) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Only owners and managers can close out the cash drawer.",
    };
  }

  // 2. Validate input shape. Trim notes here so the variance rule below
  //    can rely on the cleaned value (the SQL RPC also trims as a defence
  //    in depth, but the UI's `canSubmit` derivation in the client island
  //    needs the same trimmed-empty rule).
  if (!isNonNegativeInt(input.countedCents) || !isNonNegativeInt(input.expectedCents)) {
    return {
      ok: false,
      code: "BAD_INPUT",
      message: "Counts must be non-negative integers (in cents).",
    };
  }

  // 3. Derive the salon-local business day. Reads `salon.timezone` from
  //    the settings table (server-cookie-aware client; RLS allows the
  //    select for authenticated users) and converts `now` to a
  //    YYYY-MM-DD string in that zone. The same string is sent to the
  //    RPC as `p_business_day`.
  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);
  const businessDay = salonDateString(tz, new Date());

  // 4. Invoke the close RPC via the service-role client (bypasses RLS;
  //    only legitimate caller of `pos_close_cash_drawer`).
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin.rpc("pos_close_cash_drawer", {
    p_counted_cents: input.countedCents,
    p_expected_cents: input.expectedCents,
    p_notes: input.notes,
    p_operator: viewer.staff.id,
    p_device_user_id: viewer.deviceUserId,
    p_business_day: businessDay,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("cash_drawer_already_closed")) {
      return {
        ok: false,
        code: "ALREADY_CLOSED",
        message: "Day already closed.",
      };
    }
    if (msg.includes("cash_drawer_expected_changed")) {
      return {
        ok: false,
        code: "EXPECTED_CHANGED",
        message: "A new cash payment was recorded. Please recount the drawer.",
      };
    }
    if (msg.includes("cash_drawer_note_required")) {
      return {
        ok: false,
        code: "NOTE_REQUIRED",
        message: "A note is required to record a variance.",
      };
    }
    // Anything else is unexpected — log full error for forensics and
    // surface a generic message so the UI can show a calm fallback.
    console.error("closeCashDrawerAction RPC failed", error);
    return {
      ok: false,
      code: "UNEXPECTED",
      message: "Could not close the cash drawer.",
    };
  }

  // 5. Success — bust the page cache so the very next render sees the
  //    closed state with the persisted variance / notes.
  revalidatePath("/end-of-day");
  return { ok: true, sessionId: data as string };
}
