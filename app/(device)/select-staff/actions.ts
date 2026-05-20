"use server";

// Server Actions for `/select-staff` (the `(device)` route group).
//
// `submitPin` is the **only** action in the codebase that issues an operator
// cookie. It writes one `staff.signed_in` (success) or `staff.pin_failed`
// (failure) audit row per attempt, always awaited before the redirect/return so
// a forensic query sees the attempt.
//
// Failure-return contract (044-select-staff-redesign): a PIN failure
// (`invalid_target` / `mismatch`) now `return { ok: false }` instead of
// redirecting with `?error=pin_failed`. The keypad modal is transient client
// state, so it stays open and surfaces the error inline — see
// `specs/044-select-staff-redesign/contracts/submit-pin.contract.md`. A missing
// device session is still a `redirect("/login?next=…")` — that is a navigation,
// not a PIN failure. Success still `redirect(sanitizeNext(next))`.
//
// Behavior otherwise matches
// `specs/003-login-flow/contracts/server-actions.contract.md` § submitPin.
// FR-011 + Q2: no throttling, no lockout. Bcrypt's cost is the only brake.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { recordAuth } from "@/lib/auth/audit";
import {
  OperatorCookieExpiredError,
  OperatorCookieInvalidError,
  signOperatorCookie,
  verifyOperatorCookie,
} from "@/lib/auth/cookie";
import { sanitizeNext } from "@/lib/auth/next-url";
import { verifyPin } from "@/lib/auth/pin";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";

const COOKIE_NAME = "acting_as_staff_id";
const COOKIE_MAX_AGE_SECONDS = 43_200; // 12 hours — must match cookie.contract.md.

export type SubmitPinResult = { ok: false };

function encodeNext(next: string): string {
  return encodeURIComponent(next);
}

export async function submitPin(formData: FormData): Promise<SubmitPinResult> {
  const staffId = String(formData.get("staffId") ?? "").trim();
  const pin = String(formData.get("pin") ?? "");
  const next = String(formData.get("next") ?? "");

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const deviceUser = userData?.user;
  if (!deviceUser) {
    redirect(`/login?next=${encodeNext(next)}`);
  }

  // Resolve the staff row. `single()` returns an error when no row matches —
  // we treat that the same as inactive / null pin_hash.
  const { data: row, error } = await supabase
    .from("staff")
    .select("id, pin_hash, active")
    .eq("id", staffId)
    .single();

  if (error || !row || row.active !== true || !row.pin_hash) {
    await recordAuth("staff.pin_failed", deviceUser!.id, staffId || null, {
      reason: "invalid_target",
    });
    return { ok: false };
  }

  const ok = await verifyPin(pin, row!.pin_hash);
  if (!ok) {
    await recordAuth("staff.pin_failed", deviceUser!.id, staffId, {
      reason: "mismatch",
    });
    return { ok: false };
  }

  // Capture any previous operator cookie (for the audit payload). Swallow
  // verification errors — a tampered cookie just means "no previous operator
  // for the audit trail".
  const cookieStore = await cookies();
  let previousSid: string | null = null;
  const existing = cookieStore.get(COOKIE_NAME)?.value;
  if (existing) {
    try {
      const payload = await verifyOperatorCookie(existing);
      previousSid = payload.sid;
    } catch (err) {
      if (
        !(err instanceof OperatorCookieInvalidError) &&
        !(err instanceof OperatorCookieExpiredError)
      ) {
        throw err;
      }
    }
  }

  const cookieValue = await signOperatorCookie({
    sid: staffId,
    iat: Math.floor(Date.now() / 1000),
  });

  cookieStore.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  await recordAuth(
    "staff.signed_in",
    deviceUser!.id,
    staffId,
    previousSid ? { previous_staff_id: previousSid } : {}
  );

  try {
    const admin = createSupabaseServiceRoleClient();
    await admin.from("staff").update({ pin_reset_admin_at: null }).eq("id", staffId);
  } catch (err) {
    console.error("submitPin: failed to clear pin_reset_admin_at", err);
  }

  redirect(sanitizeNext(next));
}
