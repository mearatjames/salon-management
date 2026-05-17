"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { DashboardPeriod, DashboardSummary } from "@/lib/dashboard/aggregate";

type Summaries = Record<DashboardPeriod, DashboardSummary>;

type PeriodContextValue = {
  period: DashboardPeriod;
  setPeriod: (next: DashboardPeriod) => void;
  summary: DashboardSummary;
};

const PeriodContext = createContext<PeriodContextValue | null>(null);

export type PeriodProviderProps = {
  summaries: Summaries;
  children: ReactNode;
};

// Island root — owns the active-period state shared by `<PeriodToggle />`
// (header) and `<PeriodSummary />` (stat grid). Both consumers read from the
// same React Context; toggling is a pure render swap (no network).
//
// FR-020: comparison badges (`+3 vs avg`, `+12%`) are removed in feature
// 015, so the provider no longer accepts or carries a `comparisons` field.
export function PeriodProvider({ summaries, children }: PeriodProviderProps) {
  const [period, setPeriodState] = useState<DashboardPeriod>("today");

  const setPeriod = useCallback(
    (next: DashboardPeriod) => {
      // Edge case "Period switch during slow render": re-selecting the active
      // period is a no-op so React skips the re-render entirely.
      if (next === period) return;
      setPeriodState(next);
    },
    [period]
  );

  const value: PeriodContextValue = {
    period,
    setPeriod,
    summary: summaries[period],
  };

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (ctx === null) {
    throw new Error(
      "usePeriod() must be called inside <PeriodProvider />. Ensure the dashboard page renders this consumer under <PeriodProvider />."
    );
  }
  return ctx;
}

const PERIODS: ReadonlyArray<{ id: DashboardPeriod; label: string }> = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

// Header consumer — three pill buttons. The container class `.tx-period` and
// the `.active` modifier are already defined in `styles/dashboard.css`. Native
// `<button>` elements inherit focus-visible from the shadcn primitive base.
export function PeriodToggle() {
  const { period, setPeriod } = usePeriod();
  return (
    <div className="tx-period" role="group" aria-label="Period">
      {PERIODS.map((p) => (
        <button
          key={p.id}
          type="button"
          className={p.id === period ? "active" : ""}
          aria-pressed={p.id === period}
          onClick={() => setPeriod(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
