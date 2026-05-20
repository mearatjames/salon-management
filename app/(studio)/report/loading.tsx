// Report loading.tsx — rendered by Next.js while the server-side data fetch
// for `app/(studio)/report/page.tsx` is in flight, including the re-fetch
// triggered by stepping the reporting period (US4 `?period=&offset=`).
//
// Mirrors the live page's `.dr-app-page` chrome so the layout doesn't shift
// when real content arrives: the `.tp-head` band, the three-card `.dr-summary`
// strip, and the left-panel / right-panel `.dr-body` shell.
//
// Every placeholder uses `background: var(--muted)` and a token-scale radius.
// The pulse reuses the `.tx-skeleton` ambient animation from
// `styles/dashboard.css` (no progress semantics).

import "@/styles/report.css";
import "@/styles/dashboard.css";

export default function ReportLoading() {
  const placeholder = {
    background: "var(--muted)",
    borderRadius: 8,
  } as const;

  return (
    <div className="dr-app dr-app-page" aria-hidden="true">
      <div className="tp-head">
        <div>
          <div className="tx-skeleton" style={{ ...placeholder, width: 140, height: 28 }} />
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 420, height: 12, marginTop: 8 }}
          />
        </div>
        <div className="actions">
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 160, height: 30, borderRadius: 6 }}
          />
        </div>
      </div>

      <div className="dr-summary">
        {[0, 1, 2].map((i) => (
          <div key={i} className="dr-stat">
            <div className="tx-skeleton" style={{ ...placeholder, width: 110, height: 10 }} />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 96, height: 26, marginTop: 6 }}
            />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 150, height: 10, marginTop: 6 }}
            />
          </div>
        ))}
      </div>

      <div className="dr-body">
        <div className="dr-left">
          <div className="dr-allstaff-btn">
            <div className="tx-skeleton" style={{ ...placeholder, width: 80, height: 14 }} />
            <div
              className="tx-skeleton"
              style={{ ...placeholder, width: 140, height: 10, marginTop: 4 }}
            />
          </div>
          <div className="dr-tech-list">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="tx-skeleton"
                style={{ ...placeholder, height: 96, borderRadius: 8 }}
              />
            ))}
          </div>
        </div>
        <div className="dr-right">
          <div className="dr-detail">
            <div className="dr-detail-head">
              <div className="tx-skeleton" style={{ ...placeholder, width: 200, height: 16 }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
              {[0, 1, 2, 3, 4].map((i) => (
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
    </div>
  );
}
