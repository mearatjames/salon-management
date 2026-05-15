"use server";

// Canonical import target for the operator menu (Switch staff / Sign out).
// US3 (T041) implements `switchStaff`. US6 (T050) implements `signOut`.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { recordAuth } from "@/lib/auth/audit";
import { sanitizeNext } from "@/lib/auth/next-url";
import { getStudioSessionOrDegraded, requireStudioSession } from "@/lib/auth/session";
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
  // 1. Resolve the current session — degraded is acceptable. We still want
  //    to clear the cookie and terminate the Supabase session even if the
  //    backend is reachability-impaired; the audit row records what we know.
  const viewer = await getStudioSessionOrDegraded();

  // 2. Write the audit row. Two shapes:
  //    - Healthy (`StudioViewer`): actor_user_id = device user, acting_as = staff.id.
  //    - Degraded: actor_user_id = null (we don't know the device user
  //      without Supabase), acting_as = best-effort cookieStaffId.
  if ("degraded" in viewer) {
    await recordAuth("device.signed_out", null, viewer.cookieStaffId, {});
  } else {
    await recordAuth("device.signed_out", viewer.deviceUserId, viewer.staff.id, {});
  }

  // 3. Clear the operator cookie. The contract reserves cookie-clearing to
  //    `switchStaff` and `signOut` (and middleware on expiry).
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);

  // 4. Terminate the Supabase device session. We still attempt this in the
  //    degraded path — if the backend is genuinely unreachable, the call
  //    will throw; catch and swallow so the user still lands on /login.
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch (err) {
    // Audit + cookie are already done; the user is effectively signed out
    // on this device. Log so we have a forensic trail.
    console.error("supabase.auth.signOut failed during signOut action", err);
  }

  // 5. Always land on /login. The form is rendered there; a hard refresh
  //    after this redirect will keep the user on /login.
  redirect("/login");
}
