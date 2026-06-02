import "@/styles/transactions.css";

import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalonTimezone } from "@/lib/db/settings";
import { payPeriodForClosedAt, payPeriodsFinalizedByStartsOn } from "@/lib/payroll/finalized";
import { salonNow } from "@/lib/time/period-windows";
import { loadTransactionsPage } from "@/lib/transactions/queries";
import { parsePeriodParams, resolveWindow } from "@/lib/transactions/window";
import { PeriodControls } from "@/components/lacquer/transactions/period-controls";
import { TransactionsView } from "@/components/lacquer/transactions/transactions-view.client";

// Every navigation re-queries Supabase — the page browses live historical
// periods, so no static caching. Mirrors `dashboard/page.tsx` and
// `end-of-day/page.tsx` (research R3 — `?period=&offset=` drives a fresh
// server fetch on each navigation).
export const dynamic = "force-dynamic";

type SearchParamsShape = {
  period?: string;
  offset?: string;
};

export default async function TransactionsPage({
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
  // to "this week, current period" inside `parsePeriodParams`.
  const { granularity, offset } = parsePeriodParams((await searchParams) ?? {});
  const window = resolveWindow(tz, granularity, offset, salonNow(tz));

  const { transactions, staff, previousPeriodCount, todayKey } = await loadTransactionsPage(
    supabase,
    window
  );

  // Feature 050: stamp `payPeriodFinalized` per transaction so the drawer's
  // per-line chip can lock when the period has been closed or paid out
  // (FR-002, FR-004). Collect the distinct pay periods the page's paid lines
  // fall into, then resolve their finalized status in a single batch RPC —
  // one query regardless of how many periods the page spans (#196). Previously
  // this fired one `isPayPeriodFinalized` query per distinct period.
  const distinctStartsOn = new Set<string>();
  for (const tx of transactions) {
    if (!tx.closedAtIso) continue;
    distinctStartsOn.add(payPeriodForClosedAt(tz, tx.closedAtIso).startsOn);
  }
  const finalizedByStartsOn = await payPeriodsFinalizedByStartsOn(
    supabase,
    Array.from(distinctStartsOn)
  );
  const stampedTransactions = transactions.map((tx) => {
    if (!tx.closedAtIso) return tx;
    const startsOn = payPeriodForClosedAt(tz, tx.closedAtIso).startsOn;
    return { ...tx, payPeriodFinalized: finalizedByStartsOn.get(startsOn) ?? false };
  });

  return (
    <div className="tp-page">
      <div className="tp-head">
        <div>
          <h1>Transactions</h1>
          <div className="sub">
            Every sale your salon has rung up. Filter by period and click any row for the full
            receipt.
          </div>
        </div>
        <div className="actions">
          {/* The prototype's header uses the slim `.tp-btn-primary` button,
              not the dashboard's large hero CTA card — a `<Link>` styled with
              `.tp-btn-primary` (defined in `styles/transactions.css`) keeps
              header fidelity with the prototype (Constitution Principle I). */}
          <Link href="/checkout" className="tp-btn-primary" data-slot="new-transaction-cta">
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            New transaction
          </Link>
        </div>
      </div>

      <PeriodControls window={window} />

      <TransactionsView
        transactions={stampedTransactions}
        staff={staff}
        previousPeriodCount={previousPeriodCount}
        todayKey={todayKey}
        periodLabel={window.label.toLowerCase()}
        viewerRole={viewer.staff.role}
      />
    </div>
  );
}
