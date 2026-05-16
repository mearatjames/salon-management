// Services catalog page. Server Component.
//
// Lives at `/services` — a top-level studio destination reached from the
// sidebar (see `components/lacquer/sidebar/nav-items.ts`). Not nested under
// Settings; renders directly inside the studio shell (sidebar + topbar).
//
// Fetches the catalog (with per-service `assignment_count` for active staff
// only), the assignable-staff list, and — when `?selected=<id>` is set —
// that service's assignment rows. The three reads run in parallel
// (`Promise.all`) per `contracts/db-rls.contract.md § 5`.
//
// Renders:
//   - <PageHeader /> with the "X active · Y total" summary
//   - <CatalogList> client island (search + show-archived + grouped rows)
//
// The drawer wiring is NOT here yet — that lands in US2/US3/US5. For US1,
// clicking a row updates the URL to `?selected=<id>` and re-renders the page;
// no overlay appears. The `selectedAssignments` prop is computed here so
// later phases can consume it without a second roundtrip.
//
// Next 16 note: `searchParams` is a Promise in app router — must be awaited.

import { Suspense } from "react";

import { CatalogList } from "@/components/lacquer/services/catalog-list.client";
import { Drawer } from "@/components/lacquer/services/drawer.client";
import { PageHeader } from "@/components/lacquer/services/page-header";
import { ServicesToaster } from "@/components/lacquer/services/services-toaster.client";
import { loadServiceWithAssignments } from "@/app/(studio)/services/_load";
import type {
  AvatarColorToken,
  CatalogService,
  ServiceDraftBaseline,
} from "@/app/(studio)/services/_types";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

type SearchParamsShape = {
  selected?: string | string[];
  adding?: string | string[];
  // Phase 9 (US7) consumes these; declared here so the page can accept
  // them without TS complaining when the URL-toast bridge appends them.
  toast?: string | string[];
  secondary?: string | string[];
  name?: string | string[];
  error?: string | string[];
};

function resolveSingleParam(value: string | string[] | undefined): string | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value.length > 0 ? value : null;
}

// The 8 valid `--avatar-*` tokens — used to narrow the raw `text` from the
// DB into our `AvatarColorToken` union. Unknown tokens fall back to slate
// so a malformed row never crashes the render (the validator gates writes
// upstream, so this is purely defensive).
const VALID_COLOR_TOKENS: ReadonlySet<AvatarColorToken> = new Set([
  "--avatar-rose",
  "--avatar-blue",
  "--avatar-green",
  "--avatar-amber",
  "--avatar-purple",
  "--avatar-teal",
  "--avatar-orange",
  "--avatar-slate",
]);

