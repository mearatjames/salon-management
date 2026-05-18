// PageHeader — title row for the Services catalog page. Server Component,
// pure layout. Renders the static "Services" title + a single-line summary
// "{X} active · {Y} total" with tabular numerals so the counts column-align
// across renders (Constitution Principle II — Lacquer typography).
//
// The summary line takes counts as props because the page Server Component
// is the source of truth for the catalog roster; this header doesn't fetch.
// All visual values resolve to Lacquer tokens.
//
// 022-supply-types-catalog (US2): the header also hosts the Edit Policy
// button, which opens the right-side `<EditPolicySheet>` for managing the
// supply-types catalog. The button reads the operator's role server-side
// here and decides the disabled-with-tooltip affordance for non-privileged
// operators (technician / front-desk); the actual Server Actions called
// from inside the sheet still re-check via `assertCanWriteCatalog`, so
// the disable here is purely UX.

import { EditPolicyButton } from "@/components/lacquer/services/edit-policy-button";
import type { StudioRole } from "@/app/(studio)/services/permissions";
import type { SupplyTypesCatalog } from "@/app/(studio)/settings/policy/_load";

export type PageHeaderProps = {
  /** Number of active (non-archived) services in the catalog. */
  activeCount: number;
  /** Total services in the catalog (active + archived). */
  totalCount: number;
  /** Operator's role — drives the Edit Policy button's disabled affordance. */
  operatorRole: StudioRole;
  /** Supply types catalog — passed through to the Edit Policy sheet so it
   *  renders without a second roundtrip. */
  supplyTypesCatalog: SupplyTypesCatalog;
};

export function PageHeader({
  activeCount,
  totalCount,
  operatorRole,
  supplyTypesCatalog,
}: PageHeaderProps) {
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
      {/* Edit Policy button — opens the right-side sheet for managing the
          supply-types catalog. Server component decides disabled state;
          client island manages the open state + ?policy=open URL bridge
          so Server Action redirects can land the operator back inside a
          still-open sheet. */}
      <EditPolicyButton role={operatorRole} catalog={supplyTypesCatalog} />
    </header>
  );
}
