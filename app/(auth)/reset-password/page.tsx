// `/reset-password` — the final UI surface in the US3 password-reset flow
// (010-login-redesign). Server Component. Renders one of two states:
//
//   1. **Expired state** — when there is no Supabase user session OR
//      `?error=expired` is present. The user arrived via a stale/already-used
//      recovery link OR `updatePassword` redirected here because the
//      session was wiped between PKCE exchange and form submit. Renders
//      a confirm-card with copy + a "Request a new link" button.
//
//   2. **Form state** — the new-password form (`<ResetPasswordForm>`).
//      Conditionally renders an `.auth-alert.auth-alert-error` above the
//      form when `?error in {too_short, mismatch, network}` is present
//      with copy from contracts/routes.contract.md § /reset-password.
//
// Both states share the two-panel layout from `app/(auth)/layout.tsx`.

import Link from "next/link";

import { ResetPasswordForm } from "@/components/lacquer/reset-password-form";
import { createSupabaseServerClient } from "@/lib/db/server";

type ResetPasswordSearchParams = {
  error?: string | string[];
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
      <ResetPasswordForm />
    </>
  );
}