function narrowColorToken(raw: string): AvatarColorToken {
  return VALID_COLOR_TOKENS.has(raw as AvatarColorToken)
    ? (raw as AvatarColorToken)
    : "--avatar-slate";
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsShape>;
}) {
  // Verify the studio session. Throws AuthRedirectError on unauthenticated
  // requests; middleware turns it into a /login redirect.
  const viewer = await requireStudioSession();

  const params = (await searchParams) ?? {};
  const selectedId = resolveSingleParam(params.selected);
  const isAdding = resolveSingleParam(params.adding) === "1";

  const supabase = await createSupabaseServerClient();

  // Three parallel reads per `db-rls.contract.md § 5`. PostgREST can't
  // express the "filtered count" join directly, so we fetch the raw
  // `staff_services` join rows and the active staff list and compute the
  // per-service assignment count in JS (cheap — the catalog is bounded by
  // the salon's actual menu size, typically dozens of rows).
  const catalogPromise = supabase
    .from("services")
    .select(
      "id, name, category, duration_min, price_cents, color_token, taxable, active, variable_price, price_from_cents, price_to_cents, variable_price_note"
    )
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  // Counts come from a join of `staff_services` × active staff. We pull the
  // assignment rows (a wide-but-thin scan) and the active staff ids, then
  // tally per service in JS.
  const assignmentsPromise = supabase.from("staff_services").select("service_id, staff_id");

  const assignableStaffPromise = supabase
    .from("staff")
    .select("id, display_name, role, color_token, active")
    .eq("active", true)
    .is("removed_at", null)
    .order("display_name", { ascending: true });

  // When `?selected=<id>` is set, load that service's assignments so a
  // future phase (US3) can hydrate the drawer baseline from props. The
  // query is still issued in US1 so the wiring is complete — the result is
  // passed forward but not yet consumed by an overlay.
  const selectedAssignmentsPromise = selectedId
    ? supabase
        .from("staff_services")
        .select("staff_id, duration_min_override")
        .eq("service_id", selectedId)
    : Promise.resolve({ data: null, error: null });

  const [catalogRes, assignmentsRes, staffRes, selectedAssignmentsRes] = await Promise.all([
    catalogPromise,
    assignmentsPromise,
    assignableStaffPromise,
    selectedAssignmentsPromise,
  ]);

  if (catalogRes.error) {
    throw new Error(`Failed to load services catalog: ${catalogRes.error.message}`);
  }
  if (assignmentsRes.error) {
    throw new Error(`Failed to load service assignments: ${assignmentsRes.error.message}`);
  }
  if (staffRes.error) {
    throw new Error(`Failed to load assignable staff: ${staffRes.error.message}`);
  }
  if (selectedAssignmentsRes.error) {
    throw new Error(
      `Failed to load selected service assignments: ${selectedAssignmentsRes.error.message}`
    );
  }

  // Build the per-service assignment count using the *active* staff set so
  // the catalog's "{N} techs" pill never counts a removed or deactivated
  // technician (`db-rls.contract.md § 5`).
  const activeStaffIds = new Set((staffRes.data ?? []).map((s) => s.id));
  const assignmentCountByService = new Map<string, number>();
  for (const row of assignmentsRes.data ?? []) {
    if (!activeStaffIds.has(row.staff_id)) continue;
    assignmentCountByService.set(
      row.service_id,
      (assignmentCountByService.get(row.service_id) ?? 0) + 1
    );
  }

  const roster: CatalogService[] = (catalogRes.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    duration_min: row.duration_min,
    price_cents: row.price_cents,
    color_token: narrowColorToken(row.color_token),
    taxable: row.taxable,
    active: row.active,
    variable_price: row.variable_price,
    price_from_cents: row.price_from_cents,
    price_to_cents: row.price_to_cents,
    variable_price_note: row.variable_price_note,
    assignment_count: assignmentCountByService.get(row.id) ?? 0,
  }));

  // Per-service assignment rows for the `?selected=` id. Always an array
  // (possibly empty) when `?selected=` is set so `loadServiceWithAssignments`
  // can build the baseline; `null` when `?selected=` is absent so we don't
  // confuse "no assignments" with "no selection".
  const selectedAssignments: ReadonlyArray<{
    staff_id: string;
    duration_min_override: number | null;
  }> | null = selectedAssignmentsRes.data
    ? selectedAssignmentsRes.data.map((row) => ({
        staff_id: row.staff_id,
        duration_min_override: row.duration_min_override,
      }))
    : null;

  // Counts derive from the unfiltered roster so the header summary doesn't
  // jiggle as the user searches.
  const activeCount = roster.filter((r) => r.active).length;
  const totalCount = roster.length;

  // Derive the category auto-complete list from the current catalog. Sorted
  // + de-duplicated (case-sensitive on purpose — duplicate categories with
  // different casing are surfaced as distinct so the operator can spot the
  // inconsistency).
  const categories = Array.from(new Set(roster.map((r) => r.category))).sort();

  // Resolve the drawer mode + baseline. `selected` wins over `adding` when
  // both are present (per `contracts/ui.contract.md § 1`). Baseline hydration
  // goes through the typed projection `loadServiceWithAssignments` (Phase 5)
  // which returns `null` when the id isn't in the visible catalog (stale URL
  // or archived service hidden from the current view) — in that case the
  // drawer renders its closed state.
  let drawerMode: "closed" | "add" | "edit" = "closed";
  let drawerBaseline: ServiceDraftBaseline | null = null;
  if (selectedId) {
    drawerBaseline = loadServiceWithAssignments(roster, selectedAssignments ?? [], selectedId);
    if (drawerBaseline) {
      drawerMode = "edit";
    }
  } else if (isAdding) {
    drawerMode = "add";
  }

  return (
    <div
      className="settings-services-grid"
      data-slot="services-page"
      data-selected-id={selectedId ?? ""}
      data-drawer-mode={drawerMode}
    >
      <PageHeader activeCount={activeCount} totalCount={totalCount} />
      <CatalogList roster={roster} selectedId={selectedId} operatorRole={viewer.staff.role} />
      <Drawer
        mode={drawerMode}
        baseline={drawerBaseline}
        categories={categories}
        operatorRole={viewer.staff.role}
      />
      {/* US7: URL → Sonner toast bridge. Reads ?toast / ?secondary / ?name /
          ?error, fires the matching TOASTS entry, then strips them via a
          history rewrite (preserving ?selected= and ?adding=). Wrapped in
          Suspense because useSearchParams requires it under Next 16's strict
          streaming rules. */}
      <Suspense fallback={null}>
        <ServicesToaster />
      </Suspense>
    </div>
  );
}
