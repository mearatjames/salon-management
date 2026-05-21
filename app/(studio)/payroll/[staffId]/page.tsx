import "@/styles/payroll.css";

import { notFound, redirect } from "next/navigation";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalonTimezone } from "@/lib/db/settings";
import { formatPayDate } from "@/lib/payroll/format";
import { loadTechDetail } from "@/lib/payroll/queries";
import { parsePayrollParams } from "@/lib/payroll/window";
import { TechBreakdown } from "@/components/lacquer/payroll/tech-breakdown";
import { TechDailyChart } from "@/components/lacquer/payroll/tech-daily-chart";
import { TechDetailHeader } from "@/components/lacquer/payroll/tech-detail-header";
import { TechDetailNav } from "@/components/lacquer/payroll/tech-detail-nav.client";
import { TechPayAction } from "@/components/lacquer/payroll/tech-pay-action.client";

// Every navigation re-queries Supabase — the page browses live payroll
// periods, so no static caching. Mirrors `payroll/page.tsx`.
export const dynamic = "force-dynamic";

type SearchParamsShape = {
  offset?: string;
  filter?: string;
};

// Rebuilds the `?offset=&filter=` query string the detail screen carries back
// to the ledger and across prev/next. Only non-default params are emitted, so
// the open period with the "all" filter yields an empty string.
function buildPeriodQuery(offset: number, filter: string): string {
  const params = new URLSearchParams();
  if (offset !== 0) params.set("offset", String(offset));
  if (filter !== "all") params.set("filter", filter);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function TechDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffId: string }>;
  searchParams?: Promise<SearchParamsShape>;
}) {
  const viewer = await requireStudioSession();

  // Role gate — owner + manager only. The route is the security boundary, not
  // the nav (Constitution Principle II). Identical to the `/payroll` guard.
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard");
  }

  const { staffId } = await params;
  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);

  // `?offset=&filter=` → sanitised params. The detail screen carries them
  // through every back / prev / next navigation so the ledger context survives.
  const { offset, filter } = parsePayrollParams((await searchParams) ?? {});
  const detail = await loadTechDetail(supabase, tz, offset, staffId);

  // No ledger row for this id in the period — a stale link or a tech who never
  // worked and is no longer active. A 404 is the honest answer.
  if (detail === null) {
    notFound();
  }

  const periodQuery = buildPeriodQuery(offset, filter);
  const isNoWork = detail.row.state === "no_work";

  // The pay-action card is offered only for an eligible tech in an OPEN period
  // — never for a `no_work` tech (nothing to pay) and never for a closed period
  // (read-only — FR-025). `period.id` is non-null once the row is lazily
  // ensured; guard anyway. The `recordPayout` action re-checks both rules
  // server-side, so this is a UI affordance gate, not the security boundary.
  const canPay = !isNoWork && !detail.readOnly && detail.period.id !== null;

  return (
    <div className="pr-app pp-detail-screen dr-app-page" data-slot="tech-detail-page">
      <TechDetailNav
        periodQuery={periodQuery}
        periodLabel={detail.period.shortLabel}
        prevStaffId={detail.prevStaffId}
        nextStaffId={detail.nextStaffId}
      />

      <TechDetailHeader row={detail.row} />

      <div className="pp-detail-grid">
        <TechDailyChart
          days={detail.days}
          bestDay={detail.bestDay}
          avgPerWorkingDayCents={detail.avgPerWorkingDayCents}
          workingDayCount={detail.workingDayCount}
          periodLabel={detail.period.label}
          techName={detail.row.displayName}
          isNoWork={isNoWork}
        />
        <div className="pp-detail-side">
          <TechBreakdown row={detail.row} />
          {canPay && (
            <TechPayAction
              payPeriodId={detail.period.id as string}
              row={detail.row}
              payDateLabel={formatPayDate(detail.period)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
