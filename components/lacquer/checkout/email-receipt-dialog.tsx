"use client";

// EmailReceiptDialog — T038 (US4). Small modal that captures an email address
// for the `emailReceiptStub` Server Action (T036). Matches the family chrome
// of PriceSheet / DiscountSheet / ReceiptSheet (tx-sheet-backdrop + tx-sheet),
// keeping the visual language consistent.
//
// Validation:
//   - Trim the input on submit.
//   - Match against the same regex as `actions.ts::EMAIL` (the literal is
//     duplicated here per T035's note — keeping client and server textually
//     identical is the simplest spec for "they match").
//   - On invalid → setInlineError("Enter a valid email address."); do NOT
//     call onSubmit.
//   - On valid → setSending(true); await onSubmit(address); on resolved →
//     call onCancel to close; on rejected → surface the error (use
//     `err.message` if it looks like an EmailAddressInvalidError shape;
//     otherwise a generic message).
//
// The dialog does NOT know about the Server Action directly — the parent
// (`checkout-screen.client.tsx`) wraps `emailReceiptStub` and passes the
// async result back via `onSubmit`.

import { useState } from "react";

import { X } from "lucide-react";

// Literal copy of `app/(studio)/checkout/actions.ts::EMAIL`. Keeping the
// regex textually identical between client + server is the spec for
// "the two validations match" (per T035).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailReceiptDialogProps = {
  onSubmit: (address: string) => Promise<void>;
  onCancel: () => void;
};

export function EmailReceiptDialog({ onSubmit, onCancel }: EmailReceiptDialogProps) {
  const [address, setAddress] = useState<string>("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [sending, setSending] = useState<boolean>(false);

  async function handleSend() {
    if (sending) return;
    const trimmed = address.trim();
    if (!EMAIL.test(trimmed)) {
      setInlineError("Enter a valid email address.");
      return;
    }
    setInlineError(null);
    setSending(true);
    try {
      await onSubmit(trimmed);
      // On resolved → close the dialog. The parent's onSubmit handler is
      // expected to surface the success toast.
      onCancel();
    } catch {
      // Surface a generic message — the parent is also expected to mirror
      // typed errors to the cart banner.
      setInlineError("Couldn’t send. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="tx-sheet-backdrop"
      data-slot="email-receipt-dialog"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Email receipt"
    >
      <div className="tx-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tx-sheet-h">
          <div style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>Email receipt</div>
          <button
            type="button"
            className="tx-stepper-btn"
            onClick={onCancel}
            aria-label="Close email dialog"
            data-slot="email-receipt-close"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <div className="tx-sheet-body">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <label
              htmlFor="email-receipt-input"
              style={{
                fontSize: "var(--text-xs)",
                textTransform: "uppercase",
                letterSpacing: "var(--tracking-wide)",
                fontWeight: 500,
                color: "var(--muted-foreground)",
              }}
            >
              Customer email
            </label>
            <input
              id="email-receipt-input"
              data-slot="email-receipt-input"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                if (inlineError) setInlineError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="you@example.com"
              disabled={sending}
              style={{
                padding: "var(--space-2) var(--space-3)",
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--foreground)",
                fontSize: "var(--text-base)",
                fontFamily: "var(--font-sans)",
              }}
            />
            {inlineError ? (
              <div
                role="alert"
                data-slot="email-receipt-error"
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--destructive)",
                  fontWeight: 500,
                  marginTop: "var(--space-1)",
                }}
              >
                {inlineError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="tx-sheet-foot">
          <button
            type="button"
            className="tx-btn secondary"
            onClick={onCancel}
            data-slot="email-receipt-cancel"
            disabled={sending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="tx-btn"
            onClick={() => void handleSend()}
            data-slot="email-receipt-send"
            disabled={sending}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
