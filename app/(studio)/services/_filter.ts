// Catalog filter helper — case-insensitive substring match on `name`.
// Pure, used by the client filter island.

import type { CatalogService } from "./_types";

export function filterServicesByName(
  services: readonly CatalogService[],
  query: string
): CatalogService[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle.length === 0) return [...services];
  return services.filter((s) => s.name.toLowerCase().includes(needle));
}
