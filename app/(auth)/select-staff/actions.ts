"use server";

// Server Actions for `/select-staff`.
//
// `submitPin` is the **only** action in the codebase that issues an operator
// cookie. It writes one `staff.signed_in` (success) or `staff.pin_failed`
// (failure) audit row per attempt, always awaited before the redirect so a
// forensic query sees the attempt.
//
// Behavior matches `specs/003-login-flow/contracts/server-actions.contract.md`
// § submitPin verbatim — see that doc for the authoritative description.
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
import { createSupabaseServerClient } from "@/lib/db/server";

const COOKIE_NAME = "acting_as_staff_id";
const COOKIE_MAX_AGE_SECONDS = 43_200; // 12 hours — must match cookie.contract.md.

function encodeNext(next: string): string {
  return encodeURIComponent(next);
}

export async function submitPin(formData: FormData): Promise<void> {
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
    redirect(`/select-staff?error=pin_failed&next=${encodeNext(next)}`);
  }

  const ok = await verifyPin(pin, row!.pin_hash);
  if (!ok) {
    await recordAuth("staff.pin_failed", deviceUser!.id, staffId, {
      reason: "mismatch",
    });
    redirect(`/select-staff?error=pin_failed&next=${encodeNext(next)}`);
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
        // Re-throw unexpected errors so the error boundary catches them.
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

  redirect(sanitizeNext(next));
}
