// TransactionsTable — the day-grouped transaction list.
//
// Adapted from `design-system/prototypes/transaction/TransactionsPage.jsx`
// (the `tp-table-scroll` block). Each day renders a `.tp-day-h` header (full
// date + relative label + count / revenue / tips) above a `.tp-table` of its
// transactions. Rows are clickable: `onRowClick` fires the row's `TransactionDetail`,
// and the row matching `selectedId` carries the `selected` class.
//
// When there are no transactions the empty state renders instead. US3 splits
// it into two variants: the *period-empty* state (a genuinely empty window —
// step back / widen the period) and the *filtered-empty* state (the period
// has rows but the active filters match none — offers a one-click "Clear
// filters"). `filtersActive` picks between them (FR-017).
//
// Client Component (it carries the row `onClick`). All chrome lives in
// `styles/transactions.css` under `.tp-table*` / `.tp-day-*` / `.tp-empty`.
// Numeric / time / money columns carry tabular numerals via the stylesheet
// (Constitution Principle I).

"use client";

import { Receipt, SearchX } from "lucide-react";

import type { Technician } from "@/lib/dashboard/aggregate";
import { formatCurrency, formatServiceLabel } from "@/lib/dashboard/format";
import type { DayGroup, TransactionDetail } from "@/lib/transactions/aggregate";
import { formatDayLabel, formatRelativeDay } from "@/lib/transactions/format";
import { MethodPill } from "@/components/lacquer/method-pill";
import { TechStack } from "@/components/lacquer/tech-stack";

export type TransactionsTableProps = {
  /** Day-grouped transactions, newest day first. Empty ⇒ period-empty state. */
  groups: readonly DayGroup[];
  /** Staff roster, for resolving `<TechStack>` avatars. */
  staff: readonly Technician[];
  /** Salon-local `YYYY-MM-DD` for "today", drives the relative day label. */
  todayKey: string;
  /** `id` of the currently-selected transaction, if any. */
  selectedId?: string | null;
  /** Fired with the row's transaction when a row is clicked. */
  onRowClick?: (transaction: TransactionDetail) => void;
  /** True when any search / method / tech filter is active (US3). Picks the
   * filtered-empty state over the period-empty state when `groups` is empty. */
  filtersActive?: boolean;
  /** Resets every filter — wired to the filtered-empty state's action (US3). */
  onClearFilters?: () => void;
};

// Feature 052: compact badge label per reversal outcome for the dense table
// row — "Partial" keeps the pill inside the fixed-width client column (the
// receipt drawer spells out "Partially refunded"). Sentence case (Principle I).
const REVERSAL_LABEL: Record<NonNullable<TransactionDetail["reversal"]>, string> = {
  void: "Voided",
  refunded: "Refunded",
  partially_refunded: "Partial",
};

// The non-discount service names of a transaction, summarised to one cell.
function serviceSummary(transaction: TransactionDetail): string {
  const names = transaction.items
    .filter((item) => item.kind !== "discount")
    .map((item) => item.name);
  return formatServiceLabel(names);
}

export function TransactionsTable({
  groups,
  staff,
  todayKey,
  selectedId,
  onRowClick,
  filtersActive = false,
  onClearFilters,
}: TransactionsTableProps) {
  if (groups.length === 0) {
    // Filtered-empty (FR-017): the window has rows but the active filters
    // match none — offer a one-click reset. Distinct from the period-empty
    // state below (a genuinely empty window).
    if (filtersActive) {
      return (
        <div className="tp-table-scroll" data-slot="transactions-table">
          <div className="tp-empty" data-slot="transactions-empty" data-empty-kind="filtered">
            <div className="ic">
              <SearchX size={20} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div>
              <div className="ttl">No transactions match these filters</div>
              <div className="ds">
                Try a different search, method, or tech — or clear the filters to see the full
                period.
              </div>
            </div>
            <button
              type="button"
              className="tp-filter-btn"
              data-slot="filtered-empty-clear"
              onClick={() => onClearFilters?.()}
            >
              Clear filters
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="tp-table-scroll" data-slot="transactions-table">
        <div className="tp-empty" data-slot="transactions-empty" data-empty-kind="period">
          <div className="ic">
            <Receipt size={20} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div>
            <div className="ttl">No transactions in this period</div>
            <div className="ds">Step back with the arrows, or pick a wider period to see more.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tp-table-scroll" data-slot="transactions-table">
      {groups.map((group) => (
        <div key={group.dayKey} className="tp-day-group" data-day-key={group.dayKey}>
          <div className="tp-day-h">
            <div className="date">
              {formatDayLabel(group.dayKey)}
              <span className="rel">{formatRelativeDay(group.dayKey, todayKey)}</span>
            </div>
            <div className="stat">
              <b>{group.count}</b> tx
            </div>
            <div className="stat">
              <b>{formatCurrency(group.revenueCents / 100)}</b> revenue
            </div>
            <div className="stat">
              <b>{formatCurrency(group.tipsCents / 100)}</b> tips
            </div>
          </div>
          <table className="tp-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>ID</th>
                <th>Client</th>
                <th>Services</th>
                <th>Techs</th>
                <th>Method</th>
                <th className="num">Subtotal</th>
                <th className="num">Tip</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {group.transactions.map((transaction) => (
                <tr
                  key={transaction.id}
                  data-tx-id={transaction.id}
                  // `refunded` (a prototype row treatment: muted + struck
                  // amounts) flags any reversal — the `.tp-net` span opts back
                  // out of the strike to show the retained net.
                  className={
                    [
                      selectedId === transaction.id ? "selected" : "",
                      transaction.reversal ? "refunded" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  onClick={() => onRowClick?.(transaction)}
                >
                  <td className="time">{transaction.time}</td>
                  <td className="id">{transaction.displayId}</td>
                  <td className="client">
                    {/* The reversal badge lives here (not the fixed 96px mono
                        ID column, where it overflowed into this cell): the
                        client column can wrap, so the badge stacks under the
                        name. */}
                    <span className="tp-client-cell">
                      <b>{transaction.client}</b>
                      {transaction.reversal ? (
                        <span
                          className="tp-reversal-badge"
                          data-slot="tx-reversal-badge"
                          data-reversal={transaction.reversal}
                        >
                          {REVERSAL_LABEL[transaction.reversal]}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="services">{serviceSummary(transaction)}</td>
                  <td>
                    <TechStack staff={staff} ids={transaction.techIds} size={20} />
                  </td>
                  <td>
                    <MethodPill method={transaction.method} />
                  </td>
                  <td className="num">{formatCurrency(transaction.subtotalCents / 100)}</td>
                  <td className="num">{formatCurrency(transaction.tipCents / 100)}</td>
                  <td className="num total">
                    {formatCurrency(transaction.totalCents / 100)}
                    {transaction.reversal ? (
                      <span className="tp-net" data-slot="tx-net">
                        net {formatCurrency(transaction.netTotalCents / 100)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
