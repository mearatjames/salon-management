// Catalog group/sort comparator. Mirrors the SQL `order by s.category, s.name`
// from the page hot query so a streaming render and a fully-hydrated render
// produce the same order (data-model.md § 6 invariant 7).
//
// Grouping is case-insensitive on `category` — "Manicure", "manicure", and
// "MANICURE" collapse to the same bucket. Within each bucket, services
// are sorted by `name` ascending (case-insensitive).
//
// The group's `category` label is the first non-empty form seen (which
// matches what the SQL `order by category` deterministically picks too —
// "Manicure" < "manicure" lexicographically since uppercase letters sort
// before lowercase in ASCII; but to be locale-stable we explicitly pick
// the form that sorts first via `localeCompare`).

import type { CatalogService } from "./_types";

export type CatalogGroup = {
  category: string;
  items: CatalogService[];
};

function lowerCmp(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  return 0;
}

export function sortCatalogGroups(services: readonly CatalogService[]): CatalogGroup[] {
  if (services.length === 0) return [];

  // Bucket by lower-cased category.
  const buckets = new Map<string, { label: string; items: CatalogService[] }>();
  for (const svc of services) {
    const key = svc.category.toLowerCase();
    const existing = buckets.get(key);
    if (existing) {
      existing.items.push(svc);
      // Keep the label that sorts first alphabetically so the bucket
      // label is deterministic regardless of insertion order.
      if (svc.category.localeCompare(existing.label) < 0) {
        existing.label = svc.category;
      }
    } else {
      buckets.set(key, { label: svc.category, items: [svc] });
    }
  }

  const groups: CatalogGroup[] = [];
  for (const { label, items } of buckets.values()) {
    items.sort((a, b) => lowerCmp(a.name, b.name));
    groups.push({ category: label, items });
  }
  groups.sort((a, b) => lowerCmp(a.category, b.category));
  return groups;
}
