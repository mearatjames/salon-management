"use client";

// reset-password-form.tsx — the client island for `/reset-password` (US3).
// Renders the two new-password fields, each with its own Eye/EyeOff
// reveal toggle (mirrors the `<SignInView>` pattern from US2). Submits
// to the `updatePassword` Server Action.
//
// Reveal toggle behaviour matches FR-011 / FR-012:
//   • Each field has an independent `useState<boolean>` for visibility,
//     defaulting to hidden.
//   • Toggling never changes the other field's state.
//   • State resets on unmount (e.g. when the page re-renders after a
//     submit redirect) — React's natural lifecycle.
//
// Visual contract per ui-views.contract.md § Password-reveal toggle.

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { updatePassword } from "@/app/(auth)/reset-password/actions";

export function ResetPasswordForm() {
  const [shownPassword, setShownPassword] = useState(false);
  const [shownConfirm, setShownConfirm] = useState(false);

  return (
    <div className="auth-view-pane" key="reset-password">
      <div className="auth-form-header">
        <h1 className="auth-form-title">Set a new password</h1>
        <p className="auth-form-subtitle">
          Pick something you&apos;ll remember — 8 characters or more.
        </p>
      </div>

      <form action={updatePassword}>
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

          <button type="submit" className="auth-btn auth-btn-primary">
            Set new password
          </button>
        </div>
      </form>
    </div>
  );
}
