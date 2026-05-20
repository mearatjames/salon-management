"use client";

// PinEntryModal — the centered PIN-entry modal for `/select-staff`.
//
// 044-select-staff-redesign US1 (T011). Built on the shadcn `Dialog`
// primitive (`components/ui/dialog.tsx`, Radix-backed) — `DialogContent`
// already supplies the portal, overlay, focus trap, Escape-to-close and a
// close button, so this component only owns the PIN buffer and the
// keypad/indicator body.
//
// THE MODAL OWNS THE PIN BUFFER. `<PinPad>` is bufferless — it emits key
// events; this component appends/clears/trims a `string` (capped at 4
// digits). The 4-position indicator is driven off `buffer.length` and NEVER
// renders the digits themselves (FR-012).
//
// When the buffer reaches the 4th digit, `submitPin` (the Server Action) is
// invoked imperatively inside a `useTransition`. On a correct PIN `submitPin`
// sets the operator cookie and `redirect()`s — the promise never resolves,
// the Next runtime navigates away, and this modal unmounts with the page
// (FR-015 / FR-016 / FR-025).
//
// On a resolved `{ ok: false }` (US3 / T018, FR-017) the modal stays OPEN for
// an immediate retry: it paints a destructive error state on the 4-position
// indicator (`data-error="true"`), clears the buffer, and bumps an attempt
// counter. That counter is the `key` of `<PinPad>`, so the bufferless keypad
// REMOUNTS on every failed attempt (research R3/R4) — this is what makes two
// identical wrong PINs in a row each clear deterministically, rather than
// relying on an error-string change to retrigger anything. The error state
// clears as soon as the operator types the next digit. No audit attempt is
// made client-side — the failed-attempt audit row was already written
// server-side by `submitPin`.
//
// All visuals trace to `select-staff-modal*` / `select-staff-pin-*` classes
// in `styles/select-staff.css` (Constitution Principle I — FR-026).

import { useRef, useState, useTransition } from "react";

import { submitPin } from "@/app/(device)/select-staff/actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { PinPad } from "./pin-pad";
import type { StaffRosterEntry } from "./select-staff-screen.client";

const PIN_LENGTH = 4;

// Initials for the modal avatar — first + last initial, or the first two
// characters of a single-word name. Mirrors `staff-avatar-tile.tsx`.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "manager":
      return "Manager";
    case "technician":
      return "Tech";
    case "front_desk":
      return "Front desk";
    default:
      return role;
  }
}

export type PinEntryModalProps = {
  staff: StaffRosterEntry;
  next: string;
  onClose: () => void;
};

