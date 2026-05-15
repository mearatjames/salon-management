// GoogleSignInButton — server component. Renders a "Continue with Google"
// outline button whose form posts to the `signInWithGoogle` Server Action.
//
// Visibility is gated at module scope on `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED ===
// 'true'`. When the flag is unset the component returns `null`, so the parent
// page never renders the divider's right-hand side either (the page is
// responsible for omitting the `.auth-divider` when the button is hidden).
//
// The hidden `<input name="next">` propagates the `?next=` value verbatim so
// the post-OAuth callback knows where to send the user. Sanitization happens
// at `/auth/callback`, not here (R6 invariant).

import { signInWithGoogle } from "@/app/(auth)/login/actions";
import { GoogleLogo } from "@/components/lacquer/_google-logo";
import { Button } from "@/components/ui/button";

const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";

export type GoogleSignInButtonProps = {
  next?: string;
};

export function GoogleSignInButton({ next }: GoogleSignInButtonProps) {
  if (!GOOGLE_ENABLED) return null;

  return (
    <form action={signInWithGoogle}>
      <input type="hidden" name="next" value={next ?? ""} />
      <Button
        type="submit"
        variant="outline"
        className="auth-provider-btn"
        data-slot="google-sign-in"
      >
        <GoogleLogo />
        Continue with Google
      </Button>
    </form>
  );
}

// Re-export at module scope so the parent page can decide whether to render
// the `.auth-divider` based on the same flag the button reads. Avoids two
// places of truth.
export const isGoogleSignInEnabled = GOOGLE_ENABLED;
