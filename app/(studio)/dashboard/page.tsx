import "@/styles/dashboard.css";

import { requireStudioSession } from "@/lib/auth/session";
import { buildDashboardData } from "@/lib/dashboard/aggregate";
import { NewTransactionCTA } from "@/components/lacquer/new-transaction-cta";
import { PeriodProvider, PeriodToggle } from "@/components/lacquer/period-toggle";
import { PeriodSummary } from "@/components/lacquer/period-summary.client";
import { RecentTransactionsFeed } from "@/components/lacquer/recent-transactions-feed";
import { SecondaryActions } from "@/components/lacquer/secondary-actions";
import { TechsOnShiftTile } from "@/components/lacquer/techs-on-shift-tile";

// Dashboard route — `/dashboard`. Server Component; the only "use client"
// boundaries live in `period-toggle.tsx` and `period-summary.client.tsx`.
// The lower split (quick actions, techs on shift, recent feed) is
// intentionally empty in this phase — Phase 5 (T026) fills it.
export default async function DashboardPage() {
  await requireStudioSession();
  const data = buildDashboardData();

  return (
    <PeriodProvider
      summaries={data.summaries}
      comparisons={data.comparisons}
    >
      <div className="tx-landing">
        <div className="tx-landing-top">
          <div>
            <div className="muted" style={{ fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              {data.greeting.eyebrow}
            </div>
            <h1>{data.greeting.title}</h1>
            <div className="sub">{data.greeting.subtitle}</div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 12,
            }}
          >
            <PeriodToggle />
            <NewTransactionCTA />
          </div>
        </div>
        <PeriodSummary />
        <div className="tx-landing-bottom">
          <div className="tx-landing-bottom-left">
            <div className="muted">Quick actions</div>
            <SecondaryActions actions={data.quickActions} cols={1} />
            <div className="muted">Techs on shift</div>
            <TechsOnShiftTile staff={data.staff} />
          </div>
          <RecentTransactionsFeed rows={data.recent} />
        </div>
      </div>
    </PeriodProvider>
  );
}
