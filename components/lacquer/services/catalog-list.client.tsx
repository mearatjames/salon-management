"use client";

// CatalogList — client island that owns the search query + show-archived
// toggle state for the services catalog. Receives a pre-fetched roster
// from the page Server Component, applies the in-memory filter +
// group/sort helpers (`_filter.ts`, `_sort.ts`), and renders:
//   - the search input + Show-archived toggle + "Add service" button
//   - category headers with their grouped `<CatalogRow>` children
//   - the no-match state when filter yields zero rows
//   - the empty state when the unfiltered catalog is empty
//
// Row click navigates to `/services?selected=<id>` via `next/link`;
// "Add service" navigates to `?adding=1`. The drawer wiring lands in US2 —
// for US1 these links only update the URL.
//
// `showArchived` is persisted to `sessionStorage` per `ui.contract.md § 3`,
// using the same `useSyncExternalStore` pattern as `staff-table.client.tsx`
// so toggles in the same tab notify subscribers synchronously without an
// effect-cascade. The summary "X active · Y total" lives in the page
// Server Component (see `PageHeader`), not here — counts derive from the
// unfiltered roster so the header doesn't jiggle as the user searches.
//
// All visual values resolve to Lacquer tokens.

import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { Search } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CatalogRow } from "@/components/lacquer/services/catalog-row";
import { ServicesEmptyState } from "@/components/lacquer/services/empty-state";
import { filterServicesByName } from "@/app/(studio)/services/_filter";
import { sortCatalogGroups } from "@/app/(studio)/services/_sort";
import type { CatalogService } from "@/app/(studio)/services/_types";
import { canWriteCatalog, type StudioRole } from "@/app/(studio)/services/permissions";

const SHOW_ARCHIVED_KEY = "tn:services:show-archived";

export type CatalogListProps = {
  roster: CatalogService[];
  selectedId: string | null;
  /** Operator's role — drives the Add-service button affordance (US6 wires the disabled+tooltip path). */
  operatorRole: StudioRole;
};

// `useSyncExternalStore` adapter for sessionStorage. Mirrors the pattern in
// `staff-table.client.tsx` — SSR snapshot returns `false` so the initial
// server render matches the default state.
function subscribeToStorage(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function readShowArchived(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SHOW_ARCHIVED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeShowArchived(next: boolean): void {
  try {
    window.sessionStorage.setItem(SHOW_ARCHIVED_KEY, next ? "1" : "0");
  } catch {
    // ignore — non-fatal.
  }
}

function buildRowHref(serviceId: string, selectedId: string | null): string {
  if (selectedId === serviceId) {
    return "/services";
  }
  return `/services?selected=${encodeURIComponent(serviceId)}`;
}

export function CatalogList({ roster, selectedId, operatorRole }: CatalogListProps) {
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Track a local "tick" so a same-tab write to sessionStorage invalidates
  // the snapshot on the next render — the `storage` event only fires for
  // cross-tab updates.
  const [tick, setTick] = useState(0);
  const subscribe = useCallback((notify: () => void) => subscribeToStorage(notify), []);
  const getSnapshot = useCallback(() => {
    void tick;
    return readShowArchived();
  }, [tick]);
  const showArchived = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const handleToggleShowArchived = (next: boolean) => {
    writeShowArchived(next);
    setTick((t) => t + 1);
  };

  // Pipeline: hide archived (if toggle off) → filter by name → group + sort.
  const groups = useMemo(() => {
    const visibilityFiltered = showArchived ? roster : roster.filter((s) => s.active);
    const nameFiltered = filterServicesByName(visibilityFiltered, searchQuery);
    return sortCatalogGroups(nameFiltered);
  }, [roster, showArchived, searchQuery]);

  // Empty-state branch: zero services in the catalog ever (not "filter
  // yielded zero" — that's the no-match state below).
  const isCatalogEmpty = roster.length === 0;

  // No-match state: catalog has rows but filter produced nothing.
  const visibleCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  const isNoMatch = !isCatalogEmpty && visibleCount === 0;

  const canWrite = canWriteCatalog(operatorRole);

  return (
    <section
      data-slot="services-list"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {/* Top control bar: search + show-archived toggle + Add service CTA. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--card)",
            border: "1px solid var(--input)",
            borderRadius: "var(--radius-xs)",
            color: "var(--muted-foreground)",
            minWidth: `calc(var(--space-16) * 4)`,
            flex: "1 1 auto",
            maxWidth: `calc(var(--space-16) * 6)`,
          }}
        >
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search services"
            aria-label="Search services"
            data-slot="services-search-input"
            style={{
              flex: "1 1 auto",
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: "var(--text-sm)",
              color: "var(--foreground)",
              minWidth: 0,
            }}
          />
        </label>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontSize: "var(--text-sm)",
              color: "var(--muted-foreground)",
              cursor: "pointer",
            }}
            data-slot="show-archived-toggle"
          >
            <Switch
              checked={showArchived}
              onCheckedChange={handleToggleShowArchived}
              aria-label="Show archived"
            />
            <span>Show archived</span>
          </label>
          {canWrite ? (
            <Link
              href="/services?adding=1"
              data-slot="services-add-button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-2)",
                padding: "var(--space-2) var(--space-4)",
                background: "var(--primary)",
                color: "var(--primary-foreground)",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-sm)",
                fontWeight: 500,
                textDecoration: "none",
                transition: "background var(--duration-fast) var(--ease-out)",
              }}
            >
              Add service
            </Link>
          ) : (
            // Disabled affordance — non-privileged operators (technician /
            // front-desk) still focus the trigger via Tab, which fires the
            // shadcn Tooltip (radix uses focus, not just hover). The button
            // is `aria-disabled` rather than the native `disabled` attribute
            // so it remains focusable for the tooltip to surface.
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-slot="services-add-button"
                    aria-disabled="true"
                    onClick={(e) => e.preventDefault()}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      padding: "var(--space-2) var(--space-4)",
                      background: "var(--primary)",
                      color: "var(--primary-foreground)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "var(--text-sm)",
                      fontWeight: 500,
                      border: "none",
                      opacity: 0.5,
                      cursor: "not-allowed",
                    }}
                  >
                    Add service
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" data-slot="services-add-button-tooltip">
                  Only owners and managers can edit the catalog
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* List surface: groups, no-match, or empty state. */}
      {isCatalogEmpty ? (
        <ServicesEmptyState />
      ) : isNoMatch ? (
        <p
          data-slot="services-no-results"
          style={{
            margin: 0,
            padding: "var(--space-8) var(--space-4)",
            textAlign: "center",
            fontSize: "var(--text-sm)",
            color: "var(--muted-foreground)",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          No services match your search.
        </p>
      ) : (
        <div
          data-slot="services-groups"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
          }}
        >
          {groups.map((group) => (
            <div
              key={group.category}
              data-slot="services-group"
              data-category={group.category}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              <h3
                data-slot="services-group-header"
                style={{
                  margin: 0,
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  letterSpacing: "var(--tracking-wide)",
                  textTransform: "uppercase",
                  color: "var(--muted-foreground)",
                  padding: "0 var(--space-1)",
                }}
              >
                {group.category}
              </h3>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-2)",
                }}
              >
                {group.items.map((svc) => (
                  <Link
                    key={svc.id}
                    href={buildRowHref(svc.id, selectedId)}
                    aria-current={svc.id === selectedId ? "true" : undefined}
                    style={{ textDecoration: "none" }}
                  >
                    <CatalogRow service={svc} isSelected={svc.id === selectedId} />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
