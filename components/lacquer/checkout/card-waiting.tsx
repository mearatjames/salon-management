"use client";

// CardWaiting — the operator-facing screen rendered while a card payment
// is in flight on the Square Terminal. Adapted from
// `design-system/prototypes/transaction/FlowSingle.jsx:127–148`:
//
//   - rose-tinted circle housing the SquareTerminalIcon glyph (var(--space-16))
//   - text-2xl / 600 weight title "Hand the terminal to your client"
//   - text-sm muted body with the amount + device cue
//   - DotPulse loader (three primary-colored dots, staggered fade)
//   - text-xs muted tabular caption "Waiting for payment confirmation…"
//   - link-styled "Cancel and pick a different method"
//
// Every value traces to tokens in `styles/tokens.css` (Constitution
// Principle I). The prototype used 96px / 380px / 22px / 10px raw pixels
// — Lacquer's scale is 4/8/12/16/20/24/32/40/48/64 + text-xs..6xl, so we
// resolve to the closest in-scale token (--space-16 = 64px housing,
// --text-2xl = 20px title). The visual language stays intact.

import { useId } from "react";

export type CardWaitingProps = {
  amountCents: number;
  deviceFriendlyName: string;
  onCancel: () => void;
};

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Inline SVG glyph — mirrors the prototype's SquareTerminalIcon. 1.6px
// stroke matches the design-system's 1.5–2px tolerance; sized to 38px to
// fit the 96×96 housing.
function SquareTerminalIcon({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="3" width="20" height="26" rx="3" />
      <rect x="9" y="6" width="14" height="9" rx="1" />
      <circle cx="11" cy="20" r="1" />
      <circle cx="16" cy="20" r="1" />
      <circle cx="21" cy="20" r="1" />
      <circle cx="11" cy="24" r="1" />
      <circle cx="16" cy="24" r="1" />
      <circle cx="21" cy="24" r="1" />
    </svg>
  );
}

// DotPulse — three primary-colored dots, staggered 180ms each, 1.2s loop.
// Uses a per-instance keyframes id so multiple instances don't fight.
function DotPulse() {
  const id = useId().replace(/[:]/g, "-");
  const keyframes = `txpulse-${id}`;
  return (
    <div
      data-slot="card-waiting-pulse"
      style={{
        display: "flex",
        gap: "var(--space-2)",
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: "var(--space-2)",
            height: "var(--space-2)",
            borderRadius: "var(--radius-full)",
            background: "var(--primary)",
            animation: `${keyframes} 1.2s ${i * 0.18}s infinite ease-in-out`,
          }}
        />
      ))}
      <style>{`@keyframes ${keyframes} { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }`}</style>
    </div>
  );
}

export function CardWaiting({ amountCents, deviceFriendlyName, onCancel }: CardWaitingProps) {
  return (
    <div
      data-slot="card-waiting"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-5)",
        padding: "var(--space-8)",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "var(--space-16)",
          height: "var(--space-16)",
          borderRadius: "var(--radius-full)",
          background: "color-mix(in oklch, var(--primary) 12%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--primary)",
        }}
      >
        <SquareTerminalIcon size={32} />
      </div>

      <div>
        <div
          data-slot="card-waiting-title"
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 600,
            letterSpacing: "var(--tracking-snug)",
            color: "var(--foreground)",
          }}
        >
          Hand the terminal to your client
        </div>
        <div
          data-slot="card-waiting-body"
          style={{
            fontSize: "var(--text-sm)",
            marginTop: "var(--space-2)",
            maxWidth: "calc(var(--space-16) * 6)",
            color: "var(--muted-foreground)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {deviceFriendlyName} is showing{" "}
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(amountCents)}</span>. They’ll
          choose a tip and tap or insert their card.
        </div>
      </div>

      <DotPulse />

      <div
        data-slot="card-waiting-caption"
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--muted-foreground)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        Waiting for payment confirmation…
      </div>

      <button
        type="button"
        data-slot="card-waiting-cancel"
        onClick={onCancel}
        style={{
          appearance: "none",
          background: "transparent",
          border: "none",
          padding: 0,
          color: "var(--primary)",
          fontSize: "var(--text-sm)",
          fontWeight: 500,
          cursor: "pointer",
          textDecoration: "underline",
        }}
      >
        Cancel and pick a different method
      </button>
    </div>
  );
}
