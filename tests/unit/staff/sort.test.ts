// Vitest contract test for the staff roster sort comparator in
// `app/(studio)/settings/staff/_sort.ts`. Per data-model.md § 6 invariant 8:
// sort by `role_priority` (owner=0, manager=1, technician=2, front_desk=3),
// then by `display_name` case-insensitive ASC. Written RED before the
// implementation module — the import below resolves only after T028 lands
// `_sort.ts`.

import { describe, expect, it } from "vitest";

import {
  ROLE_PRIORITY,
  compareStaff,
  sortStaff,
  type RosterStaff,
} from "@/app/(studio)/settings/staff/_sort";

function mk(partial: Partial<RosterStaff> & { display_name: string; role: RosterStaff["role"] }): RosterStaff {
  return {
    id: partial.id ?? partial.display_name.toLowerCase().replace(/\s+/g, "-"),
    display_name: partial.display_name,
    role: partial.role,
    color_token: partial.color_token ?? "--avatar-rose",
    active: partial.active ?? true,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    pin_set: partial.pin_set ?? true,
  };
}

describe("ROLE_PRIORITY", () => {
  it("orders owner before manager before technician before front_desk", () => {
    expect(ROLE_PRIORITY.owner).toBe(0);
    expect(ROLE_PRIORITY.manager).toBe(1);
    expect(ROLE_PRIORITY.technician).toBe(2);
    expect(ROLE_PRIORITY.front_desk).toBe(3);
  });
});

describe("compareStaff — role priority first", () => {
  it("places owner before manager", () => {
    const a = mk({ display_name: "Zara", role: "owner" });
    const b = mk({ display_name: "Alice", role: "manager" });
    expect(compareStaff(a, b)).toBeLessThan(0);
    expect(compareStaff(b, a)).toBeGreaterThan(0);
  });

  it("places manager before technician", () => {
    const a = mk({ display_name: "Zara", role: "manager" });
    const b = mk({ display_name: "Alice", role: "technician" });
    expect(compareStaff(a, b)).toBeLessThan(0);
  });

  it("places technician before front_desk", () => {
    const a = mk({ display_name: "Zara", role: "technician" });
    const b = mk({ display_name: "Alice", role: "front_desk" });
    expect(compareStaff(a, b)).toBeLessThan(0);
  });
});

describe("compareStaff — alphabetical within role (case-insensitive)", () => {
  it("orders names ascending within the same role", () => {
    const a = mk({ display_name: "Alice", role: "technician" });
    const b = mk({ display_name: "Bob", role: "technician" });
    expect(compareStaff(a, b)).toBeLessThan(0);
    expect(compareStaff(b, a)).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    const a = mk({ display_name: "alice", role: "technician" });
    const b = mk({ display_name: "Bob", role: "technician" });
    expect(compareStaff(a, b)).toBeLessThan(0);
  });

  it("returns 0 for the same role + name (case-insensitive)", () => {
    const a = mk({ display_name: "Alice", role: "technician", id: "1" });
    const b = mk({ display_name: "ALICE", role: "technician", id: "2" });
    expect(compareStaff(a, b)).toBe(0);
  });
});

describe("sortStaff — end-to-end", () => {
  it("sorts a mixed-role roster owner → manager → tech → front_desk, alpha within role", () => {
    const input: RosterStaff[] = [
      mk({ display_name: "Sam Chen", role: "technician" }),
      mk({ display_name: "Jordan Lee", role: "manager" }),
      mk({ display_name: "Maya Patel", role: "owner" }),
      mk({ display_name: "Alex Reed", role: "front_desk" }),
      mk({ display_name: "Bea Wong", role: "technician" }),
    ];
    const sorted = sortStaff(input).map((s) => s.display_name);
    expect(sorted).toEqual([
      "Maya Patel",     // owner
      "Jordan Lee",     // manager
      "Bea Wong",       // technician (B before S)
      "Sam Chen",       // technician
      "Alex Reed",      // front_desk
    ]);
  });

  it("does not mutate the input array", () => {
    const input: RosterStaff[] = [
      mk({ display_name: "Sam Chen", role: "technician" }),
      mk({ display_name: "Maya Patel", role: "owner" }),
    ];
    const snapshot = input.map((s) => s.display_name);
    sortStaff(input);
    expect(input.map((s) => s.display_name)).toEqual(snapshot);
  });
});
