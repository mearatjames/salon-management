// Unit tests for the edit-panel Save gate helpers.
//
// Replaces e2e cases US3(b), US3(c), US3(e) per docs/e2e-pruning-audit.md:
//   - US3(b) header preview live update      → `previewName`
//   - US3(c) Save enables only when diff + valid name → `canSaveDraft`
//   - US3(e) switching rows discards drafts  → fresh draft via `draftFromTarget`
//     returns a non-dirty (Save-disabled) panel state for the new target.

import { describe, expect, it } from "vitest";

import {
  canSaveDraft,
  draftFromTarget,
  isDraftDirty,
  isNameValid,
  previewName,
  type EditDraft,
  type EditPanelTarget,
} from "@/app/(studio)/settings/staff/_save-gate";

const TECH: EditPanelTarget = {
  id: "tgt-tech",
  display_name: "Sam Chen",
  role: "technician",
  color_token: "--avatar-rose",
  active: true,
  pin_set: true,
  created_at: "2026-01-01T00:00:00.000Z",
  card_fee_exempt: false,
  supply_mode: "apply",
  supply_except: [],
  // 047-payroll-page § US5 — per-tech payroll rates.
  service_commission_pct: 0.6,
  tip_split_pct: 1,
  check_portion_cents: 0,
};

const MANAGER: EditPanelTarget = {
  ...TECH,
  id: "tgt-manager",
  display_name: "Jordan Lee",
  role: "manager",
  color_token: "--avatar-amber",
};

describe("previewName — US3(b) header preview live update", () => {
  it("falls back to the target name when the draft is empty", () => {
    expect(previewName("", "Sam Chen")).toBe("Sam Chen");
  });

  it("falls back when the draft is whitespace-only", () => {
    expect(previewName("   ", "Sam Chen")).toBe("Sam Chen");
  });

  it("returns the trimmed draft once the user has typed", () => {
    expect(previewName("  Sam Chen EDITED  ", "Sam Chen")).toBe("Sam Chen EDITED");
  });

  it("returns the draft even if it equals the target (live mirror)", () => {
    // The header preview re-renders on every keystroke; once the user retypes
    // the original name we still want it to mirror the draft, not the
    // persisted fallback (no flicker between them).
    expect(previewName("Sam Chen", "Sam Chen")).toBe("Sam Chen");
  });
});

describe("isNameValid — 2-char minimum", () => {
  it.each(["", " ", "a", "  a  "])("rejects %j (< 2 chars after trim)", (input) => {
    expect(isNameValid(input)).toBe(false);
  });

  it.each(["Jo", "Sam Chen", "  Sam Chen  "])("accepts %j (≥ 2 chars after trim)", (input) => {
    expect(isNameValid(input)).toBe(true);
  });
});

describe("isDraftDirty — every comparable field flips the flag", () => {
  it("returns false for a fresh draft mirroring the target (US3(e) baseline)", () => {
    expect(isDraftDirty(draftFromTarget(TECH), TECH)).toBe(false);
  });

  it("returns true when display_name changes", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), display_name: "Sam Chen EDITED" };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when role changes", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), role: "front_desk" };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when color_token changes", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), color_token: "--avatar-teal" };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when active flips", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), active: false };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when card_fee_exempt flips", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), card_fee_exempt: true };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when supply_mode changes", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), supply_mode: "exempt" };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when service_commission_pct changes (047 § US5)", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), service_commission_pct: 0.75 };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when tip_split_pct changes (047 § US5)", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), tip_split_pct: 0.5 };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("returns true when check_portion_cents changes (047 § US5)", () => {
    const draft: EditDraft = { ...draftFromTarget(TECH), check_portion_cents: 25000 };
    expect(isDraftDirty(draft, TECH)).toBe(true);
  });

  it("ignores supply_except when supply_mode !== 'partial'", () => {
    // Server validator strips supply_except outside `partial`, so the UI
    // must not flag a fresh-mount partial-mode tickset as dirty.
    const draft: EditDraft = {
      ...draftFromTarget(TECH),
      supply_mode: "exempt",
      supply_except: ["t-1", "t-2"],
    };
    expect(isDraftDirty(draft, TECH)).toBe(true); // dirty from supply_mode flip
    const draftNoFlip: EditDraft = {
      ...draftFromTarget(TECH),
      supply_except: ["t-1", "t-2"], // would-be partial-mode ticks; mode still "apply"
    };
    expect(isDraftDirty(draftNoFlip, TECH)).toBe(false);
  });

  it("partial mode: supply_except is compared with set-equality", () => {
    const target: EditPanelTarget = {
      ...TECH,
      supply_mode: "partial",
      supply_except: ["t-1", "t-2"],
    };
    const samePartial: EditDraft = {
      ...draftFromTarget(target),
      supply_except: ["t-2", "t-1"], // re-ordered — set-equal
    };
    expect(isDraftDirty(samePartial, target)).toBe(false);
    const differentPartial: EditDraft = {
      ...draftFromTarget(target),
      supply_except: ["t-1", "t-3"], // different membership
    };
    expect(isDraftDirty(differentPartial, target)).toBe(true);
  });
});

describe("canSaveDraft — US3(c) gate truth table", () => {
  const target = TECH;

  it("disabled on fresh mount (no diff)", () => {
    expect(
      canSaveDraft({
        draft: draftFromTarget(target),
        target,
        canEditAnyField: true,
      })
    ).toBe(false);
  });

  it("disabled with 1-character name even when diff exists", () => {
    const draft: EditDraft = { ...draftFromTarget(target), display_name: "S" };
    expect(canSaveDraft({ draft, target, canEditAnyField: true })).toBe(false);
  });

  it("enabled with valid diff", () => {
    const draft: EditDraft = { ...draftFromTarget(target), display_name: "Sam Chen EDITED" };
    expect(canSaveDraft({ draft, target, canEditAnyField: true })).toBe(true);
  });

  it("disabled after reverting back to original name (no diff)", () => {
    // Simulate: type a draft, then revert. The fresh re-derived draft is
    // equivalent to draftFromTarget(target) and must NOT be saveable.
    const draft: EditDraft = { ...draftFromTarget(target), display_name: target.display_name };
    expect(canSaveDraft({ draft, target, canEditAnyField: true })).toBe(false);
  });

  it("disabled when canEditAnyField is false (manager × owner gate, etc.)", () => {
    const draft: EditDraft = { ...draftFromTarget(target), display_name: "Sam Chen EDITED" };
    expect(canSaveDraft({ draft, target, canEditAnyField: false })).toBe(false);
  });
});

describe("draftFromTarget — US3(e) draft discard via row switch", () => {
  it("returns a Save-disabled state for the freshly-selected target", () => {
    // Page.tsx passes `key={target.id}` so React remounts the panel on row
    // switch. The new mount calls `useState(() => draftFromTarget(target))`
    // — verify that initial state is non-dirty (Save disabled) regardless
    // of what the previous panel held.
    const draft = draftFromTarget(MANAGER);
    expect(isDraftDirty(draft, MANAGER)).toBe(false);
    expect(canSaveDraft({ draft, target: MANAGER, canEditAnyField: true })).toBe(false);
  });

  it("does not carry display_name across targets", () => {
    // A draft built from the tech target must not match the manager target's
    // persisted name — proves the helper reads from `target`, not module state.
    const draftFromTech = draftFromTarget(TECH);
    expect(draftFromTech.display_name).toBe(TECH.display_name);
    expect(draftFromTech.display_name).not.toBe(MANAGER.display_name);
  });
});
