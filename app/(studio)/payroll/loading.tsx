// Payroll loading.tsx — rendered by Next.js while the server-side data fetch
// for `app/(studio)/payroll/page.tsx` is in flight, including the re-fetch
// triggered by switching the pay period (`?offset=`) or the filter (`?filter=`).
//
// Mirrors the live page's `.pr-app` chrome so the layout doesn't shift when
// real content arrives: the `.pr-header` band, the four-tile `.pr-kpis` band,
// and the `.pl-table-card` ledger shell.
//
// Every placeholder uses `background: var(--muted)` and a token-scale radius.
// The pulse reuses the `.tx-skeleton` ambient animation from
// `styles/dashboard.css` (no progress semantics).

import "@/styles/payroll.css";
import "@/styles/dashboard.css";

export default function PayrollLoading() {
  const placeholder = {
    background: "var(--muted)",
    borderRadius: 8,
  } as const;

  return (
    <div className="pr-app dr-app-page" aria-hidden="true">
      <div className="pr-header">
        <div>
          <div className="tx-skeleton" style={{ ...placeholder, width: 120, height: 12 }} />
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 240, height: 26, marginTop: 8 }}
          />
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 400, height: 12, marginTop: 8 }}
          />
        </div>
        <div className="tx-skeleton" style={{ ...placeholder, width: 280, height: 34 }} />
      </div>

      <div className="pr-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pr-kpi">
            <div className="tx-skeleton" style={{ ...placeholder, width: 110, height: 10 }} />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 96, height: 26, marginTop: 8 }}
            />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 140, height: 10, marginTop: 8 }}
            />
          </div>
        ))}
      </div>

      <div className="pp-ledger-body">
        <div className="pl-table-card">
          <div className="pl-table-head">
            <div className="tx-skeleton" style={{ ...placeholder, width: 220, height: 24 }} />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 120, height: 30, borderRadius: 6 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="tx-skeleton"
                style={{ ...placeholder, height: 44, borderRadius: 6 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
