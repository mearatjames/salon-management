"use client";

// OnboardingToaster — URL → Sonner toast bridge for /settings/onboarding.
//
// Every onboarding Server Action redirects back to /settings/onboarding with:
//   • `?toast=<key>&name=<encoded>` for success variants
//   • `?error=<code>` for destructive variants
//
// Mirrors `components/lacquer/staff/staff-toaster.client.tsx` verbatim
// (read that file first — the URL contract is identical).
//
// Toast → copy mapping per
// `specs/012-user-onboarding/contracts/ui-views.contract.md § Toasts`:
//
//   invited            → "Invite sent to {name}"                          (success)
//   resent             → "Invite resent"                                   (success)
//   cancelled          → "Invite to {name} cancelled"                     (neutral / success)
//   offboarded         → "{name} offboarded"                              (neutral / success)
//   reactivated        → "Reactivation invite sent to {name}"             (success)
//   removed            → "{name} permanently removed"                     (destructive)
//   pin_reset          → "{name}'s PIN reset. They'll be notified on next sign-in." (success)
//   password_reset_sent→ "Password-reset email sent to {name}"            (success)
//
// Ref guard mirrors the staff pattern: fires once per unique
// `toast`+`name`+`error` triple, then strips the consumed params via
// `window.history.replaceState` (avoids the router-replace race
// documented in the staff toaster).

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

type ToastKey =
  | "invited"
  | "resent"
  | "cancelled"
  | "offboarded"
  | "reactivated"
  | "removed"
  | "pin_reset"
  | "password_reset_sent";

type ErrorCode =
  | "already_active"
  | "already_invited"
  | "was_offboarded"
  | "invalid_email"
  | "invalid_name"
  | "invalid_role"
  | "invalid_color"
  | "invalid_pin_shape"
  | "invalid_reason"
  | "invalid_invite_method"
  | "invalid_mode"
  | "cannot_offboard_self"
  | "last_owner"
  | "not_found"
  | "forbidden"
  | "ack_required"
  | "confirm_name_mismatch"
  | "invite_failed"
  | "network";

const TOAST_KEYS: ReadonlySet<ToastKey> = new Set([
  "invited",
  "resent",
  "cancelled",
  "offboarded",
  "reactivated",
  "removed",
  "pin_reset",
  "password_reset_sent",
]);

const ERROR_CODES: ReadonlySet<ErrorCode> = new Set([
  "already_active",
  "already_invited",
  "was_offboarded",
  "invalid_email",
  "invalid_name",
  "invalid_role",
  "invalid_color",
  "invalid_pin_shape",
  "invalid_reason",
  "invalid_invite_method",
  "invalid_mode",
  "cannot_offboard_self",
  "last_owner",
  "not_found",
  "forbidden",
  "ack_required",
  "confirm_name_mismatch",
  "invite_failed",
  "network",
]);

function isToastKey(value: string | null): value is ToastKey {
  return value !== null && TOAST_KEYS.has(value as ToastKey);
}

function isErrorCode(value: string | null): value is ErrorCode {
  return value !== null && ERROR_CODES.has(value as ErrorCode);
}

function successMessage(key: ToastKey, name: string | null): string | null {
  switch (key) {
    case "invited":
      return name ? `Invite sent to ${name}` : null;
    case "resent":
      return "Invite resent";
    case "cancelled":
      return name ? `Invite to ${name} cancelled` : null;
    case "offboarded":
      return name ? `${name} offboarded` : null;
    case "reactivated":
      return name ? `Reactivation invite sent to ${name}` : null;
    case "removed":
      return name ? `${name} permanently removed` : null;
    case "pin_reset":
      return name ? `${name}'s PIN reset. They'll be notified on next sign-in.` : null;
    case "password_reset_sent":
      return name ? `Password-reset email sent to ${name}` : null;
  }
}

function errorMessage(code: ErrorCode): string | null {
  switch (code) {
    case "already_active":
      return "That email is already attached to an active user.";
    case "already_invited":
      return "That email already has a pending invite.";
    case "was_offboarded":
      return "That email belongs to an offboarded user. Reactivate them instead.";
    case "invalid_email":
      return "Enter a valid email address.";
    case "invalid_name":
      return "Display name must be at least 2 characters.";
    case "invalid_role":
      return "Pick a valid role.";
    case "invalid_color":
      return "Pick a valid avatar color.";
    case "invalid_pin_shape":
      return "PIN must be 4 digits.";
    case "invalid_reason":
      return "Pick a valid reason.";
    case "invalid_invite_method":
      return "Pick a valid invite method.";
    case "invalid_mode":
      return "Pick a valid onboard mode.";
    case "cannot_offboard_self":
      return "You can't offboard yourself. Another owner has to do it.";
    case "last_owner":
      return "Promote another owner first.";
    case "not_found":
      return "That user was just removed by someone else.";
    case "forbidden":
      return "You don't have permission to do that.";
    case "ack_required":
      return "Check both acknowledgements first.";
    case "confirm_name_mismatch":
      return "Type the user's full name exactly to confirm.";
    case "invite_failed":
      return "Couldn't send the invite. Try again in a moment.";
    case "network":
      return "Couldn't reach Supabase. Check your connection and try again.";
  }
}

export function OnboardingToaster() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const toastKey = searchParams.get("toast");
    const name = searchParams.get("name");
    const errorCode = searchParams.get("error");

    if (!toastKey && !errorCode) return;

    const signature = `${toastKey ?? ""}|${name ?? ""}|${errorCode ?? ""}`;
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;

    if (isToastKey(toastKey)) {
      const message = successMessage(toastKey, name);
      if (message) {
        if (toastKey === "removed") {
          toast.error(message);
        } else {
          toast.success(message);
        }
      }
    }

    if (isErrorCode(errorCode)) {
      const message = errorMessage(errorCode);
      if (message) toast.error(message);
    }

    const next = new URLSearchParams(searchParams.toString());
    next.delete("toast");
    next.delete("name");
    next.delete("error");
    const query = next.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    window.history.replaceState(window.history.state, "", target);
  }, [searchParams, pathname]);

  return null;
}
