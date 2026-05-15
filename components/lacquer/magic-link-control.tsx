// MagicLinkControl — server component. Renders the subordinate
// "Email me a sign-in link instead" affordance below the primary password
// form. Two modes:
//
//   1. Not sent (default): a native `<details>` collapses to a single
//      underlined text-link; expanded, it reveals an email input + "Send link"
//      button whose form posts to `signInWithMagicLink`. The native element
//      means this works without client JS — the `<summary>` is keyboard- and
//      screen-reader-accessible by default.
//   2. Sent: a calm confirmation card showing the email address we sent the
//      link to and a "Send another link" affordance that re-opens the form.
//
// FR-019: the `signInWithMagicLink` action always redirects to
// `/login?magic_sent=<email>` regardless of whether the email actually
// matched a row, so this confirmation appears identically in both cases —
// matching the no-enumeration guarantee.

import { signInWithMagicLink } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MagicLinkControlProps = {
  next?: string;
  /**
   * When present, render the "Check your email" confirmation card instead of
   * the collapsed form. Populated from `searchParams.magic_sent` on `/login`.
   */
  sentTo?: string;
};

export function MagicLinkControl({ next, sentTo }: MagicLinkControlProps) {
  if (sentTo) {
    return (
      <div className="auth-magic-sent" data-slot="magic-link-sent">
        <p style={{ margin: 0, fontSize: "var(--text-sm)" }}>
          We sent a sign-in link to <strong>{sentTo}</strong>. You can close this tab and click the
          link from your inbox.
        </p>
        <details className="auth-magic-link-details" style={{ marginTop: "var(--space-3)" }}>
          <summary className="auth-magic-link">Send another link</summary>
          <MagicLinkForm next={next} />
        </details>
      </div>
    );
  }

  return (
    <details className="auth-magic-link-details" data-slot="magic-link-control">
      <summary className="auth-magic-link">Email me a sign-in link instead</summary>
      <MagicLinkForm next={next} />
    </details>
  );
}

function MagicLinkForm({ next }: { next?: string }) {
  return (
    <form action={signInWithMagicLink} className="auth-magic-link-form">
      <div className="auth-form-row" style={{ marginTop: "var(--space-3)" }}>
        <Label htmlFor="magic-email">Email</Label>
        <Input id="magic-email" name="email" type="email" autoComplete="email" required />
      </div>
      <input type="hidden" name="next" value={next ?? ""} />
      <div className="auth-form-actions">
        <Button type="submit" variant="outline">
          Send link
        </Button>
      </div>
    </form>
  );
}