export function PinEntryModal({ staff, next, onClose }: PinEntryModalProps) {
  // The modal owns the PIN buffer (≤ 4 digits). `<PinPad>` is bufferless.
  const [buffer, setBuffer] = useState("");
  // Painted on the 4-position indicator (`data-error`) after a wrong PIN
  // (FR-017). Cleared the instant the operator starts the next attempt.
  const [attemptError, setAttemptError] = useState(false);
  // Failed-attempt counter — passed as the `key` of `<PinPad>` so the
  // bufferless keypad remounts on every failure. This is what makes two
  // identical wrong PINs in a row each clear deterministically (research
  // R3/R4) rather than depending on an error-string change.
  const [attemptCount, setAttemptCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  // One-shot guard: `submitPin` must be invoked exactly once per completed
  // attempt (Constitution III / SC-007 — "exactly one audit row"). React 19
  // StrictMode double-invokes state updaters and effects, and a keypad
  // tap can plausibly fire via more than one path; this ref makes the
  // submission idempotent regardless. It is reset on a resolved
  // `{ ok: false }` so a retry can submit again, and the whole modal
  // remounts per `selectedStaffId` so a fresh tile always gets a fresh ref.
  const submittedRef = useRef(false);

  // Submit the buffered PIN. On success `submitPin` redirects (throws
  // NEXT_REDIRECT) and the runtime navigates away — this modal unmounts
  // with the page. On `{ ok: false }` clear the buffer for an immediate
  // retry (T018 adds the error-state paint).
  function verify(pin: string) {
    // One submission per attempt — see `submittedRef` above.
    if (submittedRef.current) return;
    submittedRef.current = true;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("staffId", staff.id);
      formData.set("pin", pin);
      formData.set("next", next);
      const result = await submitPin(formData);
      // Reached only on a resolved failure — the success path redirects.
      // The modal stays open (FR-017); no audit attempt is made here, the
      // server already wrote the failed-attempt row inside `submitPin`.
      if (result.ok === false) {
        // Allow the next attempt to submit.
        submittedRef.current = false;
        // Paint the indicator error state and clear the buffer.
        setAttemptError(true);
        setBuffer("");
        // Bump the counter that keys `<PinPad>` — the keypad remounts so a
        // repeated identical wrong PIN still clears (research R3/R4).
        setAttemptCount((n) => n + 1);
      }
    });
  }

  function handleDigit(digit: string) {
    // Ignore input while a verification is in flight.
    if (isPending) return;
    if (buffer.length >= PIN_LENGTH) return;
    // Compute the next buffer value outside the updater so the submit
    // side effect never lives inside a (must-be-pure) `setState` updater.
    const nextBuffer = buffer + digit;
    setBuffer(nextBuffer);
    setAttemptError(false);
    if (nextBuffer.length === PIN_LENGTH) {
      verify(nextBuffer);
    }
  }

  function handleClear() {
    if (isPending) return;
    setBuffer("");
    setAttemptError(false);
  }

  function handleBackspace() {
    if (isPending) return;
    setBuffer((current) => current.slice(0, -1));
    setAttemptError(false);
  }

  // Dismissal (US3 / T019, FR-018). Radix calls `onOpenChange(false)` for a
  // backdrop click, the close (X) control, and Escape; all three route here
  // and call `onClose`, which clears `selectedStaffId` on the screen and
  // returns to the avatar grid. No audit attempt is made: `submitPin` only
  // ever fires on a completed 4-digit buffer, so a 0–3-digit dismiss writes
  // nothing. The modal remounts per `selectedStaffId` (the screen keys it on
  // that id), so picking a different tile always gets a fresh empty buffer /
  // attempt counter / error state — no state leaks across a remount (FR-019).
  function handleOpenChange(open: boolean) {
    if (!open) onClose();
  }

  // Avatar tint idiom (research R8): a 15%-opacity wash of the staff color
  // token behind the full-opacity token-colored initials.
  const avatarStyle = {
    background: `oklch(from var(${staff.color_token}) l c h / 0.15)`,
    color: `var(${staff.color_token})`,
  };

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <div className="select-staff-modal">
          <span className="select-staff-modal-avatar" style={avatarStyle} aria-hidden="true">
            {initials(staff.display_name)}
          </span>
          <div className="select-staff-modal-identity">
            <DialogTitle className="select-staff-modal-name">{staff.display_name}</DialogTitle>
            <span className="select-staff-modal-role">{roleLabel(staff.role)}</span>
          </div>

          <DialogDescription className="select-staff-modal-prompt">
            Enter your 4-digit PIN
          </DialogDescription>

          {/* 4-position indicator — driven off buffer.length, never the
              digits themselves (FR-012). `data-error="true"` is set after a
              wrong PIN (FR-017); `styles/select-staff.css` paints the
              destructive state off it. It clears on the next digit typed. */}
          <div
            className="select-staff-pin-dots"
            data-slot="pin-indicator"
            role="img"
            aria-label={`PIN entry, ${buffer.length} of ${PIN_LENGTH} digits`}
            data-error={attemptError ? "true" : undefined}
          >
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <span
                key={i}
                className="select-staff-pin-dot"
                data-filled={i < buffer.length ? "true" : "false"}
              />
            ))}
          </div>

          {/* Keyed on `attemptCount` so the bufferless keypad remounts on
              every failed attempt — a repeated identical wrong PIN clears
              deterministically (research R3/R4). */}
          <PinPad
            key={attemptCount}
            onDigit={handleDigit}
            onClear={handleClear}
            onBackspace={handleBackspace}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
