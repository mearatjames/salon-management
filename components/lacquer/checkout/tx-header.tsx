"use client";

// TxHeader — header row at the top of the checkout screen. Adapted from
// `design-system/prototypes/transaction/FlowSingle.jsx` § TxHeader, with
// two distinct controls per FR-005 (clarification Q5):
//   - "Cancel"  → routes back to /dashboard. The ticket stays open so the
//                 operator can resume it from the sidebar (US2).
//   - "Discard" → calls `discardTicket` then routes to /dashboard. Terminal.
//
// Both controls are buttons (not links) because Cancel is a pure
// navigation and Discard is a server-action submit; rendering both as
// buttons keeps the visual treatment uniform. The action invocation lives
// on the caller — the header is a presentation component that only
// surfaces the two intents.

import { X, Trash2 } from "lucide-react";

export type TxHeaderProps = {
  /** Title shown at the top of the header. Defaults to "New transaction". */
  title?: string;
  /** Optional small subline under the title (e.g. "Walk-in"). */
  subtitle?: string;
  /**
   * Present only in the post-commit phase (mid-split-tender, card waiting,
   * card-failed, post-commit cash-edit) where a persisted ticket exists.
   * When omitted, the Cancel/Discard buttons are not rendered — the
   * cart-build phase has no ticket to cancel or discard (the in-memory
   * cart is GC'd on unmount). FR-006 / FR-007.
   */
  ticketId?: string;
  /** Called when the operator taps "Cancel". Required when `ticketId` is set. */
  onCancel?: () => void;
  /** Called when the operator taps "Discard". Required when `ticketId` is set. */
  onDiscard?: () => void;
  /** When true, disables the buttons (e.g. while a discard is in flight). */
  disabled?: boolean;
};

export function TxHeader({
  title = "New transaction",
  subtitle,
  ticketId,
  onCancel,
  onDiscard,
  disabled = false,
}: TxHeaderProps) {
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
      {ticketId ? (
        <div className="checkout-header-actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            data-slot="cancel-ticket-button"
            aria-label="Cancel — keep this ticket open and go back to dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              height: "var(--space-8)",
              padding: "0 var(--space-3)",
              background: "var(--secondary)",
              color: "var(--secondary-foreground)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
            Cancel
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={disabled}
            data-slot="discard-ticket-button"
            aria-label="Discard this ticket — cannot be undone"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              height: "var(--space-8)",
              padding: "0 var(--space-3)",
              background: "var(--card)",
              color: "var(--destructive)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--text-sm)",
              fontWeight: 500,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden="true" />
            Discard
          </button>
        </div>
      ) : null}
    </header>
  );
}
