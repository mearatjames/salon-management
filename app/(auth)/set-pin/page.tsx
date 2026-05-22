// `/set-pin` — the new step a no-PIN invitee reaches after setting their
// password (specs/048-invitee-self-set-pin US1).
//
// Server Component. Renders inside `app/(auth)/layout.tsx` (`AuthShell`),
// the same two-panel Lacquer shell `/login` and `/reset-password` use.
//
// This page is the single gate for the PIN step (research.md D2):
// `updatePassword` redirects every invite-method user here unconditionally;
// the page reads `staff.pin_hash` and decides skip-vs-show.
//
// Render/redirect matrix (contracts/server-actions.md § /set-pin page):
//
//   1. No valid Supabase session       → expired-state card (mirrors
//                                         /reset-password's invite-expired
//                                         state).
//   2. Session valid, no staff row     → redirect /select-staff (defensive).
//   3. Session valid, pin_hash non-null → redirect /select-staff. This is
//                                         both the US2 skip (owner set the
//                                         PIN at invite time) AND the
//                                         direct-navigation idempotency
//                                         guard (someone re-opens /set-pin
//                                         after already setting it).
//   4. Session valid, pin_hash IS NULL → render <SetPinForm />.
//
// `?error=` query params surfaced inline:
//   • invalid_pin_shape → keypad with an inline "Enter a 4-digit PIN" message.
//   • expired           → the invite-expired card.
//
// No `middleware.ts` exists for this route group — the session is enforced
// in-page via `supabase.auth.getUser()`, exactly as /reset-password does.

import { redirect } from "next/navigation";

import { SetPinForm } from "@/components/lacquer/set-pin-form.client";
import { createSupabaseServerClient } from "@/lib/db/server";

type SetPinSearchParams = {
  error?: string | string[];
};

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function InviteExpiredCard() {
  return (
    <div className="auth-view-pane" key="set-pin-expired">
      <div className="auth-form-header">
        <h1 className="auth-form-title">Invite link expired</h1>
      </div>
      <div className="auth-confirm-card">
        <p>
          This invite link has expired or has already been used. Ask the owner to send a fresh one.
        </p>
      </div>
    </div>
  );
}

export default async function SetPinPage({
  searchParams,
}: {
  searchParams: Promise<SetPinSearchParams>;
}) {
  const params = await searchParams;
  const error = pickString(params.error);

  // Session probe. The invitee was authenticated when they set their
  // password moments earlier; if `getUser()` returns no user, the session
  // is gone — surface the expired-state card. `?error=expired` (set by the
  // setOwnPin action on a stale-session submit) forces the same surface.
  let userId: string | null = null;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      userId = data?.user?.id ?? null;

      if (userId && error !== "expired") {
        // Resolve the invitee's own staff row to decide skip-vs-show.
        const { data: staffRow } = await supabase
          .from("staff")
          .select("id, pin_hash")
          .eq("user_id", userId)
          .maybeSingle();

        // No staff row — nothing to set; hand off to the staff picker.
        if (!staffRow) {
          redirect("/select-staff");
        }

        // PIN already set (US2 owner-set, or direct-nav after a prior set)
        // — skip the step. No overwrite.
        if (staffRow.pin_hash != null) {
          redirect("/select-staff");
        }
      }
    } catch (err) {
      if (isNextRedirectError(err)) throw err;
      // Supabase unreachable — treat as no session so the invitee sees the
      // expired-state card rather than a broken keypad.
      userId = null;
    }
  }

  if (!userId || error === "expired") {
    return <InviteExpiredCard />;
  }

  return (
    <>
      {error === "invalid_pin_shape" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Enter a 4-digit PIN.
        </div>
      )}
      <SetPinForm />
    </>
  );
}

function isNextRedirectError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
