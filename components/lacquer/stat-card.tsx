import type { ReactNode } from "react";

export type StatCardProps = {
  label: string;
  value: string | number;
  sub?: string;
  delta?: string | null;
  icon?: ReactNode;
};

// Server component — applies the Variation-B `.tx-stat-card` chrome from
// `styles/dashboard.css`. The structure mirrors `design-system/prototypes/
// transaction/Landing.jsx` lines 56–70 verbatim: label/icon row, then `.val`
// (tabular), then a `.delta` row carrying the `sub` text and optional delta
// pill. All color / radius / shadow values resolve to tokens via the CSS class.
export function StatCard({ label, value, sub, delta, icon }: StatCardProps) {
  const trimmed = typeof delta === "string" ? delta.trim() : "";
  // `−` (U+2212) is the design-system minus glyph; `-` (U+002D) is the keyboard
  // hyphen-minus. Treat both as the "down" indicator.
  const isUp = trimmed.startsWith("+");
  const isDown = trimmed.startsWith("−") || trimmed.startsWith("-");
  const deltaTone = isUp ? "up" : isDown ? "down" : "";

  return (
    <div className="tx-stat-card" data-slot="stat-card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div className="lbl">{label}</div>
        {icon ? (
          <div style={{ color: "var(--muted-foreground)" }} aria-hidden="true">
            {icon}
          </div>
        ) : null}
      </div>
      <div className="val tnum">{value}</div>
      {sub || delta ? (
        <div className="delta" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{sub ?? ""}</span>
          {delta ? (
            <span className={deltaTone ? `delta ${deltaTone}` : "delta"}>{delta}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
