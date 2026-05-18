// Vitest contract test for the staff audit-diff helper in
// `app/(studio)/settings/staff/_audit-diff.ts`. Per data-model.md § 2.3 +
// research § R3 the helper exports `STAFF_DIFF_KEYS` (length 7, ordered) and
// `buildChanges(before, after): { before, after, changes }` returning scoped
// projections of only the changed keys.
//
// Constitution IV: test-first MANDATORY for the audit-diff helper. This spec
// lands BEFORE `_audit-diff.ts` is implemented so the red phase exists in
// CI history.

import { describe, expect, it } from "vitest";

import {
  STAFF_DIFF_KEYS,
  buildChanges,
  type StaffSnapshot,
} from "@/app/(studio)/settings/staff/_audit-diff";

const BASE: StaffSnapshot = {
  display_name: "Alice",
  role: "technician",
  color_token: "--avatar-rose",
  active: true,
  card_fee_exempt: false,
  supply_mode: "apply",
  supply_except: [],
};

describe("STAFF_DIFF_KEYS", () => {
  it("has length 7", () => {
    expect(STAFF_DIFF_KEYS).toHaveLength(7);
  });

  it("is in this exact order", () => {
    expect([...STAFF_DIFF_KEYS]).toEqual([
      "display_name",
      "role",
      "color_token",
      "active",
      "card_fee_exempt",
      "supply_mode",
      "supply_except",
    ]);
  });
});

describe("buildChanges", () => {
  it("returns empty before/after/changes when snapshots are identical", () => {
    const out = buildChanges(BASE, { ...BASE });
    expect(out).toEqual({ before: {}, after: {}, changes: [] });
  });

  it("returns scoped projection over `card_fee_exempt` when that is the only change", () => {
    const after: StaffSnapshot = { ...BASE, card_fee_exempt: true };
    const out = buildChanges(BASE, after);
    expect(out.changes).toEqual(["card_fee_exempt"]);
    expect(out.before).toEqual({ card_fee_exempt: false });
    expect(out.after).toEqual({ card_fee_exempt: true });
  });

  it("treats `supply_except` reordering as no change (Set-equality per research § R3)", () => {
    const before: StaffSnapshot = {
      ...BASE,
      supply_mode: "partial",
      supply_except: ["a", "b", "c"],
    };
    const after: StaffSnapshot = {
      ...BASE,
      supply_mode: "partial",
      supply_except: ["c", "a", "b"],
    };
    const out = buildChanges(before, after);
    expect(out.changes).toEqual([]);
    expect(out.before).toEqual({});
    expect(out.after).toEqual({});
  });

  it("returns scoped diff with raw uuids preserved when `supply_except` is truly different", () => {
    const before: StaffSnapshot = { ...BASE, supply_mode: "partial", supply_except: ["a", "b"] };
    const after: StaffSnapshot = {
      ...BASE,
      supply_mode: "partial",
      supply_except: ["a", "b", "c"],
    };
    const out = buildChanges(before, after);
    expect(out.changes).toEqual(["supply_except"]);
    expect(out.before).toEqual({ supply_except: ["a", "b"] });
    expect(out.after).toEqual({ supply_except: ["a", "b", "c"] });
  });

  it("returns multi-key change in `STAFF_DIFF_KEYS` order", () => {
    // Change display_name (idx 0), card_fee_exempt (idx 4), supply_mode (idx 5)
    // out of order in the snapshot literal to confirm the helper enforces
    // the canonical order from STAFF_DIFF_KEYS.
    const after: StaffSnapshot = {
      ...BASE,
      supply_mode: "exempt",
      card_fee_exempt: true,
      display_name: "Alicia",
    };
    const out = buildChanges(BASE, after);
    expect(out.changes).toEqual(["display_name", "card_fee_exempt", "supply_mode"]);
    expect(out.before).toEqual({
      display_name: "Alice",
      card_fee_exempt: false,
      supply_mode: "apply",
    });
    expect(out.after).toEqual({
      display_name: "Alicia",
      card_fee_exempt: true,
      supply_mode: "exempt",
    });
  });
});
