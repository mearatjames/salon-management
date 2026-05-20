// TransactionsView — the client island that owns the Transactions page body.
//
// Receives the period's `transactions` (already server-projected to the
// serialisable read model), the staff roster, and the previous-period count
// for the KPI delta. It computes the KPI strip with `computeKpis` and the day
// groups with `groupByDay`, then renders `<KpiStrip>` + `<TransactionsTable>`.
//
// US2 adds row selection: `selectedId` holds the clicked transaction's id, the
// table reflects it via its `selectedId` / `onRowClick` props, and a
// `<ReceiptDrawer>` renders for the matching `TransactionDetail`.
//
// US3 adds in-memory filtering: `search` / `method` / `techIds` state, the C4
// predicate (`visible`), and a `<FilterBar>` above the KPI strip. The KPI
// strip and the day-grouped table both render from the *filtered* set —
// `computeKpis` and `groupByDay` are recomputed over it. All of this is
// client-side over the already-loaded period payload; it never touches the
// URL or the network (contracts/transactions-read-model.md § C4, research R3).
//
// Period stepping itself is NOT client state: `<PeriodControls>` (a sibling
// Server Component rendered by the page) drives it through `?period=&offset=`
// URL navigation, so each window is a fresh server fetch (research R3).

"use client";

import { useCallback, useMemo, useState } from "react";

import type { Technician } from "@/lib/dashboard/aggregate";
import { computeKpis, groupByDay, type TransactionDetail } from "@/lib/transactions/aggregate";
import {
  FilterBar,
  type MethodCounts,
  type MethodFilter,
} from "@/components/lacquer/transactions/filter-bar";
import { KpiStrip } from "@/components/lacquer/transactions/kpi-strip";
import { ReceiptDrawer } from "@/components/lacquer/transactions/receipt-drawer";
import { TransactionsTable } from "@/components/lacquer/transactions/transactions-table";

export type TransactionsViewProps = {
  transactions: readonly TransactionDetail[];
  staff: readonly Technician[];
  previousPeriodCount: number;
  todayKey: string;
  /** Lower-cased period label, e.g. `"this week"`, shown under the KPI count. */
  periodLabel: string;
};

// C4 § search clause — case-insensitive, trimmed, substring over the client
// name, the display id, and any line-item name. `lowerSearch` is pre-trimmed
// + lower-cased by the caller; an empty string here means "no search".
function matchesSearch(tx: TransactionDetail, lowerSearch: string): boolean {
  if (lowerSearch === "") return true;
  if (tx.client.toLowerCase().includes(lowerSearch)) return true;
  if (tx.displayId.toLowerCase().includes(lowerSearch)) return true;
  return tx.items.some((item) => item.name.toLowerCase().includes(lowerSearch));
}

// C4 § tech clause — true when no tech is selected, or the transaction's
// `techIds` intersects the selected set.
function matchesTechs(tx: TransactionDetail, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  return tx.techIds.some((id) => selected.has(id));
}

export function TransactionsView({
  transactions,
  staff,
  previousPeriodCount,
  todayKey,
  periodLabel,
}: TransactionsViewProps) {
  // US3 filter state — all in-memory over the loaded period (contract C4).
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState<MethodFilter>("all");
  const [techIds, setTechIds] = useState<readonly string[]>([]);

  const hasActiveFilters = search.trim() !== "" || method !== "all" || techIds.length > 0;

  // The filtered set drives both the KPI strip and the table (contract C4).
  // The method clause is excluded here and applied separately so the live
  // per-method chip counts can reflect search + tech only.
  const lowerSearch = search.trim().toLowerCase();
  const selectedTechSet = useMemo(() => new Set(techIds), [techIds]);

  // Search + tech filtered — the base for the live method counts.
  const searchTechFiltered = useMemo(
    () =>
      transactions.filter(
        (tx) => matchesSearch(tx, lowerSearch) && matchesTechs(tx, selectedTechSet)
      ),
    [transactions, lowerSearch, selectedTechSet]
  );

  // The fully-filtered set adds the method clause (contract C4).
  const filtered = useMemo(
    () =>
      method === "all"
        ? searchTechFiltered
        : searchTechFiltered.filter((tx) => tx.method === method),
    [searchTechFiltered, method]
  );

  // Live per-method counts — each chip shows how many transactions would match
  // that method given the *other* active filters (search + tech). `all` is the
  // size of the search/tech-filtered set; a `split` transaction matches no
  // single-method chip so the three method counts need not sum to `all`.
  const methodCounts = useMemo<MethodCounts>(() => {
    const counts: MethodCounts = {
      all: searchTechFiltered.length,
      card: 0,
      cash: 0,
      gift: 0,
    };
    for (const tx of searchTechFiltered) {
      if (tx.method === "card" || tx.method === "cash" || tx.method === "gift") {
        counts[tx.method] += 1;
      }
    }
    return counts;
  }, [searchTechFiltered]);

  // KPI strip + day groups render from the filtered set (contract C4).
  const kpis = useMemo(() => computeKpis(filtered), [filtered]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setMethod("all");
    setTechIds([]);
  }, []);

  // US2: the selected row's id, if any. Clicking a row sets it (opens the
  // receipt drawer); the drawer's three dismissal paths clear it.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleRowClick = useCallback((transaction: TransactionDetail) => {
    setSelectedId(transaction.id);
  }, []);
  const handleDrawerClose = useCallback(() => {
    setSelectedId(null);
  }, []);

  // Resolve the selected transaction from the *filtered* set. If a period step
  // or a filter change drops the id, the drawer closes.
  const selectedTransaction = useMemo(
    () => filtered.find((tx) => tx.id === selectedId) ?? null,
    [filtered, selectedId]
  );

  return (
    <>
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        method={method}
        onMethodChange={setMethod}
        techIds={techIds}
        onTechIdsChange={setTechIds}
        staff={staff}
        methodCounts={methodCounts}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={handleClearFilters}
      />
      <KpiStrip kpis={kpis} previousPeriodCount={previousPeriodCount} periodLabel={periodLabel} />
      <TransactionsTable
        groups={groups}
        staff={staff}
        todayKey={todayKey}
        selectedId={selectedTransaction ? selectedTransaction.id : null}
        onRowClick={handleRowClick}
        filtersActive={hasActiveFilters}
        onClearFilters={handleClearFilters}
      />
      {selectedTransaction ? (
        <ReceiptDrawer
          transaction={selectedTransaction}
          staff={staff}
          onClose={handleDrawerClose}
        />
      ) : null}
    </>
  );
}
