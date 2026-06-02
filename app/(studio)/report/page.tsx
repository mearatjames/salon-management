import "@/styles/report.css";

import { redirect } from "next/navigation";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalonTimezone } from "@/lib/db/settings";
import { loadReportPage } from "@/lib/report/queries";
import { parseReportPeriodParams, resolveReportWindow } from "@/lib/report/window";
import { salonNow } from "@/lib/time/period-windows";
import { ReportActions } from "@/components/lacquer/report/report-actions.client";
import { ReportEmptyState } from "@/components/lacquer/report/report-empty-state";
import { ReportPeriodControls } from "@/components/lacquer/report/report-period-controls";
import { ReportSummary } from "@/components/lacquer/report/report-summary";
import { ReportView } from "@/components/lacquer/report/report-view.client";
import { PendingContent, PendingNavProvider } from "@/components/lacquer/pending-nav.client";

// Every navigation re-queries Supabase — the page browses live historical
// reporting periods, so no static caching. Mirrors `transactions/page.tsx`.
export const dynamic = "force-dynamic";

type SearchParamsShape = {
  period?: string;
  offset?: string;
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsShape>;
}) {
  const viewer = await requireStudioSession();

  // Role gate. Owner + manager only — the sidebar already hides the entry for
  // technicians / front desk, but THIS redirect is the security boundary, not
  // the UX (contract C1, Constitution Principle II). Silent, no flash.
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard");
  }

  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);

  // `?period=&offset=` → sanitised window. Invalid / missing inputs collapse
  // to "current day" inside `parseReportPeriodParams`; a positive `offset` is
  // clamped to 0 (forward stepping past the present is forbidden — contract C1).
  const { granularity, offset } = parseReportPeriodParams((await searchParams) ?? {});
  const window = resolveReportWindow(tz, granularity, offset, salonNow(tz));
  const { report } = await loadReportPage(supabase, window);

  return (
    <div className="dr-app dr-app-page">
      <div className="tp-head">
        <div>
          <h1>Report</h1>
          <div className="sub">
            Per-technician earnings, deductions, and card tips for the selected period. The totals
            row reconciles every column against the technicians above it.
          </div>
        </div>
        {/* Print + Export actions — the client island for User Story 5. */}
        <ReportActions report={report} window={window} />
      </div>

      {/* The period toggle + range stepper drive `?period=&offset=` soft
          navigations; `PendingNavProvider` wraps the click in a transition and
          `PendingContent` dims the data region while the re-fetch runs, since
          `loading.tsx` does not re-fire on a param-only soft nav (issue #197). */}
      <PendingNavProvider>
        <ReportPeriodControls window={window} />

        <PendingContent>
          {report.isEmpty ? (
            <ReportEmptyState />
          ) : (
            <>
              <ReportSummary totals={report.totals} />
              <ReportView report={report} />
            </>
          )}
        </PendingContent>
      </PendingNavProvider>
    </div>
  );
}
