import "@/styles/payroll.css";

import { redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalonTimezone } from "@/lib/db/settings";
import type { PayrollLedgerRow } from "@/lib/payroll/aggregate";
import { loadPayrollHistory, loadPayrollLedger } from "@/lib/payroll/queries";
import { formatClosedOn } from "@/lib/payroll/format";
import { parsePayrollParams, type PayrollFilter } from "@/lib/payroll/window";
import { ClosePeriodDialog } from "@/components/lacquer/payroll/close-period-dialog.client";
import { PayrollEmptyState } from "@/components/lacquer/payroll/payroll-empty-state";
import { PayrollExport } from "@/components/lacquer/payroll/payroll-export.client";
import { PayrollFilters } from "@/components/lacquer/payroll/payroll-filters.client";
import { PayrollHeader } from "@/components/lacquer/payroll/payroll-header";
import {
  PayrollHistory,
  type PayrollHistoryItem,
} from "@/components/lacquer/payroll/payroll-history.client";
import { PayrollKpis } from "@/components/lacquer/payroll/payroll-kpis";
import { PayrollLedger } from "@/components/lacquer/payroll/payroll-ledger";
import { PayrollPeriodSwitcher } from "@/components/lacquer/payroll/payroll-period-switcher.client";
import { PendingContent, PendingNavProvider } from "@/components/lacquer/pending-nav.client";

// Every navigation re-queries Supabase — the page browses live payroll
// periods, so no static caching. Mirrors `report/page.tsx`.
export const dynamic = "force-dynamic";

type SearchParamsShape = {
  offset?: string;
  filter?: string;
};

// Narrows the ledger rows by the active filter:
//  - "all"    → every row;
//  - "to-pay" → eligible rows not yet paid (pending / unpaid_closed);
//  - "paid"   → paid rows.
function applyFilter(
  rows: readonly PayrollLedgerRow[],
  filter: PayrollFilter
): readonly PayrollLedgerRow[] {
  if (filter === "paid") return rows.filter((r) => r.state === "paid");
  if (filter === "to-pay") {
    return rows.filter((r) => r.state === "pending" || r.state === "unpaid_closed");
  }
  return rows;
}

// The `?offset=&filter=` suffix the ledger rows carry into the tech-detail
// route, so back / prev / next preserve the period context (R7). Only
// non-default params are emitted.
function buildPeriodQuery(offset: number, filter: PayrollFilter): string {
  const params = new URLSearchParams();
  if (offset !== 0) params.set("offset", String(offset));
  if (filter !== "all") params.set("filter", filter);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsShape>;
}) {
  const viewer = await requireStudioSession();

  // Role gate. Owner + manager only — the sidebar already hides the entry for
  // technicians / front desk, but THIS redirect is the security boundary, not
  // the UX (Constitution Principle II). Silent, no flash. Copied verbatim from
  // the Report page guard.
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard");
  }

  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);

  // `?offset=&filter=` → sanitised params. Invalid / missing inputs collapse to
  // the open period (`offset 0`) and the `"all"` filter; a positive `offset` is
  // clamped to 0 (there are no future pay periods).
  const { offset, filter } = parsePayrollParams((await searchParams) ?? {});
  const model = await loadPayrollLedger(supabase, tz, offset);

  // Closed-period history — the full archive behind the header History button.
  const history = await loadPayrollHistory(supabase, tz);
  const historyItems: PayrollHistoryItem[] = history.map((entry) => ({
    id: entry.period.id ?? entry.period.startsOn,
    label: entry.period.label,
    totalPaidCents: entry.totalPaidCents,
    closedByName: entry.closedByName,
    closedOnLabel: formatClosedOn(entry.closedAt, tz),
    // A closed period older than the resolver search window has no offset —
    // fall back to the open-period URL so the link is never broken.
    href: entry.offset !== null ? `/payroll?offset=${entry.offset}` : "/payroll",
  }));

  // The Close-period CTA shows only for an owner on the OPEN, not-yet-closed
  // period — `closePeriod` re-checks both server-side. A closed period renders
  // read-only: no pay/undo on the ledger, no close control here.
  const canClose = viewer.staff.role === "owner" && !model.readOnly && model.period.id !== null;

  const filteredRows = applyFilter(model.rows, filter);
  const periodQuery = buildPeriodQuery(offset, filter);
  const counts = {
    all: model.rows.length,
    toPay: model.rows.filter((r) => r.state === "pending" || r.state === "unpaid_closed").length,
    paid: model.paidCount,
  };

  return (
    <div className="pr-app dr-app-page" data-slot="payroll-page">
      {/* The period switcher (header) and ledger filters drive `?offset=` /
          `?filter=` soft navigations; `PendingNavProvider` wraps the click in a
          transition and `PendingContent` dims the kpis + ledger while the
          re-fetch runs, since `loading.tsx` does not re-fire on a param-only
          soft nav (issue #197). The header stays outside `PendingContent` so
          the switcher remains live and undimmed while the body loads. */}
      <PendingNavProvider>
        <div className="pr-header">
          <PayrollHeader model={model} />
          <div className="pr-header-actions">
            <PayrollPeriodSwitcher
              periods={model.recentPeriods}
              activeOffset={model.period.offset}
            />
            <PayrollHistory items={historyItems} />
            {canClose ? (
              <ClosePeriodDialog
                payPeriodId={model.period.id as string}
                periodLabel={model.period.label}
              />
            ) : model.readOnly ? (
              <span className="pr-readonly-badge" data-slot="period-readonly-badge">
                <Lock size={16} strokeWidth={1.5} aria-hidden="true" />
                Closed
              </span>
            ) : null}
          </div>
        </div>

        <PendingContent>
          <PayrollKpis model={model} />

          {/* The empty state is for an OPEN period with no completed sales yet. A
              CLOSED period always renders its ledger — the figures come from the
              frozen `payroll_payouts` snapshots, not from live ticket data, so a
              period with no tickets but recorded payouts is not "empty". */}
          {model.isEmpty && !model.readOnly ? (
            <PayrollEmptyState />
          ) : (
            <div className="pp-ledger-body">
              <div className="pl-table-card">
                <div className="pl-table-head">
                  <PayrollFilters active={filter} counts={counts} />
                  <PayrollExport model={model} />
                </div>
                <PayrollLedger model={model} rows={filteredRows} periodQuery={periodQuery} />
              </div>
              <div className="pp-ledger-hint">
                Each row is one technician&apos;s earnings, tips, and cash payment for this pay
                period. The totals row reconciles every column.
              </div>
            </div>
          )}
        </PendingContent>
      </PendingNavProvider>
    </div>
  );
}
