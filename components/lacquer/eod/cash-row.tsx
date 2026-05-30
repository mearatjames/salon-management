// CashRow — one row of the End-of-Day cash list.
//
// Pure presentational; server-renderable. Layout mirrors the prototype
// `design-system/prototypes/transaction/EndOfDay.jsx` (the `.eod-tx-row`
// grid: time | body | amount column). All colors / spacings resolve to
// tokens via the `.eod-*` classes in `styles/end-of-day.css`.
//
// Refund variant: when `kind='refund'`, the amount column renders the
// total as a negative dollar value tinted with `var(--destructive)` (via
// the `.eod-tx-row.refund` selector) AND the meta line drops the service
// summary in favour of a small uppercase "Refund" chip. The
// `payments.kind` enum doesn't include `refund` today, so this branch is
// forward-compat for the refund-flow feature.

import type { TechBadge } from "@/lib/end-of-day/aggregate";
import { RefundEntry } from "@/components/lacquer/transactions/refund-entry.client";

export type CashRowProps = {
  kind: "payment" | "refund";
  /** Formatted local time, e.g. "9:12 AM". */
  time: string;
  client: string;
  /** Pre-formatted service summary string. */
  services: string;
  techs: TechBadge[];
  amountCents: number;
  tipCents: number;
  /**
   * Feature 052 (US2): the ticket id for the refund affordance. When
   * `canRefund` is true and this is a `payment` row, an owner/manager
   * "Refund" control renders in the amount column.
   */
  ticketId?: string;
  canRefund?: boolean;
};

function formatDollarsAbs(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return abs.toFixed(2);
}

export function CashRow({
  kind,
  time,
  client,
  services,
  techs,
  amountCents,
  tipCents,
  ticketId,
  canRefund = false,
}: CashRowProps) {
  const isRefund = kind === "refund";
  const className = isRefund ? "eod-tx-row refund" : "eod-tx-row";
  const amountLabel = isRefund
    ? `−$${formatDollarsAbs(amountCents)}`
    : `$${formatDollarsAbs(amountCents)}`;
  // The refund affordance only attaches to original payment rows.
  const showRefund = canRefund && !isRefund && Boolean(ticketId);

  return (
    <div
      className={className}
      data-slot={showRefund ? "eod-refund-row" : "eod-cash-row"}
      data-kind={kind}
      data-tx-id={ticketId}
    >
      <div className="eod-tx-time">{time}</div>
      <div className="eod-tx-body">
        <div className="eod-tx-client">{client}</div>
        <div className="eod-tx-meta">
          {isRefund ? (
            <RefundChip />
          ) : (
            <>
              {services ? <span className="eod-tx-svc">{services}</span> : null}
              {services && techs.length > 0 ? <span className="eod-tx-sep">·</span> : null}
            </>
          )}
          {techs.map((tech) => (
            <TechNamePill key={tech.id} tech={tech} />
          ))}
        </div>
      </div>
      <div
        className="eod-tx-amt-col"
        style={
          showRefund
            ? { display: "flex", flexDirection: "row", alignItems: "center", gap: "var(--space-2)" }
            : undefined
        }
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div className="eod-tx-total tnum">{amountLabel}</div>
          {tipCents > 0 ? (
            <div className="eod-tx-tip tnum">incl. ${(tipCents / 100).toFixed(2)} tip</div>
          ) : null}
        </div>
        {showRefund ? <RefundEntry ticketId={ticketId!} canRefund variant="feed" /> : null}
      </div>
    </div>
  );
}

// Small inline name-pill rendering a tech badge in the dense End-of-Day
// list. Keeps the pill shape (a circular avatar would be heavy for this
// row) but uses the same color scheme as the app-wide `InitialsAvatar`:
// a 15% wash of the staff color token behind the token-colored initials.
function TechNamePill({ tech }: { tech: TechBadge }) {
  const bg = tech.colorToken ? `oklch(from var(${tech.colorToken}) l c h / 0.15)` : "var(--muted)";
  const color = tech.colorToken ? `var(${tech.colorToken})` : "var(--muted-foreground)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 7px",
        borderRadius: 9999,
        fontSize: 10,
        fontWeight: 500,
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        background: bg,
        color,
      }}
    >
      {tech.initials}
    </span>
  );
}

function RefundChip() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 7px",
        borderRadius: 9999,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        lineHeight: 1.6,
        whiteSpace: "nowrap",
        background: "color-mix(in oklch, var(--destructive) 12%, transparent)",
        color: "var(--destructive)",
      }}
    >
      Refund
    </span>
  );
}
