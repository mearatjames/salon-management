// TechDetailHeader — the tech-detail screen header band (US2).
//
// Avatar + name + rate meta on the left; the state badge and the big "cash to
// hand over" figure on the right. A `no_work` tech shows only the badge — there
// is nothing to hand over.
//
// Presentational Server Component. Adapted from
// `design-system/prototypes/payroll/PayrollPulse.jsx` (`PulseDetailScreen`'s
// `.pp-detail-header` block). Every value traces to a `styles/payroll.css` /
// `styles/tokens.css` token (Constitution Principle I). Currency via the shared
// `formatCurrency`; percentages via `formatPercent`; counts via `formatCount`.

import { formatCount, formatCurrency, formatPercent } from "@/lib/dashboard/format";
import type { PayrollLedgerRow } from "@/lib/payroll/aggregate";
import { formatPaidOn } from "@/lib/payroll/format";
import { InitialsAvatar } from "@/components/lacquer/initials-avatar";

export type TechDetailHeaderProps = {
  row: PayrollLedgerRow;
};

// The state badge — one per ledger-row state (mirrors the ledger's StatePill,
// with the detail screen's fuller copy).
function StateBadge({ row }: { row: PayrollLedgerRow }) {
  if (row.state === "no_work") {
    return (
      <span className="pl-state pl-state-skip" data-slot="state-pill" data-state="no_work">
        <span className="dot" /> No work this period
      </span>
    );
  }
  if (row.state === "paid") {
    const method = row.payout?.method;
    const methodLabel = method ? `${method[0].toUpperCase()}${method.slice(1)}` : "";
    const paidOn = formatPaidOn(row.payout?.paidOn ?? null);
    const suffix = [methodLabel, paidOn].filter(Boolean).join(" · ");
    return (
      <span className="pl-state pl-state-paid" data-slot="state-pill" data-state="paid">
        <span className="dot" /> Paid{suffix ? ` · ${suffix}` : ""}
      </span>
    );
  }
  if (row.state === "unpaid_closed") {
    return (
      <span className="pl-state pl-state-unpaid" data-slot="state-pill" data-state="unpaid_closed">
        <span className="dot" /> Unpaid
      </span>
    );
  }
  return (
    <span className="pl-state pl-state-pending" data-slot="state-pill" data-state="pending">
      <span className="dot" /> Pending payment
    </span>
  );
}

// A net-payout label that carries its own minus sign when negative.
function netCurrency(cents: number): string {
  if (cents < 0) return `−${formatCurrency(Math.abs(cents) / 100)}`;
  return formatCurrency(cents / 100);
}

// A signed adjustment label, e.g. "+$12" / "−$5".
function signedCurrency(cents: number): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${formatCurrency(Math.abs(cents) / 100)}`;
}

export function TechDetailHeader({ row }: TechDetailHeaderProps) {
  const isNoWork = row.state === "no_work";
  const hasAdjustments = row.adjustments.length > 0;

  return (
    <div className="pp-detail-header" data-slot="tech-detail-header">
      <div className="pp-detail-header-l">
        <InitialsAvatar
          name={row.displayName}
          colorToken={row.colorToken}
          size={56}
          data-slot="tech-avatar"
          data-staff-name={row.displayName}
        />
        <div>
          <div className="pp-detail-eyebrow">Tech payroll</div>
          <div className="pp-detail-name">{row.displayName}</div>
          <div className="pp-detail-meta">
            {row.role} · <span className="tnum">{formatPercent(row.serviceCommissionPct)}</span>{" "}
            service / <span className="tnum">{formatPercent(row.tipSplitPct)}</span> tips
            {!isNoWork && (
              <>
                {" "}
                · <span className="tnum">{formatCount(row.ticketCount)}</span> tickets across the
                period
              </>
            )}
          </div>
        </div>
      </div>

      <div className="pp-detail-header-r">
        <StateBadge row={row} />
        {!isNoWork && (
          <div className="pp-detail-bignum" data-slot="cash-to-hand-over">
            <div className="pp-detail-bignum-l">
              {hasAdjustments ? "Net payout" : "Cash to hand over"}
            </div>
            <div className="pp-detail-bignum-v">{netCurrency(row.netPayoutCents)}</div>
            <div className="pp-detail-bignum-s">
              {hasAdjustments ? (
                <>
                  <span className="tnum">{formatCurrency(row.cashPaymentCents / 100)}</span> cash ·{" "}
                  <span className="tnum">{signedCurrency(row.adjustmentsCents)}</span> adj
                </>
              ) : (
                <>+ {formatCurrency(row.checkPortionCents / 100)} reported on check</>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
