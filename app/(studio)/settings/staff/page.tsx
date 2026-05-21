// Settings → Staff page. Server Component.
//
// Fetches the active, non-removed roster ordered by role priority then
// display name (data-model.md § 6 invariant 8 — mirrored client-side by
// `_sort.ts`). Maps the rows to `RosterStaff[]`, dropping `pin_hash` and
// projecting `pin_set: pin_hash !== null` so the raw hash never crosses
// the server/client boundary.
//
// Renders:
//   - <PageHeader> (static title)
//   - <StaffTable> client island (search + show-inactive + Add staff stub
//     for US1; the wizard wires in US2)
//   - the edit-panel slot (empty-state for US1; edit panel in US3 once
//     `?selected=` is provided)
//
// `isLastOwner` is computed for the panel — US3+ consumes it; passed
// forward here so the prop surface is stable.
//
// Next 16 note: `searchParams` is a Promise in app router — must be awaited.

import { Suspense } from "react";

import { EditPanel } from "@/components/lacquer/staff/edit-panel.client";
import { StaffEmptyState } from "@/components/lacquer/staff/empty-state";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/lacquer/staff/page-header";
import { StaffFab } from "@/components/lacquer/staff/staff-fab.client";
import { StaffMobileSheet } from "@/components/lacquer/staff/staff-mobile-sheet.client";
import { StaffTable } from "@/components/lacquer/staff/staff-table.client";
import { StaffToaster } from "@/components/lacquer/staff/staff-toaster.client";
import { canAccessStaffSettings } from "@/app/(studio)/settings/staff/_access-gate";
import { sortStaff } from "@/app/(studio)/settings/staff/_sort";
import {
  loadSupplyCatalogForStaff,
  type SupplyCatalogForStaff,
} from "@/app/(studio)/settings/staff/_supply-catalog";
import type { RosterStaff, StaffSupplyMode } from "@/app/(studio)/settings/staff/_types";
import { requireStudioSession, type StudioRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

type SearchParamsShape = {
  selected?: string | string[];
};

function resolveSelectedId(value: SearchParamsShape["selected"]): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value.length > 0 ? value : null;
}

