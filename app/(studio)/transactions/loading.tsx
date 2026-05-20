// Transactions loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/transactions/page.tsx` is in flight, including the
// re-fetch triggered by stepping the period (`?period=&offset=` navigation).
//
// Mirrors the live page's `.tp-page` chrome so the layout doesn't shift when
// real content arrives: the `.tp-head` band, the `.tp-period-row`, the
// five-card `.tp-kpis` strip, and a table-shell beneath.
//
// Every placeholder uses `background: var(--muted)` and a token-scale radius.
// The pulse is the dashboard skeleton's ambient one (no progress semantics) —
// reuses the `.tx-skeleton` class from `styles/dashboard.css`.

import "@/styles/transactions.css";
import "@/styles/dashboard.css";

export default function TransactionsLoading() {
  const placeholder = {
    background: "var(--muted)",
    borderRadius: 8,
  } as const;

  return (
    <div className="tp-page" aria-hidden="true">
      <div className="tp-head">
        <div>
          <div className="tx-skeleton" style={{ ...placeholder, width: 200, height: 28 }} />
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 360, height: 12, marginTop: 8 }}
          />
        </div>
        <div className="actions">
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 150, height: 34, borderRadius: 6 }}
          />
        </div>
      </div>

      <div className="tp-period-row">
        <div
          className="tx-skeleton"
          style={{ ...placeholder, width: 240, height: 30, borderRadius: 8 }}
        />
        <div className="tx-skeleton" style={{ ...placeholder, width: 220, height: 26 }} />
      </div>

      <div className="tp-kpis">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="tp-kpi">
            <div className="tx-skeleton" style={{ ...placeholder, width: 96, height: 10 }} />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 72, height: 24, marginTop: 6 }}
            />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 84, height: 10, marginTop: 6 }}
            />
          </div>
        ))}
      </div>

      <div className="tp-table-scroll">
        <div className="tp-day-group">
          <div className="tp-day-h">
            <div className="tx-skeleton" style={{ ...placeholder, width: 200, height: 16 }} />
            <div className="tx-skeleton" style={{ ...placeholder, width: 48, height: 12 }} />
            <div className="tx-skeleton" style={{ ...placeholder, width: 72, height: 12 }} />
            <div className="tx-skeleton" style={{ ...placeholder, width: 64, height: 12 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 0" }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="tx-skeleton"
                style={{ ...placeholder, height: 36, borderRadius: 6 }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
