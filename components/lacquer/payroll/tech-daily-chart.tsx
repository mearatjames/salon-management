// TechDailyChart — the large daily-activity chart on the tech-detail screen
// (US2). One column per calendar day of the pay period: a service-income bar
// and (stacked above it) a card-tip bar, the best day highlighted, closed days
// dimmed with a dotted baseline. Quick stats — best day, average per working
// day — sit in the card header. A `no_work` tech shows an empty state.
//
// Presentational Server Component. Adapted from
// `design-system/prototypes/payroll/PayrollPulse.jsx` (`PulseDetailScreen`'s
// `.pp-detail-chart-card` block). Every value traces to a `styles/payroll.css`
// / `styles/tokens.css` token (Constitution Principle I); the bar heights are
// computed pixel values, not design tokens. Currency via `formatCurrency`,
// counts via `formatCount`.

import { Clock } from "lucide-react";

import { formatCount, formatCurrency } from "@/lib/dashboard/format";
import type { DayActivity } from "@/lib/payroll/aggregate";

export type TechDailyChartProps = {
  /** One entry per calendar day of the period window. */
  days: readonly DayActivity[];
  bestDay: { date: string; amountCents: number } | null;
  avgPerWorkingDayCents: number;
  workingDayCount: number;
  /** The period range label, e.g. "May 16 – 31". */
  periodLabel: string;
  /** The tech's display name — for the no-work empty-state copy. */
  techName: string;
  /** `true` when the tech booked nothing this period. */
  isNoWork: boolean;
};

// Bar geometry — the income bar tops out at 180px so the 200px-tall column has
// room for the stacked tip bar.
const INCOME_MAX_PX = 180;
const TIP_MAX_PX = 40;

export function TechDailyChart({
  days,
  bestDay,
  avgPerWorkingDayCents,
  workingDayCount,
  periodLabel,
  techName,
  isNoWork,
}: TechDailyChartProps) {
  // Scale references — the busiest day's income and tips set the bar maxima.
  const maxIncome = Math.max(1, ...days.map((d) => d.serviceIncomeCents));
  const maxTip = Math.max(1, ...days.map((d) => d.cardTipsCents));

  return (
    <div className="pp-detail-chart-card" data-slot="tech-daily-chart">
      <div className="pp-detail-chart-card-head">
        <div>
          <div className="pl-section-title">Daily activity</div>
          <div className="pp-detail-chart-sub">{periodLabel}</div>
        </div>
        <div className="pp-detail-chart-stats">
          <div className="pp-stat">
            <div className="pp-stat-l">Best day</div>
            <div className="pp-stat-v">
              {bestDay ? `Day ${Number(bestDay.date.split("-")[2])}` : "—"}
            </div>
            <div className="pp-stat-s">
              {bestDay ? formatCurrency(bestDay.amountCents / 100) : "No working days"}
            </div>
          </div>
          <div className="pp-stat">
            <div className="pp-stat-l">Avg per working day</div>
            <div className="pp-stat-v">{formatCurrency(avgPerWorkingDayCents / 100)}</div>
            <div className="pp-stat-s">
              {formatCount(workingDayCount)} day{workingDayCount === 1 ? "" : "s"} worked
            </div>
          </div>
          <div className="pp-stat">
            <div className="pp-stat-l">Cash tips</div>
            <div className="pp-stat-v muted">—</div>
            <div className="pp-stat-s">Not recorded</div>
          </div>
        </div>
      </div>

      {isNoWork ? (
        <div className="pl-detail-empty" data-slot="chart-empty">
          <Clock size={36} strokeWidth={1.5} aria-hidden="true" />
          <div>{techName} didn&apos;t book any tickets this period.</div>
        </div>
      ) : (
        <>
          <div
            className="pp-detail-chart-grid-big"
            style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)` }}
          >
            {days.map((day) => {
              const inc = day.serviceIncomeCents;
              const tip = day.cardTipsCents;
              const isBest = bestDay !== null && bestDay.date === day.date;
              const isWeekend = day.weekday === "Sat" || day.weekday === "Sun";
              const incH = inc > 0 ? Math.max(2, (inc / maxIncome) * INCOME_MAX_PX) : 0;
              const tipH = tip > 0 ? Math.max(3, (tip / maxTip) * TIP_MAX_PX) : 0;
              const colClass = [
                "pp-detail-col",
                day.closed ? "closed" : "",
                isWeekend ? "weekend" : "",
                isBest ? "best" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={day.date}
                  className={colClass}
                  data-slot="chart-day"
                  data-date={day.date}
                  data-closed={day.closed}
                >
                  <div className="pp-detail-col-amt">
                    {inc > 0 ? formatCurrency(inc / 100) : ""}
                  </div>
                  <div className="pp-detail-bars" style={{ height: 200 }}>
                    {tip > 0 && (
                      <div
                        className="tip"
                        style={{ height: tipH }}
                        title={`Card tips ${formatCurrency(tip / 100)}`}
                      />
                    )}
                    {inc > 0 && (
                      <div
                        className="inc"
                        style={{ height: incH }}
                        title={`${day.weekday} ${day.dayOfMonth} · ${formatCurrency(inc / 100)}`}
                      />
                    )}
                    {day.closed && <div className="zero" />}
                  </div>
                  <div className="pp-detail-d">{day.dayOfMonth}</div>
                  <div className="pp-detail-wd">{day.weekday}</div>
                  {!day.closed && day.ticketCount > 0 && (
                    <div className="pp-detail-tkts">
                      {day.ticketCount} tkt{day.ticketCount === 1 ? "" : "s"}
                    </div>
                  )}
                  {day.closed && <div className="pp-detail-tkts closed-lbl">closed</div>}
                </div>
              );
            })}
          </div>
          <div className="pp-detail-chart-legend">
            <span>
              <span className="sw service" /> Service income
            </span>
            <span>
              <span className="sw tip" /> Card tips
            </span>
            <span>
              <span className="sw best" /> Best day
            </span>
          </div>
        </>
      )}
    </div>
  );
}
