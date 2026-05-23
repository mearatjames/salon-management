"use server";

// Canonical import target for the operator menu (Switch staff / Sign out).
// US3 (T041) implements `switchStaff`. US6 (T050) implements `signOut`.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { recordAuth } from "@/lib/auth/audit";
import { sanitizeNext } from "@/lib/auth/next-url";
import { parseSidUnsafe, requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

const COOKIE_NAME = "acting_as_staff_id";

function refererToPath(referer: string | null): string {
  // `headers().get('referer')` returns a full URL (or null). Extract the
  // pathname; if missing/malformed, fall back to the canonical `/dashboard`
  // — `sanitizeNext` will accept it.
  if (!referer) return "/dashboard";
  try {
    return new URL(referer).pathname;
  } catch {
    return "/dashboard";
  }
}

export async function switchStaff(): Promise<void> {
  // 1. Resolve the current viewer — captures both the device user (audit
  //    actor) and the outgoing operator's staff.id (audit subject).
  const viewer = await requireStudioSession();

  // 2. Read the current pathname from the Referer header. Server Actions
  //    don't have a built-in "current path" handle; the form was submitted
  //    from the page that opened the operator menu, so its URL is the
  //    Referer. Sanitize so a tampered Referer can't ferry us off-site.
  const h = await headers();
  const sanitizedNext = sanitizeNext(refererToPath(h.get("referer")));

  // 3. Capture the previous operator's id so /select-staff can render the
  //    "you were Maya" affordance via the `selectedTileId` query param.
  const previousSid = viewer.staff.id;

  // 4. Audit. The acting_as_staff_id captures the OUTGOING operator (the
  //    one who initiated the switch), per the contract. The cookie itself
  //    is left in place so `submitPin` can read it as `previousSid` and
  //    write `payload.previous_staff_id` on the next `staff.signed_in`
  //    audit row (audit.contract.md). `submitPin` overwrites the cookie
  //    with the new operator's sid on success — so an aborted switch
  //    leaves the prior operator in effect, which matches user intent.
  await recordAuth("staff.switched", viewer.deviceUserId, previousSid, {});

  // 6. Bounce to /select-staff. `selectedTileId` lets the page highlight
  //    the previous tile while the new operator pins in (orchestrator
  //    contract refinement on top of the original task text).
  redirect(
    `/select-staff?next=${encodeURIComponent(sanitizedNext)}&selectedTileId=${encodeURIComponent(previousSid)}`
  );
}

export async function signOut(): Promise<void> {
  // The action's contract is "end the device session, no matter where the
  // user is in the auth funnel" — including `/select-staff`, where the user
  // is signed in to Supabase but hasn't picked an operator yet so there is
  // no operator cookie to anchor a full studio session (#133). Routing
  // through `requireStudioSession()` here would throw
  // `AuthRedirectError("/select-staff")` and surface as a 500 to the user.
  //
  // Instead, resolve actor and subject best-effort:
  //   - actor_user_id  ← Supabase `auth.getUser()` (may be null if env vars
  //                       are missing or the backend is unreachable).
  //   - acting_as      ← operator cookie's `sid` claim, parsed unsafely
  //                       (signature isn't re-verified here — the action's
  //                       job is to end the session, not gate on it). Null
  //                       when no cookie is set, which is the normal
  //                       /select-staff state.
  let deviceUserId: string | null = null;
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  try {
    supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    deviceUserId = data?.user?.id ?? null;
  } catch (err) {
    // Backend unreachable or env vars missing — proceed without a known
    // actor. The audit row still goes out (null actor); the cookie still
    // gets cleared; the user still lands on /login.
    console.error("signOut: failed to resolve device user", err);
  }

  const cookieStore = await cookies();
  const cookieStaffId = parseSidUnsafe(cookieStore.get(COOKIE_NAME)?.value ?? null);

  // Audit BEFORE the redirect (Constitution III). One row per attempt, with
  // whatever identities we have — null on either side is acceptable.
  await recordAuth("device.signed_out", deviceUserId, cookieStaffId, {});

  // Clear the operator cookie. The contract reserves cookie-clearing to
  // `switchStaff` and `signOut` (and middleware on expiry).
  cookieStore.delete(COOKIE_NAME);

  // Terminate the Supabase device session. If the backend is genuinely
  // unreachable the call will throw; the audit + cookie are already done,
  // so swallow and let the user land on /login.
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("supabase.auth.signOut failed during signOut action", err);
    }
  }

  // Always land on /login. The form is rendered there; a hard refresh after
  // this redirect will keep the user on /login (US6.b regression guard).
  redirect("/login");
}
