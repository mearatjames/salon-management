"use client";

import { Receipt, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/dashboard/format";
import { StatCard } from "./stat-card";
import { PaymentMixCard } from "./payment-mix-card";
import { usePeriod } from "./period-toggle";

const PERIOD_SUB: Record<"today" | "week" | "month", string> = {
  today: "today",
  week: "week",
  month: "month",
};

// Client component — reads the active period summary + comparison strings
// from `usePeriod()` and lays out four `<StatCard />`s plus one
// `<PaymentMixCard />` in a six-column grid (the payment-mix tile spans the
// last two columns). FR-006: deltas render only when `period === "today"`.
export function PeriodSummary() {
  const { period, summary, comparisons } = usePeriod();

  const transactionsDelta =
    period === "today" ? comparisons.transactionsVsAvg : null;
  const revenueDelta = period === "today" ? comparisons.revenueDelta : null;

  // `avgServicesPerSale` is a real number (e.g. 1.41); the prototype renders
  // it to one decimal place — match that exactly.
  const avg = summary.avgServicesPerSale.toFixed(1);

  return (
    <div
      className="tx-stat-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 12,
      }}
    >
      <StatCard
        label="Transactions"
        value={summary.count}
        sub={PERIOD_SUB[period]}
        delta={transactionsDelta}
        icon={<Receipt size={14} strokeWidth={1.5} />}
      />
      <StatCard
        label="Services"
        value={summary.services}
        sub={`${avg}/sale`}
        icon={<Sparkles size={14} strokeWidth={1.5} />}
      />
      <StatCard
        label="Revenue"
        value={formatCurrency(summary.total)}
        sub="incl. tax + tip"
        delta={revenueDelta}
        icon={<TrendingUp size={14} strokeWidth={1.5} />}
      />
      <StatCard
        label="Tips"
        value={formatCurrency(summary.tip)}
        sub={`${summary.tipPctAvg}% avg`}
        icon={<Wallet size={14} strokeWidth={1.5} />}
      />
      <div style={{ gridColumn: "span 2" }}>
        <PaymentMixCard byMethod={summary.byMethod} total={summary.total} />
      </div>
    </div>
  );
}
