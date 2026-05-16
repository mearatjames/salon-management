// Typed read helper for the services-catalog drawer baseline.
//
// Per `contracts/server-actions.contract.md § 5` this is NOT a Server
// Action — it's a pure projection over RSC-fetched data. The page in
// `page.tsx` already runs the per-service assignments query when
// `?selected=` is set; this helper just zips the catalog row with the
// assignment rows into a `ServiceDraftBaseline` so the drawer client
// island receives a single typed prop.
//
// Why it lives in its own file (deviation from the contract's wording):
// the contract says "exported from the same file [as the Server Actions]",
// but Next.js's `"use server"` directive forbids non-async exports. Moving
// the helper here keeps `actions.ts` compliant with that rule. Consumers
// import it directly from `./_load.ts`.
//
// Input-shape deviation: the contract's `assignments` array nominally has
// shape `{ service_id, staff_id, duration_min_override }`. The page-level
// query is already scoped by `service_id` so we drop it from the helper's
// input — saves one column on the wire and keeps the helper input shape
// matching what the page actually fetches.

import type { CatalogService, ServiceDraftBaseline } from "./_types";

export function loadServiceWithAssignments(
  catalog: CatalogService[],
  assignments: ReadonlyArray<{
    staff_id: string;
    duration_min_override: number | null;
  }>,
  id: string
): ServiceDraftBaseline | null {
  const row = catalog.find((r) => r.id === id);
  if (!row) return null;
  return {
    ...row,
    assignments: assignments.map((a) => ({
      staff_id: a.staff_id,
      duration_min_override: a.duration_min_override,
    })),
  };
}
