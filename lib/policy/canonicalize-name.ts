// Canonicalize a supply-type name for case-insensitive comparison.
//
// Returns `s` with whitespace trimmed, lowercased, and internal runs of
// whitespace collapsed to a single space. Mirrors the generated
// `supply_types.name_canonical` column (which is `lower(trim(name))`,
// plus the collapse step also applied during the migration backfill).
//
// Plain TS — no `"use server"` / `"use client"` directive — so it can be
// imported from the migration backfill's TS-side reference (in the
// Playwright spec's seed assertions) AND the picker's client island AND
// the server actions.
//
// Contract: specs/022-supply-types-catalog/data-model.md § 3.3
export function canonicalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
