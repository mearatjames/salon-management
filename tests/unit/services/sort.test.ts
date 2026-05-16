// Vitest contract test for the catalog group/sort comparator
// (`app/(studio)/services/_sort.ts`). Mirrors the SQL
// `order by s.category, s.name` from the page hot query so an SSR stream
// and a fully-hydrated render produce the same order
// (data-model.md § 6 invariant 7).

import { describe, expect, it } from "vitest";

import { sortCatalogGroups } from "@/app/(studio)/services/_sort";
import type { CatalogService } from "@/app/(studio)/services/_types";

function svc(
  partial: Partial<CatalogService> & { id: string; name: string; category: string }
): CatalogService {
  return {
    duration_min: 30,
    price_cents: 3000,
    color_token: "--avatar-rose",
    taxable: true,
    active: true,
    variable_price: false,
    price_from_cents: null,
    price_to_cents: null,
    variable_price_note: null,
    assignment_count: 0,
    ...partial,
  } as CatalogService;
}

describe("sortCatalogGroups", () => {
  it("returns an empty array for empty input", () => {
    expect(sortCatalogGroups([])).toEqual([]);
  });

  it("groups by category ascending (alpha, case-insensitive) and sorts by name within each", () => {
    const rows = [
      svc({ id: "1", name: "Spa pedicure", category: "Pedicure" }),
      svc({ id: "2", name: "Gel polish", category: "Manicure" }),
      svc({ id: "3", name: "Classic pedicure", category: "Pedicure" }),
      svc({ id: "4", name: "Classic manicure", category: "Manicure" }),
    ];
    const groups = sortCatalogGroups(rows);
    expect(groups.map((g) => g.category)).toEqual(["Manicure", "Pedicure"]);
    expect(groups[0].items.map((s) => s.name)).toEqual(["Classic manicure", "Gel polish"]);
    expect(groups[1].items.map((s) => s.name)).toEqual(["Classic pedicure", "Spa pedicure"]);
  });

  it("collapses mixed-case categories into the same bucket", () => {
    const rows = [
      svc({ id: "1", name: "B", category: "manicure" }),
      svc({ id: "2", name: "A", category: "Manicure" }),
      svc({ id: "3", name: "C", category: "MANICURE" }),
    ];
    const groups = sortCatalogGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  it("keeps identical names under different categories in their respective groups", () => {
    const rows = [
      svc({ id: "1", name: "Shellac", category: "Manicure" }),
      svc({ id: "2", name: "Shellac", category: "Pedicure" }),
    ];
    const groups = sortCatalogGroups(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].category).toBe("Manicure");
    expect(groups[0].items.map((s) => s.id)).toEqual(["1"]);
    expect(groups[1].category).toBe("Pedicure");
    expect(groups[1].items.map((s) => s.id)).toEqual(["2"]);
  });

  it("sorts names case-insensitively within a group", () => {
    const rows = [
      svc({ id: "1", name: "banana", category: "X" }),
      svc({ id: "2", name: "Apple", category: "X" }),
      svc({ id: "3", name: "cherry", category: "X" }),
    ];
    const groups = sortCatalogGroups(rows);
    expect(groups[0].items.map((s) => s.name)).toEqual(["Apple", "banana", "cherry"]);
  });
});
