// Supply-catalog loader for the staff edit panel.
//
// Per data-model.md § 2.2 + research § R2, the staff Pay & deductions panel
// needs the full list of supply_types to render the per-type picker. For each
// type we need:
//   - id, name, archived
//   - service_count : the number of active services referencing this type
//   - sample_amount_cents : a representative amount (the modal of active
//     services' supply_amount_cents) — `null` when service_count === 0
//
// The result is filtered to:
//   - all non-archived types (the picker always shows them), PLUS
//   - any archived type that is currently in this staff's `supply_except`
//     (Clarify Q3 — keep archived ticks visible so the operator can untick
//     them without first un-archiving the type).
//
// Order: by `name` ascending (FR-006 row ordering).
//
// SQL strategy: research § R2 prefers a single aggregate (`mode() within
// group`) — Supabase's PostgREST client cannot express that aggregate over
// a foreign-table embed, so we issue two scoped queries via the server client
// and compute the per-type aggregation in TypeScript:
//   1. supply_types row set (non-archived + currently-exempted ids)
//   2. services rows linked to the candidate type ids (active only)
// The candidate set is small (single-salon scope), so the in-memory mode
// computation is O(n) over the active services.

import { createSupabaseServerClient } from "@/lib/db/server";

export type SupplyCatalogTypeRow = {
  id: string;
  name: string;
  archived: boolean;
  service_count: number;
  /** null when service_count === 0. */
  sample_amount_cents: number | null;
};

export type SupplyCatalogForStaff = {
  types: SupplyCatalogTypeRow[];
};

/**
 * Compute the statistical mode (most-frequent value) of an array of numbers.
 * Tie-breaker: smallest value wins (matches PostgreSQL's `mode() within group
 * (order by …)` deterministic ordering). Returns null for an empty input.
 */
function modeOfAmounts(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let bestValue: number | null = null;
  let bestCount = 0;
  // Iterate sorted by value ascending so ties resolve to the smallest amount.
  for (const value of [...counts.keys()].sort((a, b) => a - b)) {
    const count = counts.get(value)!;
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  }
  return bestValue;
}

export async function loadSupplyCatalogForStaff(staffId: string): Promise<SupplyCatalogForStaff> {
  const supabase = await createSupabaseServerClient();

  // Step 1: look up the target staff's current supply_except so we know which
  // archived types to keep in the candidate set.
  const { data: staffRow, error: staffErr } = await supabase
    .from("staff")
    .select("supply_except")
    .eq("id", staffId)
    .single();

  if (staffErr) {
    throw new Error(`loadSupplyCatalogForStaff: staff lookup failed: ${staffErr.message}`);
  }
  const exceptedIds: readonly string[] = (staffRow?.supply_except as string[] | null) ?? [];

  // Step 2: fetch the supply_types candidate set. PostgREST doesn't support
  // a single WHERE clause that says "archived = false OR id IN (...)" in
  // chainable form — we issue the two halves separately and merge in JS.
  const { data: activeTypes, error: activeErr } = await supabase
    .from("supply_types")
    .select("id, name, archived")
    .eq("archived", false);

  if (activeErr) {
    throw new Error(`loadSupplyCatalogForStaff: active types load failed: ${activeErr.message}`);
  }

  type RawType = { id: string; name: string; archived: boolean };
  const candidates = new Map<string, RawType>();
  for (const t of (activeTypes ?? []) as RawType[]) {
    candidates.set(t.id, t);
  }

  if (exceptedIds.length > 0) {
    const { data: exceptedTypes, error: exceptedErr } = await supabase
      .from("supply_types")
      .select("id, name, archived")
      .in("id", exceptedIds as string[]);
    if (exceptedErr) {
      throw new Error(
        `loadSupplyCatalogForStaff: excepted types load failed: ${exceptedErr.message}`
      );
    }
    for (const t of (exceptedTypes ?? []) as RawType[]) {
      // The active half may already include some excepted ids (non-archived
      // types that the staff has ticked). Map.set is idempotent on key.
      candidates.set(t.id, t);
    }
  }

  // Step 3: aggregate active services per candidate type.
  const candidateIds = [...candidates.keys()];
  type ServiceRow = { supply_type_id: string; supply_amount_cents: number | null };
  let services: ServiceRow[] = [];
  if (candidateIds.length > 0) {
    const { data: serviceRows, error: serviceErr } = await supabase
      .from("services")
      .select("supply_type_id, supply_amount_cents")
      .eq("active", true)
      .in("supply_type_id", candidateIds);
    if (serviceErr) {
      throw new Error(`loadSupplyCatalogForStaff: service rows load failed: ${serviceErr.message}`);
    }
    services = (serviceRows ?? []).filter((r): r is ServiceRow => r.supply_type_id !== null);
  }

  // Group amounts by supply_type_id.
  const amountsByType = new Map<string, number[]>();
  for (const row of services) {
    if (row.supply_amount_cents == null) continue;
    const arr = amountsByType.get(row.supply_type_id) ?? [];
    arr.push(row.supply_amount_cents);
    amountsByType.set(row.supply_type_id, arr);
  }

  // Step 4: compose the rows.
  const types: SupplyCatalogTypeRow[] = [...candidates.values()]
    .map((t) => {
      const amounts = amountsByType.get(t.id) ?? [];
      return {
        id: t.id,
        name: t.name,
        archived: t.archived,
        service_count: amounts.length,
        sample_amount_cents: modeOfAmounts(amounts),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { types };
}
