// Transactions loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/transactions/page.tsx` is in flight, including the
// re-fetch triggered by stepping the period (`?period=&offset=` navigation).
//
// Mirrors the live page's `.tp-page` chrome so the layout doesn't shift when
// real content arrives: the `.tp-head` band, the `.tp-period-row`, the
// five-card `.tp-kpis` strip, and a table-shell beneath.
//
// Every placeholder uses the shimmer `<Skeleton>` primitive
// (`styles/loading.css`).

import "@/styles/transactions.css";

import { Skeleton } from "@/components/ui/skeleton";

export default function TransactionsLoading() {
  return (
    <div className="tp-page" aria-hidden="true">
      <div className="tp-head">
        <div>
          <Skeleton width={200} height={28} radius="var(--radius-md)" />
          <Skeleton width={360} height={12} radius="var(--radius-md)" style={{ marginTop: 8 }} />
        </div>
        <div className="actions">
          <Skeleton width={150} height={34} radius="var(--radius-sm)" />
        </div>
      </div>

      <div className="tp-period-row">
        <Skeleton width={240} height={30} radius="var(--radius-md)" />
        <Skeleton width={220} height={26} radius="var(--radius-md)" />
      </div>

      <div className="tp-kpis">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="tp-kpi">
            <Skeleton width={96} height={10} radius="var(--radius-md)" />
            <Skeleton width={72} height={24} radius="var(--radius-md)" style={{ marginTop: 6 }} />
            <Skeleton width={84} height={10} radius="var(--radius-md)" style={{ marginTop: 6 }} />
          </div>
        ))}
      </div>

      <div className="tp-table-scroll">
        <div className="tp-day-group">
          <div className="tp-day-h">
            <Skeleton width={200} height={16} radius="var(--radius-md)" />
            <Skeleton width={48} height={12} radius="var(--radius-md)" />
            <Skeleton width={72} height={12} radius="var(--radius-md)" />
            <Skeleton width={64} height={12} radius="var(--radius-md)" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0" }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={36} radius="var(--radius-sm)" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
