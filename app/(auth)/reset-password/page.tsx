// `/reset-password` — the final UI surface in the password-setup flow.
//
// Two flow types share this page:
//   • `?type=recovery` (default) — 010-login-redesign US3 password reset.
//   • `?type=invite`             — 012-user-onboarding invite acceptance,
//                                  where the staff row exists in `state='invited'`
//                                  and the user is finishing onboarding by
//                                  setting their first password.
//
// Server Component. Renders one of two states per flow:
//
//   1. **Expired state** — when there is no Supabase user session OR
//      `?error=expired` is present. Recovery: copy + "Request a new link".
//      Invite: copy + (no CTA) — owner has to send a fresh invite.
//
//   2. **Form state** — the new-password form (`<ResetPasswordForm>`).
//      Conditionally renders an `.auth-alert.auth-alert-error` above the
//      form when `?error in {too_short, mismatch, network, same_password,
//      update_failed}` is present with copy from
//      contracts/routes.contract.md § /reset-password.
//
// Both states share the two-panel layout from `app/(auth)/layout.tsx`.

import Link from "next/link";

import { ResetPasswordForm } from "@/components/lacquer/reset-password-form";
import { createSupabaseServerClient } from "@/lib/db/server";

type ResetPasswordSearchParams = {
  error?: string | string[];
  type?: string | string[];
};

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<ResetPasswordSearchParams>;
}) {
  const params = await searchParams;
  const error = pickString(params.error);
  const typeRaw = pickString(params.type);
  const type: "recovery" | "invite" = typeRaw === "invite" ? "invite" : "recovery";

  // Session probe. The PKCE exchange in /auth/callback set the cookies just
  // before redirecting here; if `getUser()` returns no user, the link was
  // stale or the cookie has been cleared.
  let hasSession = false;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      hasSession = data?.user != null;
    } catch {
      // Supabase unreachable — treat as no session so the user sees the
      // expired-state card rather than a broken form.
      hasSession = false;
    }
  }

  if (!hasSession || error === "expired") {
    if (type === "invite") {
      return (
        <div className="auth-view-pane" key="invite-expired">
          <div className="auth-form-header">
            <h1 className="auth-form-title">Invite link expired</h1>
          </div>
          <div className="auth-confirm-card">
            <p>
              This invite link has expired or has already been used. Ask the owner to send a fresh
              one.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="auth-view-pane" key="reset-expired">
        <div className="auth-form-header">
          <h1 className="auth-form-title">Reset link expired</h1>
        </div>
        <div className="auth-confirm-card">
          <p>
            This link has expired or has already been used. Reset links are good for 1 hour and can
            only be used once.
          </p>
          <p>Request a fresh link to try again.</p>
        </div>
        <Link href="/login?reset_intent=1" className="auth-btn auth-btn-primary">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <>
      {error === "too_short" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Password must be at least 8 characters.
        </div>
      )}
      {error === "mismatch" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Passwords don&apos;t match.
        </div>
      )}
      {error === "network" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Couldn&apos;t update your password. Check your connection and try again.
        </div>
      )}
      {error === "same_password" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Pick a password you haven&apos;t used before — this one matches your current password.
        </div>
      )}
      {error === "update_failed" && (
        <div className="auth-alert auth-alert-error" role="alert">
          Couldn&apos;t update your password. Try again, or request a new reset link.
        </div>
      )}
      <ResetPasswordForm type={type} />
    </>
  );
}
