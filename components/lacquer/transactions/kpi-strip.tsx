// KpiStrip — the five-card KPI summary at the top of the Transactions page.
//
// Adapted from `design-system/prototypes/transaction/TransactionsPage.jsx`
// (`TPKpiStrip`). The cards summarise the *currently rendered* set of
// transactions: count (with a vs-previous-period delta), gross revenue,
// services rendered, tips collected, and average ticket. Money is
// server-authoritative — `computeKpis` only sums and averages cents; this
// component divides by 100 once at the render edge to hand `formatCurrency`
// dollars.
//
// Server Component. Chrome lives in `styles/transactions.css` under `.tp-kpis`
// / `.tp-kpi`. The up/down delta colour resolves to the `--success` /
// `--destructive` tokens via the `.delta.up` / `.delta.down` classes
// (research R9) — no raw colour enters this file. Icons are Lucide at 12px,
// 1.5px stroke (Constitution Principle I).

import { Hash, Receipt, Sparkles, TrendingUp, Wallet } from "lucide-react";

import type { TransactionKpis } from "@/lib/transactions/aggregate";
import { formatCurrency } from "@/lib/dashboard/format";

export type KpiStripProps = {
  kpis: TransactionKpis;
  /** Transaction count of the period one step further back, for the delta. */
  previousPeriodCount: number;
  /** Lower-cased period label, e.g. `"this week"`, shown under the count. */
  periodLabel: string;
};

// Percentage change of `count` vs `previousPeriodCount`. `null` when there is
// no previous-period baseline to compare against (a delta from zero is not
// meaningful).
function computeDeltaPct(count: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((count - previous) / previous) * 100);
}

export function KpiStrip({ kpis, previousPeriodCount, periodLabel }: KpiStripProps) {
  const deltaPct = computeDeltaPct(kpis.count, previousPeriodCount);
  const tipRatePct =
    kpis.grossRevenueCents > 0 ? Math.round((kpis.tipsCents / kpis.grossRevenueCents) * 100) : 0;

  return (
    <div className="tp-kpis" data-slot="transactions-kpi-strip">
      <div className="tp-kpi" data-slot="kpi-transactions">
        <div className="lbl">
          <span>Transactions</span>
          <Hash size={12} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="val">{kpis.count}</div>
        <div className="sub">
          <span>{periodLabel}</span>
          {deltaPct !== null && (
            <span className={`delta ${deltaPct >= 0 ? "up" : "down"}`}>
              {deltaPct >= 0 ? "+" : ""}
              {deltaPct}% vs previous
            </span>
          )}
        </div>
      </div>

      <div className="tp-kpi" data-slot="kpi-gross-revenue">
        <div className="lbl">
          <span>Gross revenue</span>
          <TrendingUp size={12} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="val">{formatCurrency(kpis.grossRevenueCents / 100)}</div>
        <div className="sub">
          <span>incl. tax + tip</span>
        </div>
      </div>

      <div className="tp-kpi" data-slot="kpi-services-rendered">
        <div className="lbl">
          <span>Services rendered</span>
          <Sparkles size={12} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="val">{kpis.servicesRendered}</div>
        <div className="sub">
          <span>{kpis.avgServicesPerSale.toFixed(1)} per sale</span>
        </div>
      </div>

      <div className="tp-kpi" data-slot="kpi-tips-collected">
        <div className="lbl">
          <span>Tips collected</span>
          <Wallet size={12} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="val">{formatCurrency(kpis.tipsCents / 100)}</div>
        <div className="sub">
          <span>{tipRatePct}% of revenue</span>
        </div>
      </div>

      <div className="tp-kpi" data-slot="kpi-avg-ticket">
        <div className="lbl">
          <span>Avg ticket</span>
          <Receipt size={12} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="val">{formatCurrency(kpis.avgTicketCents / 100)}</div>
        <div className="sub">
          <span>per transaction</span>
        </div>
      </div>
    </div>
  );
}
