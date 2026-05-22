"use server";

// Server Action for `/set-pin` — the new step a no-PIN invitee reaches
// after setting their password (specs/048-invitee-self-set-pin US1).
//
// `setOwnPin` writes the invitee's chosen 4-digit PIN to their own
// `staff` row, exactly once, then forwards them to /select-staff.
//
// Contract: `specs/048-invitee-self-set-pin/contracts/server-actions.md`
// § setOwnPin.
//
// Constitution II (server-authoritative): the session identity is verified
// server-side via `supabase.auth.getUser()`; the privileged `pin_hash`
// write goes through the service-role client (the `staff` table has no
// `authenticated` write policy) and is constrained to the caller's OWN row
// (`WHERE id = <staffId> AND user_id = <sessionUserId>`).
//
// Constitution III (auditability): a `user.pin_set` row is recorded via
// `recordAudit`. The raw PIN is hashed and discarded — it NEVER reaches a
// logger, `console.*`, or the audit payload.
//
// Branch matrix:
//   • pin fails validatePinShape   → /set-pin?error=invalid_pin_shape
//   • no session                   → /set-pin?error=expired
//   • no staff row for user_id      → /select-staff (defensive, nothing to set)
//   • staff row pin_hash non-null   → /select-staff (idempotent skip, no overwrite)
//   • staff row pin_hash IS NULL    → hash + write + audit + /select-staff

import { redirect } from "next/navigation";

import { ValidationError, validatePinShape } from "@/app/(studio)/settings/onboarding/_validation";
import { recordAudit } from "@/lib/auth/audit";
import { hashPin } from "@/lib/auth/pin";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";

function isNextRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function setOwnPin(formData: FormData): Promise<void> {
  const pin = String(formData.get("pin") ?? "");

  // 1. Shape validation. `validatePinShape` throws `ValidationError`
  //    ("invalid_pin_shape") when the value is not /^\d{4}$/. The keypad
  //    guarantees 4 digits before submit, but the action re-validates —
  //    never trust the client.
  try {
    validatePinShape(pin);
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect("/set-pin?error=invalid_pin_shape");
    }
    throw err;
  }

  const supabase = await createSupabaseServerClient();

  // 2. Session probe. The invitee was authenticated when they set their
  //    password moments earlier; if the cookie is gone, surface the
  //    expired state rather than silently failing.
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
  } catch (err) {
    if (isNextRedirectError(err)) throw err;
    userId = null;
  }

  if (!userId) {
    redirect("/set-pin?error=expired");
  }

  // 3. Resolve the invitee's own staff row (authenticated server client;
  //    `staff` has a `staff_select_authenticated USING (true)` policy).
  const { data: staffRow } = await supabase
    .from("staff")
    .select("id, pin_hash")
    .eq("user_id", userId)
    .maybeSingle();

  // Defensive: no staff row means there is nothing to set — hand off to
  // /select-staff (which itself gates on the device session).
  if (!staffRow) {
    redirect("/select-staff");
  }

  const staffId = staffRow.id;

  // 4. Idempotent skip. If the PIN was already set (owner set it at invite
  //    time, or a double-submit / direct re-nav landed here), do NOT
  //    overwrite it. No write, no audit.
  if (staffRow.pin_hash != null) {
    redirect("/select-staff");
  }

  // 5. Success path: hash the PIN and write it through the service-role
  //    client, scoped to the caller's own row.
  const pinHash = await hashPin(pin);

  const admin = createSupabaseServiceRoleClient();
  const { error: updateErr } = await admin
    .from("staff")
    .update({ pin_hash: pinHash })
    .eq("id", staffId)
    .eq("user_id", userId);

  if (updateErr) {
    // The write failed — surface the keypad again so the invitee can
    // retry. The error is logged for forensics; the raw PIN is NOT.
    console.error("setOwnPin: staff pin_hash UPDATE failed", updateErr);
    redirect("/set-pin?error=expired");
  }

  // 6. Audit BEFORE the redirect — Constitution III. The payload carries a
  //    boolean witness only; the raw PIN never appears.
  await recordAudit("user.pin_set", userId, staffId, { pin_set: true, actor: "self" }, staffId);

  // 7. Done — hand off to the staff picker.
  redirect("/select-staff");
}
