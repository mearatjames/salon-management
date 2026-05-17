import "@/styles/dashboard.css";

// Dashboard loading.tsx — rendered by Next.js while the server-side data
// fetch for `app/(studio)/dashboard/page.tsx` is in flight.
//
// Mirrors the live page's `.tx-landing` chrome so the layout doesn't shift
// when real content arrives: a header band slot on top, the four
// `.tx-stat-card` slots + a two-column-spanning `.tx-stat-card` for the
// Payment-mix tile, and an empty feed-shell beneath.
//
// Every placeholder uses `background: var(--muted)` and a radius from the
// existing token scale. The `.tx-skeleton` class (defined in
// `styles/dashboard.css`) carries the 1500ms ambient pulse. The pulse is
// intentional (it never indicates progress) and so doesn't compete with
// the 150/200/300ms reactive-affordance bands.
export default function DashboardLoading() {
  const placeholder = {
    background: "var(--muted)",
    borderRadius: 8,
  } as const;

  return (
    <div className="tx-landing">
      <div
        className="tx-landing-top"
        style={{ paddingBottom: 14, borderBottomColor: "var(--border)" }}
      >
        <div style={{ width: "60%" }}>
          <div className="tx-skeleton" style={{ ...placeholder, width: 160, height: 12 }} />
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 220, height: 24, marginTop: 8 }}
          />
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 280, height: 12, marginTop: 8 }}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 180, height: 32, borderRadius: 9999 }}
          />
          <div
            className="tx-skeleton"
            style={{ ...placeholder, width: 200, height: 56, borderRadius: 12 }}
          />
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
        <div
          className="tx-stat-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tx-stat-card" data-slot="stat-card">
              <div className="tx-skeleton" style={{ ...placeholder, width: 80, height: 12 }} />
              <div
                className="tx-skeleton"
                style={{ ...placeholder, width: 96, height: 24, marginTop: 6 }}
              />
              <div
                className="tx-skeleton"
                style={{ ...placeholder, width: 60, height: 10, marginTop: 6 }}
              />
            </div>
          ))}
          <div style={{ gridColumn: "span 2" }}>
            <div className="tx-stat-card" data-slot="payment-mix-card" style={{ minHeight: 0 }}>
              <div className="tx-skeleton" style={{ ...placeholder, width: 96, height: 12 }} />
              <div
                className="tx-skeleton"
                style={{
                  ...placeholder,
                  width: "100%",
                  height: 8,
                  marginTop: 8,
                  borderRadius: 9999,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                <div
                  className="tx-skeleton"
                  style={{ ...placeholder, width: "100%", height: 12 }}
                />
                <div
                  className="tx-skeleton"
                  style={{ ...placeholder, width: "100%", height: 12 }}
                />
                <div
                  className="tx-skeleton"
                  style={{ ...placeholder, width: "100%", height: 12 }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="tx-landing-bottom">
          <div className="tx-landing-bottom-left">
            <div className="muted">Quick actions</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="tx-skeleton"
                  style={{ ...placeholder, height: 56, borderRadius: 10 }}
                />
              ))}
            </div>
          </div>
          <div className="tx-feed" data-slot="recent-transactions-feed" aria-hidden="true">
            <div className="tx-feed-h">
              <span className="ttl">Recent transactions</span>
            </div>
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="tx-skeleton"
                  style={{ ...placeholder, height: 28, borderRadius: 6 }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
