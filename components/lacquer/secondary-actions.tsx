import Link from "next/link";

import type { QuickAction } from "@/lib/dashboard/aggregate";

export type SecondaryActionsProps = {
  actions: readonly QuickAction[];
  cols?: 1 | 2;
};

// Server component — renders the fixed four-row quick-action stack. The
// `QuickAction` list is provided by `buildDashboardData()` (single source of
// truth in `lib/dashboard/aggregate.ts`); this component never hardcodes it.
// Each row is a Next <Link> styled via the `.tx-secondary-action` chrome.
export function SecondaryActions({ actions, cols = 1 }: SecondaryActionsProps) {
  return (
    <div
      data-slot="secondary-actions"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 8,
      }}
    >
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <Link
            key={action.id}
            href={action.href}
            className="tx-secondary-action"
            data-action-id={action.id}
          >
            <Icon
              size={18}
              color="var(--muted-foreground)"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span className="lbl">{action.label}</span>
              <span className="h">{action.hint}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