export default async function StaffSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsShape>;
}) {
  // Re-verify the studio session for the page. `requireStudioSession()`
  // throws AuthRedirectError on unauthenticated requests — propagates up to
  // the error boundary. The settings layout is permissive now (see
  // 008-services-catalog FR-029); this page enforces the owner/manager-only
  // gate inline before any data fetch so a technician/front-desk operator
  // never sees the staff table flash.
  const viewer = await requireStudioSession();

  if (!canAccessStaffSettings(viewer.staff.role)) {
    redirect("/dashboard");
  }

  const params = (await searchParams) ?? {};
  const selectedId = resolveSelectedId(params.selected);

  const supabase = await createSupabaseServerClient();

  // Hot query — backed by the partial index `staff_roster_idx` (data-model.md
  // § 1.1). The SQL ORDER BY uses a CASE expression for role priority;
  // PostgREST doesn't accept CASE-in-order directly, so we sort by role then
  // display_name and rely on the client-side `sortStaff` comparator to apply
  // the canonical role priority (since lexical role order differs from
  // priority — manager < owner < technician alphabetically).
  const { data, error } = await supabase
    .from("staff")
    .select(
      "id, display_name, role, color_token, active, created_at, pin_hash, card_fee_exempt, supply_mode, supply_except, service_commission_pct, tip_split_pct, check_portion_cents"
    )
    .is("removed_at", null)
    .order("display_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to load staff roster: ${error.message}`);
  }

  const roster: RosterStaff[] = sortStaff(
    (data ?? []).map((row) => ({
      id: row.id,
      display_name: row.display_name,
      role: row.role as StudioRole,
      color_token: row.color_token,
      active: row.active,
      created_at: row.created_at,
      pin_set: row.pin_hash != null,
      // 023-staff-payout-exemptions — three new columns. Coerce defaults so
      // the page still renders if the migration hasn't been applied locally
      // (the SELECT will simply project undefined for those columns).
      card_fee_exempt: (row as { card_fee_exempt?: boolean | null }).card_fee_exempt ?? false,
      supply_mode:
        ((row as { supply_mode?: string | null }).supply_mode as StaffSupplyMode | null) ?? "apply",
      supply_except: (row as { supply_except?: string[] | null }).supply_except ?? [],
      // 047-payroll-page § US5 — per-tech payroll rates. Coerce to 0 when the
      // migration hasn't been applied locally.
      service_commission_pct:
        (row as { service_commission_pct?: number | null }).service_commission_pct ?? 0,
      tip_split_pct: (row as { tip_split_pct?: number | null }).tip_split_pct ?? 0,
      check_portion_cents:
        (row as { check_portion_cents?: number | null }).check_portion_cents ?? 0,
    }))
  );

  // 023 — per-status counts for the chip bar (US4 / T042). Computed once
  // here from the in-memory roster so the chip bar stays in sync with the
  // filtered table without an extra round-trip.
  const rosterCounts = {
    all: roster.length,
    active: roster.filter((r) => r.active).length,
    inactive: roster.filter((r) => !r.active).length,
  };

  // `isLastOwner` is target-specific in the matrix: when the selected target
  // is the only active, non-removed owner, the matrix blocks demote /
  // deactivate / remove. Compute it once here based on the roster snapshot;
  // re-counting in the action is the trust boundary that catches concurrent
  // edits, but the panel render only needs the snapshot view.
  const activeOwnerCount = roster.filter((r) => r.role === "owner" && r.active).length;

  // Resolve the selected target (if any) for the edit panel.
  const selectedTarget = selectedId ? (roster.find((r) => r.id === selectedId) ?? null) : null;

  // If the selected target is an owner AND there's only one active owner,
  // it's the last-owner case. For non-owner targets, isLastOwner has no
  // effect on the matrix evaluation and stays false.
  const isLastOwnerForTarget = selectedTarget?.role === "owner" && activeOwnerCount <= 1;

  // 023 — load the supply catalog for the selected target so the Pay &
  // deductions section's per-type picker renders without a client round-trip.
  // Only loaded when a target is selected; the helper does one or two small
  // SELECTs scoped to the salon's supply_types catalog.
  let supplyCatalog: SupplyCatalogForStaff | null = null;
  if (selectedTarget) {
    supplyCatalog = await loadSupplyCatalogForStaff(selectedTarget.id);
  }

  return (
    <div className="settings-staff-grid" data-slot="staff-page" data-selected-id={selectedId ?? ""}>
      <div className="settings-staff-roster">
        <PageHeader />
        <StaffTable
          roster={roster}
          selectedId={selectedId}
          operatorRole={viewer.staff.role}
          counts={rosterCounts}
        />
      </div>
      <aside className="settings-staff-panel" aria-label="Selected staff details">
        {selectedTarget ? (
          <EditPanel
            // Re-key on target.id so React tears down the panel and discards
            // the local draft state when the user selects another row
            // (FR-022 — no confirmation prompt, silent discard).
            key={selectedTarget.id}
            viewer={{ id: viewer.staff.id, role: viewer.staff.role }}
            target={{
              id: selectedTarget.id,
              display_name: selectedTarget.display_name,
              role: selectedTarget.role,
              color_token: selectedTarget.color_token,
              active: selectedTarget.active,
              pin_set: selectedTarget.pin_set,
              // 023-staff-payout-exemptions § US6 — formatted as
              // "Added MMM YYYY" in the new panel-profile header card.
              created_at: selectedTarget.created_at,
              card_fee_exempt: selectedTarget.card_fee_exempt,
              supply_mode: selectedTarget.supply_mode,
              supply_except: selectedTarget.supply_except,
              // 047-payroll-page § US5 — per-tech payroll rates.
              service_commission_pct: selectedTarget.service_commission_pct,
              tip_split_pct: selectedTarget.tip_split_pct,
              check_portion_cents: selectedTarget.check_portion_cents,
            }}
            isLastOwner={isLastOwnerForTarget}
            supplyCatalog={supplyCatalog ?? undefined}
          />
        ) : (
          <StaffEmptyState />
        )}
      </aside>
      {/* US8: Mobile bottom sheet. Mounted only when a target is selected
          so the EditPanel and its server-fetched supplyCatalog are kept in
          lock-step with the desktop aside. At ≥900px CSS hides this sheet;
          at <900px CSS hides the desktop aside above. The sheet owns its
          open state via useSearchParams() (client hook) and closes by
          router-pushing the staff URL without `?selected=`. */}
      {selectedTarget ? (
        <Suspense fallback={null}>
          <StaffMobileSheet
            viewer={{ id: viewer.staff.id, role: viewer.staff.role }}
            target={{
              id: selectedTarget.id,
              display_name: selectedTarget.display_name,
              role: selectedTarget.role,
              color_token: selectedTarget.color_token,
              active: selectedTarget.active,
              pin_set: selectedTarget.pin_set,
              created_at: selectedTarget.created_at,
              card_fee_exempt: selectedTarget.card_fee_exempt,
              supply_mode: selectedTarget.supply_mode,
              supply_except: selectedTarget.supply_except,
              // 047-payroll-page § US5 — per-tech payroll rates.
              service_commission_pct: selectedTarget.service_commission_pct,
              tip_split_pct: selectedTarget.tip_split_pct,
              check_portion_cents: selectedTarget.check_portion_cents,
            }}
            isLastOwner={isLastOwnerForTarget}
            supplyCatalog={supplyCatalog ?? undefined}
          />
        </Suspense>
      ) : null}
      {/* US8: mobile-only FAB pinned to the lower-right. Carries its own
          `<AddStaffWizard>` instance with independent open state so the
          page Server Component stays uncoupled to client state. */}
      <StaffFab operatorRole={viewer.staff.role} />
      {/* US7: URL → Sonner toast bridge. Reads ?toast / ?name / ?error,
          fires the matching TOAST string, then strips them via router.replace
          (preserving ?selected=). Wrapped in Suspense because useSearchParams
          requires it under Next 16's strict streaming rules. */}
      <Suspense fallback={null}>
        <StaffToaster />
      </Suspense>
    </div>
  );
}
