// Vitest contract test for the staff roster filter helper in
// `app/(studio)/settings/staff/_filter.ts`. Covers the case-insensitive
// substring search and the show-inactive toggle on an in-memory 50-row
// array. Written RED before T028's `_filter.ts` lands.

import { describe, expect, it } from "vitest";

import { filterStaff, type RosterStaff } from "@/app/(studio)/settings/staff/_filter";

const ROLES: RosterStaff["role"][] = ["owner", "manager", "technician", "front_desk"];

// 023-staff-payout-exemptions + 047-payroll-page — defaults for the six
// payout/payroll RosterStaff fields so existing fixtures stay compact.
const NO_EXEMPTIONS = {
  card_fee_exempt: false as const,
  supply_mode: "apply" as const,
  supply_except: [] as readonly string[],
  service_commission_pct: 0,
  tip_split_pct: 0,
  check_portion_cents: 0,
};

function makeRoster(size: number): RosterStaff[] {
  // Deterministic synthetic roster. 1/5 of rows are inactive.
  return Array.from({ length: size }).map((_, i) => ({
    id: `id-${i}`,
    display_name: `Staff ${String.fromCharCode(65 + (i % 26))}${i}`,
    role: ROLES[i % ROLES.length],
    color_token: "--avatar-rose",
    active: i % 5 !== 0,
    created_at: "2026-01-01T00:00:00.000Z",
    pin_set: i % 2 === 0,
    ...NO_EXEMPTIONS,
  }));
}

describe("filterStaff — show-inactive toggle", () => {
  it("hides inactive rows when showInactive=false", () => {
    const rows = makeRoster(50);
    const filtered = filterStaff(rows, "", false);
    expect(filtered.length).toBe(40); // 50 - 10 inactive
    expect(filtered.every((r) => r.active)).toBe(true);
  });

  it("includes inactive rows when showInactive=true", () => {
    const rows = makeRoster(50);
    const filtered = filterStaff(rows, "", true);
    expect(filtered.length).toBe(50);
  });
});

describe("filterStaff — case-insensitive substring search", () => {
  it("matches a lowercase needle against mixed-case names", () => {
    const rows: RosterStaff[] = [
      {
        id: "1",
        display_name: "Maya Patel",
        role: "owner",
        color_token: "--avatar-rose",
        active: true,
        created_at: "2026-01-01T00:00:00.000Z",
        pin_set: true,
        ...NO_EXEMPTIONS,
      },
      {
        id: "2",
        display_name: "Jordan Lee",
        role: "manager",
        color_token: "--avatar-amber",
        active: true,
        created_at: "2026-01-01T00:00:00.000Z",
        pin_set: true,
        ...NO_EXEMPTIONS,
      },
      {
        id: "3",
        display_name: "Sam Chen",
        role: "technician",
        color_token: "--avatar-purple",
        active: true,
        created_at: "2026-01-01T00:00:00.000Z",
        pin_set: true,
        ...NO_EXEMPTIONS,
      },
    ];
    expect(filterStaff(rows, "ma", true).map((r) => r.display_name)).toEqual(["Maya Patel"]);
    expect(filterStaff(rows, "MA", true).map((r) => r.display_name)).toEqual(["Maya Patel"]);
    expect(filterStaff(rows, "ee", true).map((r) => r.display_name)).toEqual(["Jordan Lee"]);
  });

  it("matches mid-name substrings", () => {
    const rows: RosterStaff[] = [
      {
        id: "1",
        display_name: "Maya Patel",
        role: "owner",
        color_token: "--avatar-rose",
        active: true,
        created_at: "2026-01-01T00:00:00.000Z",
        pin_set: true,
        ...NO_EXEMPTIONS,
      },
    ];
    expect(filterStaff(rows, "ate", true).length).toBe(1);
  });

  it("trims whitespace from the query before matching", () => {
    const rows = makeRoster(5);
    expect(filterStaff(rows, "  Staff  ", true).length).toBe(5);
  });

  it("returns the full list when the query is empty or whitespace", () => {
    const rows = makeRoster(20);
    expect(filterStaff(rows, "", true).length).toBe(20);
    expect(filterStaff(rows, "   ", true).length).toBe(20);
  });

  it("returns an empty array when no name matches", () => {
    const rows = makeRoster(20);
    expect(filterStaff(rows, "zzzzz_nope", true)).toEqual([]);
  });
});

describe("filterStaff — search + show-inactive composition", () => {
  it("applies both filters: hide inactive AND substring", () => {
    const rows = makeRoster(50);
    // Rows with index % 5 === 0 are inactive; their display names contain "Staff <letter><n>".
    const filtered = filterStaff(rows, "Staff", false);
    expect(filtered.length).toBe(40);
    expect(filtered.every((r) => r.active)).toBe(true);
    expect(filtered.every((r) => r.display_name.toLowerCase().includes("staff"))).toBe(true);
  });
});

describe("filterStaff — purity", () => {
  it("does not mutate the input array", () => {
    const rows = makeRoster(10);
    const snapshot = rows.map((r) => r.id);
    filterStaff(rows, "Staff", false);
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
