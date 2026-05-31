import "@/styles/dashboard.css";

import { requireStudioSession } from "@/lib/auth/session";
import { loadDashboard } from "@/lib/dashboard/queries";
import { createSupabaseServerClient } from "@/lib/db/server";
import { NewTransactionCTA } from "@/components/lacquer/new-transaction-cta";
import { PeriodProvider, PeriodToggle } from "@/components/lacquer/period-toggle";
import { PeriodSummary } from "@/components/lacquer/period-summary.client";
import { RecentTransactionsFeed } from "@/components/lacquer/recent-transactions-feed";
import { SecondaryActions } from "@/components/lacquer/secondary-actions";

// FR-027: every navigation re-queries Supabase — no static caching of the
// dashboard read. The page's data freshness target is "what's true right
// now", not what was true at build time.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const viewer = await requireStudioSession();
  const supabase = await createSupabaseServerClient();
  const data = await loadDashboard(supabase);

  return (
    <PeriodProvider summaries={data.summaries}>
      <div className="tx-landing">
        <div
          className="tx-landing-top"
          style={{ paddingBottom: 14, borderBottomColor: "var(--border)" }}
        >
          <div>
            <h1>{data.greeting.title}</h1>
            <div className="sub" style={{ marginTop: 6 }}>
              {data.greeting.subtitle}
            </div>
          </div>
          <div className="tx-landing-actions">
            <PeriodToggle />
            <NewTransactionCTA />
          </div>
        </div>

        <div className="tx-landing-body">
          <PeriodSummary />
          <div className="tx-landing-bottom">
            <div className="tx-landing-bottom-left">
              <div className="muted">Quick actions</div>
              <SecondaryActions actions={data.quickActions} cols={1} />
            </div>
            <RecentTransactionsFeed
              rows={data.recent}
              staff={data.staff}
              viewerRole={viewer.staff.role}
            />
          </div>
        </div>
      </div>
    </PeriodProvider>
  );
}
