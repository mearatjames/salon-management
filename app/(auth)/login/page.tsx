// `/login` — public sign-in page (FR-005 short-circuit applies).
//
// Pre-redirect logic:
//   (a) Supabase user present AND operator cookie verifies →
//       redirect(sanitizeNext(next)). User is fully authed; skip /select-staff.
//   (b) Supabase user present but cookie missing/expired/tampered →
//       redirect('/select-staff?next=...').
//   (c) Otherwise render the auth card.
//
// Renders (US1 + US4):
//   - The headline (provided by the auth layout's brand mark, then this h1).
//   - `<LoginForm next={next} />` — the primary password path.
//   - `<GoogleSignInButton next={next} />` — visible only when
//     `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true'` (the component itself
//     gates on the flag; we gate the `.auth-divider` here so the "or"
//     separator doesn't render with nothing beneath it).
//   - `<MagicLinkControl next={next} sentTo={magicSent} />` — subordinate
//     text-link that expands to a one-field magic-link form. When
//     `searchParams.magic_sent` is present, the control renders the
//     "Check your email" confirmation instead.
//   - Inline `<Alert variant="destructive">` for `?error=invalid`,
//     `?error=network`, or `?error=oauth_failed`.
//
// Important: when `magic_sent` is present, the password form STILL renders.
// The confirmation appears alongside, not as a replacement — so the user can
// keep trying the password if they prefer.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  OperatorCookieExpiredError,
  OperatorCookieInvalidError,
  verifyOperatorCookie,
} from "@/lib/auth/cookie";
import { sanitizeNext } from "@/lib/auth/next-url";
import {
  GoogleSignInButton,
  isGoogleSignInEnabled,
} from "@/components/lacquer/google-sign-in-button";
import { LoginForm } from "@/components/lacquer/login-form";
import { MagicLinkControl } from "@/components/lacquer/magic-link-control";
import { Alert } from "@/components/ui/alert";
import { createSupabaseServerClient } from "@/lib/db/server";

type LoginSearchParams = {
  next?: string | string[];
  error?: string | string[];
  magic_sent?: string | string[];
};

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function nextSuffix(next: string | undefined): string {
  return next ? encodeURIComponent(next) : "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const params = await searchParams;
  const next = pickString(params.next);
  const error = pickString(params.error);
  const magicSent = pickString(params.magic_sent);

  // Pre-redirect (FR-005).
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        // Supabase user present — check operator cookie.
        const cookieStore = await cookies();
        const cookieValue = cookieStore.get("acting_as_staff_id")?.value;
        if (cookieValue) {
          try {
            await verifyOperatorCookie(cookieValue);
            // Both layers cleanly resolved — skip /select-staff.
            redirect(sanitizeNext(next));
          } catch (err) {
            if (
              err instanceof OperatorCookieInvalidError ||
              err instanceof OperatorCookieExpiredError
            ) {
              // Fall through to (b).
            } else {
              throw err;
            }
          }
        }
        // (b): Supabase user but no/invalid operator cookie.
        redirect(`/select-staff?next=${nextSuffix(next)}`);
      }
    } catch (err) {
      // `redirect()` throws a NEXT_REDIRECT — re-raise so Next handles it.
      if (
        typeof err === "object" &&
        err !== null &&
        typeof (err as { digest?: unknown }).digest === "string" &&
        ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
          (err as { digest: string }).digest.startsWith("NEXT_NOT_FOUND"))
      ) {
        throw err;
      }
      // Supabase unreachable — render the form. The user can still see the
      // login surface; failure will surface via signInWithPassword's network
      // branch.
    }
  }

  return (
    <>
      <h1 className="auth-headline">Sign in to Tang Nails Studio</h1>

      {error === "invalid" && <Alert variant="destructive">Email or password is incorrect.</Alert>}
      {error === "network" && (
        <Alert variant="destructive">
          Couldn&apos;t sign you in. Check your connection and try again.
        </Alert>
      )}
      {error === "oauth_failed" && (
        <Alert variant="destructive">
          We couldn&apos;t complete that sign-in. Try again or use your password.
        </Alert>
      )}

      <LoginForm next={next} />

      {isGoogleSignInEnabled && (
        <>
          <div className="auth-divider" role="separator" aria-label="or">
            <span>or</span>
          </div>
          <GoogleSignInButton next={next} />
        </>
      )}

      <MagicLinkControl next={next} sentTo={magicSent} />
    </>
  );
}
