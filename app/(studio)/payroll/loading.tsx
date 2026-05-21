// Payroll loading.tsx — rendered by Next.js while the server-side data fetch
// for `app/(studio)/payroll/page.tsx` is in flight, including the re-fetch
// triggered by switching the pay period (`?offset=`) or the filter (`?filter=`).
//
// Mirrors the live page's `.pr-app` chrome so the layout doesn't shift when
// real content arrives: the `.pr-header` band, the four-tile `.pr-kpis` band,
// and the `.pl-table-card` ledger shell.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/payroll.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function PayrollLoading() {
  return (
    <div className="pr-app dr-app-page" aria-hidden="true">
      <div className="pr-header">
        <div>
          <Skeleton width={120} height={12} radius="var(--radius-md)" />
          <Skeleton width={240} height={26} radius="var(--radius-md)" style={{ marginTop: 8 }} />
          <Skeleton width={400} height={12} radius="var(--radius-md)" style={{ marginTop: 8 }} />
        </div>
        <Skeleton width={280} height={34} radius="var(--radius-md)" />
      </div>

      <div className="pr-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pr-kpi">
            <Skeleton width={110} height={10} radius="var(--radius-md)" />
            <Skeleton width={96} height={26} radius="var(--radius-md)" style={{ marginTop: 8 }} />
            <Skeleton width={140} height={10} radius="var(--radius-md)" style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>

      <div className="pp-ledger-body">
        <div className="pl-table-card">
          <div className="pl-table-head">
            <Skeleton width={220} height={24} radius="var(--radius-md)" />
            <Skeleton width={120} height={30} radius="var(--radius-sm)" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={44} radius="var(--radius-sm)" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
