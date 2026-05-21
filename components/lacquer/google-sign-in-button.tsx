// GoogleSignInButton — server component. Renders a "Continue with Google"
// outline button whose form posts to the `signInWithGoogle` Server Action.
//
// After 010-login-redesign the button is the *unconditionally-rendered*
// variant — the flag-gating that decides whether to show the OR divider +
// Google button block lives in the consumer (`<SignInView>` in
// `components/lacquer/auth-views.tsx`). The `isGoogleSignInEnabled`
// module export below is the single source of truth for that decision.
//
// The hidden `<input name="next">` propagates the `?next=` value verbatim
// so the post-OAuth callback knows where to send the user. Sanitization
// happens at `/auth/callback`, not here (R6 invariant).
//
// Visuals trace to `.auth-btn` / `.auth-btn-outline` in `styles/auth.css`
// (every value is a `var(--*)` token from `styles/tokens.css`). The inline
// GoogleIcon SVG is brand-mark colour — the per-path fills are Google's
// canonical brand colours and are kept as raw hex strings (those four
// values are NOT replaceable by tokens; Google's identity guidelines pin
// them). This is the single, deliberate exception to Principle I's
// "all values trace to tokens" — preserving the brand mark verbatim per
// the design-system handoff.

import { signInWithGoogle } from "@/app/(auth)/login/actions";
import { SubmitButton } from "@/components/lacquer/submit-button";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }} aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export type GoogleSignInButtonProps = {
  next?: string;
};

export function GoogleSignInButton({ next }: GoogleSignInButtonProps) {
  return (
    <form action={signInWithGoogle}>
      <input type="hidden" name="next" value={next ?? ""} />
      <SubmitButton
        className="auth-btn auth-btn-outline"
        data-slot="google-sign-in"
        style={{ gap: "var(--space-3)" }}
        pendingLabel="Connecting…"
      >
        <GoogleIcon />
        Continue with Google
      </SubmitButton>
    </form>
  );
}

// Re-export at module scope so consumers (e.g. <SignInView>) can decide
// whether to render the surrounding "OR" divider + Google block based on
// the same flag the button reads. Avoids two places of truth.
export const isGoogleSignInEnabled = GOOGLE_ENABLED;
