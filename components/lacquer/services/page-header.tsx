// PageHeader — title row for the Services catalog page. Server Component,
// pure layout. Renders the static "Services" title + a single-line summary
// "{X} active · {Y} total" with tabular numerals so the counts column-align
// across renders (Constitution Principle II — Lacquer typography).
//
// The summary line takes counts as props because the page Server Component
// is the source of truth for the catalog roster; this header doesn't fetch.
// All visual values resolve to Lacquer tokens.

export type PageHeaderProps = {
  /** Number of active (non-archived) services in the catalog. */
  activeCount: number;
  /** Total services in the catalog (active + archived). */
  totalCount: number;
};

export function PageHeader({ activeCount, totalCount }: PageHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        flexWrap: "wrap",
      }}
      data-slot="services-page-header"
    >
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: "var(--text-2xl)",
            lineHeight: "var(--leading-tight)",
            letterSpacing: "var(--tracking-snug)",
            color: "var(--foreground)",
            fontWeight: 600,
          }}
        >
          Services
        </h2>
        <p
          data-slot="services-summary"
          className="tnum"
          style={{
            margin: 0,
            marginTop: "var(--space-1)",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {activeCount} active · {totalCount} total
        </p>
      </div>
    </header>
  );
}
