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
import { StaffTable } from "@/components/lacquer/staff/staff-table.client";
import { StaffToaster } from "@/components/lacquer/staff/staff-toaster.client";
import { sortStaff } from "@/app/(studio)/settings/staff/_sort";
import type { RosterStaff } from "@/app/(studio)/settings/staff/_types";
import { requireStudioSession, type StudioRole } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

// Role gate for /settings/staff. Previously lived in the parent layout, but
// 008-services-catalog FR-029 requires Services to be readable by every
// operator — so the gate moved here, leaving the layout open and each
// restricted child page enforcing its own role check.
const STAFF_SETTINGS_OPERATORS = new Set<StudioRole>(["owner", "manager"]);

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

  if (!STAFF_SETTINGS_OPERATORS.has(viewer.staff.role)) {
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
    .select("id, display_name, role, color_token, active, created_at, pin_hash")
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
    }))
  );

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

  return (
    <div className="settings-staff-grid" data-slot="staff-page" data-selected-id={selectedId ?? ""}>
      <div className="settings-staff-roster">
        <PageHeader />
        <StaffTable roster={roster} selectedId={selectedId} operatorRole={viewer.staff.role} />
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
            }}
            isLastOwner={isLastOwnerForTarget}
          />
        ) : (
          <StaffEmptyState />
        )}
      </aside>
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
