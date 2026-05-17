import "@/styles/end-of-day.css";

import { redirect } from "next/navigation";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSalonTimezone } from "@/lib/db/settings";
import { loadCashCount } from "@/lib/end-of-day/cash-count";
import { CashCount } from "@/components/lacquer/eod/cash-count.client";
import { CashList } from "@/components/lacquer/eod/cash-list";
import { DoneScreen } from "@/components/lacquer/eod/done-screen";

// FR-027 mirror: every navigation re-queries Supabase — no static cache
// of the End-of-Day read. The freshness target is "what's true right
// now"; a 30s ISR window here could let a closed-state UI render after
// a fresh cash payment hits but before the page revalidates.
export const dynamic = "force-dynamic";

const SUBTITLE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default async function EndOfDayPage() {
  const viewer = await requireStudioSession();

  // Role gate. The page is owner + manager only — sidebar already hides
  // the entry for technicians, but the redirect is the security
  // boundary, not the UX. Silent redirect (no flash) per spec.
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard");
  }

  const supabase = await createSupabaseServerClient();
  const tz = await getSalonTimezone(supabase);
  const now = new Date();
  const snapshot = await loadCashCount(supabase, tz, now);

  const isOpen = snapshot.sessionState === "open";
  const subtitle = SUBTITLE_FMT.format(now);

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
      {/* Header — reuses the dashboard's tx-landing-top chrome so the
          page sits flush in the studio main. */}
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
          <h1 style={{ marginTop: 4 }}>Cash count</h1>
          <div className="sub" style={{ marginTop: 6 }}>
            {subtitle}
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
          <span
            className={`eod-status-pill ${isOpen ? "eod-open" : "eod-closed"}`}
            data-slot="eod-status-pill"
            data-state={isOpen ? "open" : "closed"}
          >
            {isOpen ? "Open" : "Closed"}
          </span>
        </div>
      </div>

      {/* Two-column body. */}
      <div className="eod-body">
        <CashList rows={snapshot.rows} expectedCents={snapshot.expectedCents} />
        <div style={{ width: 1, background: "var(--border)", flexShrink: 0 }} aria-hidden="true" />
        {isOpen ? (
          <CashCount expectedCents={snapshot.expectedCents} />
        ) : (
          <DoneScreen
            expectedCents={snapshot.closedSession!.expectedCents}
            countedCents={snapshot.closedSession!.countedCents}
            varianceCents={snapshot.closedSession!.varianceCents}
            notes={snapshot.closedSession!.notes}
            closedAt={snapshot.closedSession!.closedAt}
          />
        )}
      </div>
    </div>
  );
}
