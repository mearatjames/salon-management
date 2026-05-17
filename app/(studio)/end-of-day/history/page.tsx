import "@/styles/end-of-day.css";

import { redirect } from "next/navigation";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { loadCashHistoryList } from "@/lib/end-of-day/history";
import { HistoryList } from "@/components/lacquer/eod/history/history-list";

// Same freshness contract as `/end-of-day`: every navigation re-reads
// the closed-session list. A stale ISR window here would mask a fresh
// close or edit by the same operator on another device.
export const dynamic = "force-dynamic";

const PAGE_LIMIT = 90;

export default async function HistoryPage({
  searchParams,
}: {
  // Next.js 16 App Router — searchParams is a Promise.
  searchParams: Promise<{ offset?: string }>;
}) {
  const viewer = await requireStudioSession();

  // Role gate: owner + manager only. Sidebar already hides the entry
  // for technicians; this is the security boundary.
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const offsetParam = parseInt(sp.offset ?? "0", 10);
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseServiceRoleClient();
  const rows = await loadCashHistoryList(supabase, admin, {
    limit: PAGE_LIMIT,
    offset,
  });
  const hasMore = rows.length === PAGE_LIMIT;

  return (
    <div
      className="eod-app"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
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
            End of day
          </div>
          <h1 style={{ marginTop: 4 }}>Past cash counts</h1>
          <div className="sub" style={{ marginTop: 6 }}>
            Review every closed drawer, oldest to newest.
          </div>
        </div>
      </div>

      <HistoryList rows={rows} hasMore={hasMore} nextOffset={offset + PAGE_LIMIT} />
    </div>
  );
}
