import "@/styles/dashboard.css";

import { requireStudioSession } from "@/lib/auth/session";
import { buildDashboardData } from "@/lib/dashboard/aggregate";
import { NewTransactionCTA } from "@/components/lacquer/new-transaction-cta";
import { PeriodProvider, PeriodToggle } from "@/components/lacquer/period-toggle";
import { PeriodSummary } from "@/components/lacquer/period-summary.client";
import { RecentTransactionsFeed } from "@/components/lacquer/recent-transactions-feed";
import { SecondaryActions } from "@/components/lacquer/secondary-actions";
import { TechsOnShiftTile } from "@/components/lacquer/techs-on-shift-tile";

export default async function DashboardPage() {
  await requireStudioSession();
  const data = buildDashboardData();

  return (
    <PeriodProvider summaries={data.summaries} comparisons={data.comparisons}>
      <div className="tx-landing">
        <div
          className="tx-landing-top"
          style={{ paddingBottom: 14, borderBottomColor: "var(--border)" }}
        >
          <div>
            <div
              className="muted"
              style={{
                fontSize: 11,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              {data.greeting.eyebrow}
            </div>
            <h1 style={{ marginTop: 4 }}>{data.greeting.title}</h1>
            <div className="sub" style={{ marginTop: 6 }}>
              {data.greeting.subtitle}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 10,
            }}
          >
            <PeriodToggle />
            <NewTransactionCTA />
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            padding: "16px 24px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            overflow: "auto",
          }}
        >
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
      </div>
    </PeriodProvider>
  );
}
