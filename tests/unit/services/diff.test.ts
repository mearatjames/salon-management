// Vitest contract test for `staffAssignmentDiff` per data-model.md § 5.2.

import { describe, expect, it } from "vitest";

import { staffAssignmentDiff } from "@/app/(studio)/services/_diff";
import type { ServiceAssignment } from "@/app/(studio)/services/_types";

function row(staff_id: string, override: number | null = null): ServiceAssignment {
  return { staff_id, duration_min_override: override };
}

describe("staffAssignmentDiff", () => {
  it("returns empty ops when baseline and draft are both empty", () => {
    const d = staffAssignmentDiff([], []);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.overrides_changed).toEqual([]);
  });

  it("returns empty ops when baseline equals draft (no-op)", () => {
    const baseline = [row("a", null), row("b", 60)];
    const draft = [row("b", 60), row("a", null)]; // order-insensitive
    const d = staffAssignmentDiff(baseline, draft);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.overrides_changed).toEqual([]);
  });

  it("detects pure adds", () => {
    const d = staffAssignmentDiff([], [row("a", null), row("b", 45)]);
    expect(d.added).toEqual([
      { staff_id: "a", duration_min_override: null },
      { staff_id: "b", duration_min_override: 45 },
    ]);
    expect(d.removed).toEqual([]);
    expect(d.overrides_changed).toEqual([]);
  });

  it("detects pure removes", () => {
    const d = staffAssignmentDiff([row("a", null), row("b", 45)], []);
    expect(d.added).toEqual([]);
    expect(d.removed.sort()).toEqual(["a", "b"]);
    expect(d.overrides_changed).toEqual([]);
  });

  it("detects pure override changes (null → 60)", () => {
    const d = staffAssignmentDiff([row("a", null)], [row("a", 60)]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.overrides_changed).toEqual([{ staff_id: "a", before: null, after: 60 }]);
  });

  it("detects pure override changes (60 → null)", () => {
    const d = staffAssignmentDiff([row("a", 60)], [row("a", null)]);
    expect(d.overrides_changed).toEqual([{ staff_id: "a", before: 60, after: null }]);
  });

  it("detects pure override changes (30 → 60)", () => {
    const d = staffAssignmentDiff([row("a", 30)], [row("a", 60)]);
    expect(d.overrides_changed).toEqual([{ staff_id: "a", before: 30, after: 60 }]);
  });

  it("handles a mixed bag: add + remove + change", () => {
    const baseline = [row("a", null), row("b", 60)];
    const draft = [row("b", 75), row("c", null)];
    const d = staffAssignmentDiff(baseline, draft);
    expect(d.added).toEqual([{ staff_id: "c", duration_min_override: null }]);
    expect(d.removed).toEqual(["a"]);
    expect(d.overrides_changed).toEqual([{ staff_id: "b", before: 60, after: 75 }]);
  });
});
