"use client";

// EmailPreview — faux email card rendered alongside step 2 of the
// Thorough wizard. Adapted from
// `design-system/prototypes/onboarding/OnboardSheet.jsx` `EmailPreview`.
//
// Client component because it lives inside the OnboardSheet client
// island and re-renders as the user types `name`/`email` or toggles
// `method`. No client-side network / effects — pure presentation.
//
// Copy is taken verbatim from the prototype + research R1:
//   - Subject: "Your invite to Tang Nails Studio"
//   - From:    Tang Nails Studio <noreply@tangnails.com>
//   - CTA:     "Open Tang Nails Studio" (magic link) /
//              "Set up your password" (password)
//   - Validity-window footer:
//       magic_link: "This link is valid for 24 hours. …"
//       password:   "This link is valid for 7 days. …"
//
// Token discipline: every value resolves to `styles/tokens.css` via the
// `.onb-email-preview-*` rules in `styles/onboarding.css`. No inline hex.

export type EmailPreviewProps = {
  recipientName: string;
  recipientEmail: string;
  method: "magic_link" | "password";
};

export function EmailPreview({ recipientName, recipientEmail, method }: EmailPreviewProps) {
  const subject = "Your invite to Tang Nails Studio";
  const cta = method === "password" ? "Set up your password" : "Open Tang Nails Studio";
  const intro =
    method === "password"
      ? "An owner invited you to join Tang Nails Studio. Set a password to finish setting up your account."
      : "An owner invited you to join Tang Nails Studio. Tap the button below to sign in — no password needed.";
  const validity =
    method === "magic_link"
      ? "This link is valid for 24 hours. If you didn't expect this, ignore the email."
      : "This link is valid for 7 days. You'll be asked to choose a password.";
  const firstName = recipientName.trim().split(" ")[0] || "there";
  const toLine = recipientEmail.trim() || "name@example.com";

  return (
    <div
      className="onb-email-preview-card"
      data-slot="onb-email-preview"
      aria-label="Email preview"
    >
      <div className="onb-email-preview-head">
        <span className="onb-email-preview-dot" data-color="r" aria-hidden />
        <span className="onb-email-preview-dot" data-color="y" aria-hidden />
        <span className="onb-email-preview-dot" data-color="g" aria-hidden />
        <span className="onb-email-preview-head-label">
          Preview · what {recipientName.trim() ? recipientName.split(" ")[0] : "they"} will see
        </span>
      </div>
      <div className="onb-email-preview-body">
        <div className="onb-email-preview-from">
          From <b>Tang Nails Studio</b> &lt;noreply@tangnails.com&gt;
          <br />
          To &lt;{toLine}&gt;
        </div>
        <div className="onb-email-preview-subject">{subject}</div>
        <p className="onb-email-preview-greeting">Hi {firstName},</p>
        <p className="onb-email-preview-intro">{intro}</p>
        <div className="onb-email-preview-cta">{cta}</div>
        <div className="onb-email-preview-footer">{validity}</div>
      </div>
    </div>
  );
}
