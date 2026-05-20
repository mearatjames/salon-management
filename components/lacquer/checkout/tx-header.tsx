"use client";

// TxHeader — header row at the top of the checkout screen. Adapted from
// `design-system/prototypes/transaction/FlowSingle.jsx` § TxHeader.
//
// Feature 043-checkout-ephemeral-draft (FR-019/FR-020) consolidates the
// two former exit buttons ("Cancel" + "Discard") into ONE context-aware
// control:
//   - When `isEphemeral` (the cart is an in-memory draft with no DB row):
//     the control is labeled "Cancel". Tapping it just routes back to
//     /dashboard with zero DB effect — there is no ticket to discard.
//   - When NOT ephemeral (a ticket has been persisted — reached after a
//     payment was initiated): the control is labeled "Discard". Tapping
//     it runs the terminal discard (cancel any live terminal session →
//     `discardTicket` → route to /dashboard).
//
// The control is a single button. Cancel is a pure navigation and
// Discard is a server-action submit; rendering it as a button keeps the
// visual treatment uniform. The action invocation lives on the caller —
// the header is a presentation component that only surfaces the intent.
// `onCancel` and `onDiscard` are both still accepted so the caller keeps
// its two distinct handlers; the header picks which one to wire to the
// rendered button based on `isEphemeral`.

import { X, Trash2 } from "lucide-react";

export type TxHeaderProps = {
  /** Title shown at the top of the header. Defaults to "New transaction". */
  title?: string;
  /** Optional small subline under the title (e.g. "Walk-in"). */
  subtitle?: string;
  /**
   * When true, the cart is an ephemeral in-memory draft (no persisted
   * ticket): the exit control reads "Cancel" and wires to `onCancel`.
   * When false, a ticket is persisted: the control reads "Discard" and
   * wires to `onDiscard`. Defaults to false (persisted) so the
   * card-waiting / card-failed render sites — always post-persist — keep
   * showing "Discard" without passing the prop.
   */
  isEphemeral?: boolean;
  /** Called when the operator taps the exit control in ephemeral mode. */
  onCancel: () => void;
  /** Called when the operator taps the exit control in persisted mode. */
  onDiscard: () => void;
  /** When true, disables the button (e.g. while a discard is in flight). */
  disabled?: boolean;
};

export function TxHeader({
  title = "New transaction",
  subtitle,
  isEphemeral = false,
  onCancel,
  onDiscard,
  disabled = false,
}: TxHeaderProps) {
  // One context-aware exit control. Ephemeral → "Cancel" (pure nav, no DB
  // effect); persisted → "Discard" (terminal). It reuses the header's
  // existing button geometry (height/padding/radius/type) so the only
  // visible change vs. before is two buttons becoming one.
  const exitLabel = isEphemeral ? "Cancel" : "Discard";
  const ExitIcon = isEphemeral ? X : Trash2;
  const onExit = isEphemeral ? onCancel : onDiscard;
  const exitAriaLabel = isEphemeral
    ? "Cancel — leave checkout and go back to dashboard"
    : "Discard this ticket — cannot be undone";

  return (
    <header className="checkout-header" data-slot="checkout-header">
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <div>
          <h1 className="checkout-header-title">{title}</h1>
          {subtitle ? (
            <p
              style={{
                margin: 0,
                marginTop: "var(--space-1)",
                fontSize: "var(--text-sm)",
                color: "var(--muted-foreground)",
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      <div className="checkout-header-actions">
        <button
          type="button"
          onClick={onExit}
          disabled={disabled}
          data-slot="checkout-exit-control"
          data-mode={isEphemeral ? "ephemeral" : "persisted"}
          aria-label={exitAriaLabel}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            height: "var(--space-8)",
            padding: "0 var(--space-3)",
            background: isEphemeral ? "var(--secondary)" : "var(--card)",
            color: isEphemeral ? "var(--secondary-foreground)" : "var(--destructive)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <ExitIcon size={16} strokeWidth={1.5} aria-hidden="true" />
          {exitLabel}
        </button>
      </div>
    </header>
  );
}
