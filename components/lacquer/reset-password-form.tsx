"use client";

// reset-password-form.tsx — the client island for `/reset-password`.
//
// Shared between the 010-login-redesign US3 recovery flow and the
// 012-user-onboarding invite-acceptance flow. The `type` prop carries the
// flow distinction:
//   • `"recovery"` (default) — heading "Set a new password",
//                              submit "Set new password",
//                              hidden field method="recovery"
//   • `"invite"`              — heading "Set your password",
//                              submit "Set password and continue",
//                              hidden field method="invite"
//
// The hidden `method` field is what `updatePassword` reads to tag the
// audit row (`payload.method`). Recovery and invite are otherwise
// structurally identical — same validation, same SDK call.
//
// Reveal toggle behaviour per ui-views.contract.md § Password-reveal
// toggle: each field has its own independent visibility state.

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { updatePassword } from "@/app/(auth)/reset-password/actions";
import { SubmitButton } from "@/components/lacquer/submit-button";

type Props = {
  type?: "recovery" | "invite";
};

export function ResetPasswordForm({ type = "recovery" }: Props) {
  const [shownPassword, setShownPassword] = useState(false);
  const [shownConfirm, setShownConfirm] = useState(false);

  const isInvite = type === "invite";
  const heading = isInvite ? "Set your password" : "Set a new password";
  const submitLabel = isInvite ? "Set password and continue" : "Set new password";

  return (
    <div className="auth-view-pane" key={isInvite ? "invite-form" : "reset-password"}>
      <div className="auth-form-header">
        <h1 className="auth-form-title">{heading}</h1>
        <p className="auth-form-subtitle">
          Pick something you&apos;ll remember — 8 characters or more.
        </p>
      </div>

      <form action={updatePassword}>
        <input type="hidden" name="method" value={isInvite ? "invite" : "recovery"} />
        <div className="auth-form-body">
          <div className="auth-field">
            <label htmlFor="reset-password">New password</label>
            <div className="auth-input-wrap">
              <input
                id="reset-password"
                name="password"
                type={shownPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                className="auth-text-input auth-text-input-suffixed"
                required
              />
              <button
                type="button"
                className="auth-suffix-btn"
                aria-label={shownPassword ? "Hide password" : "Show password"}
                onClick={() => setShownPassword((s) => !s)}
              >
                {shownPassword ? (
                  <EyeOff size={16} strokeWidth={1.5} />
                ) : (
                  <Eye size={16} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="reset-confirm">Confirm new password</label>
            <div className="auth-input-wrap">
              <input
                id="reset-confirm"
                name="confirm"
                type={shownConfirm ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                className="auth-text-input auth-text-input-suffixed"
                required
              />
              <button
                type="button"
                className="auth-suffix-btn"
                aria-label={shownConfirm ? "Hide password" : "Show password"}
                onClick={() => setShownConfirm((s) => !s)}
              >
                {shownConfirm ? (
                  <EyeOff size={16} strokeWidth={1.5} />
                ) : (
                  <Eye size={16} strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          <SubmitButton
            className="auth-btn auth-btn-primary"
            pendingLabel={isInvite ? "Setting password…" : "Updating…"}
          >
            {submitLabel}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
