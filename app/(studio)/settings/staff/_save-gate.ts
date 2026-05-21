// Pure helpers backing the edit-panel client island.
//
// `edit-panel.client.tsx` keeps a local `Draft` state and derives:
//   - the live preview name (US3(b))
//   - the dirty flag (US3(c))
//   - the name-validity flag (US3(c))
//   - the combined Save gate (US3(c))
//   - the "switching rows discards drafts" semantics (US3(e)) — covered by
//     React's `key={target.id}` remount; the gate output itself proves a fresh
//     draft derived from the new target is non-dirty and disabled by default.
//
// These were inlined inside the client component; extracting them into a
// `.ts` (no `"use client"`) lets Vitest exercise the logic directly without
// rendering React — mirroring the `numpad-reduce.ts` precedent shipped with
// the EOD cash-count keypad.

import type { StudioRole } from "@/lib/auth/session";

import type { RosterStaff, StaffSupplyMode } from "./_types";

export type EditPanelTarget = Pick<
  RosterStaff,
  | "id"
  | "display_name"
  | "role"
  | "color_token"
  | "active"
  | "pin_set"
  | "created_at"
  | "card_fee_exempt"
  | "supply_mode"
  | "supply_except"
  // 047-payroll-page § US5 — per-tech payroll rates.
  | "service_commission_pct"
  | "tip_split_pct"
  | "check_portion_cents"
>;

export type EditDraft = {
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  card_fee_exempt: boolean;
  supply_mode: StaffSupplyMode;
  supply_except: readonly string[];
  // 047-payroll-page § US5 — per-tech payroll rates. Stored shape: *_pct are
  // 0–1 fractions, check_portion_cents is integer cents.
  service_commission_pct: number;
  tip_split_pct: number;
  check_portion_cents: number;
};

/** Initial draft for a freshly-selected target — exactly mirrors the target. */
export function draftFromTarget(target: EditPanelTarget): EditDraft {
  return {
    display_name: target.display_name,
    role: target.role,
    color_token: target.color_token,
    active: target.active,
    card_fee_exempt: target.card_fee_exempt,
    supply_mode: target.supply_mode,
    supply_except: target.supply_except,
    service_commission_pct: target.service_commission_pct,
    tip_split_pct: target.tip_split_pct,
    check_portion_cents: target.check_portion_cents,
  };
}

/** US3(b) — header preview shows the current draft name, falling back to the
 *  target's persisted name when the draft is empty (or whitespace-only). */
export function previewName(draftDisplayName: string, fallback: string): string {
  const trimmed = draftDisplayName.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Name must be ≥ 2 characters after trimming. Single source of truth — both
 *  the inline hint and the Save gate consult this. */
export function isNameValid(draftDisplayName: string): boolean {
  return draftDisplayName.trim().length >= 2;
}

/** Set-equality for the partial-mode `supply_except` array. Matches the
 *  server-side audit-diff comparison so the UI's dirty signal lines up with
 *  what the audit row will record. */
function supplyExceptEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return [...a].sort().join(",") === [...b].sort().join(",");
}

/** US3(c) — every comparable field; ignores `supply_except` when the draft
 *  mode isn't `partial` (server validator drops it; UI mirrors that). */
export function isDraftDirty(draft: EditDraft, target: EditPanelTarget): boolean {
  return (
    draft.display_name !== target.display_name ||
    draft.role !== target.role ||
    draft.color_token !== target.color_token ||
    draft.active !== target.active ||
    draft.card_fee_exempt !== target.card_fee_exempt ||
    draft.supply_mode !== target.supply_mode ||
    (draft.supply_mode === "partial" &&
      !supplyExceptEqual(draft.supply_except, target.supply_except)) ||
    // 047-payroll-page § US5 — payroll rates participate in the dirty signal.
    draft.service_commission_pct !== target.service_commission_pct ||
    draft.tip_split_pct !== target.tip_split_pct ||
    draft.check_portion_cents !== target.check_portion_cents
  );
}

/** US3(c) — combined Save gate: enabled iff dirty AND name valid AND
 *  permissions allow editing any field. */
export function canSaveDraft(args: {
  draft: EditDraft;
  target: EditPanelTarget;
  canEditAnyField: boolean;
}): boolean {
  const { draft, target, canEditAnyField } = args;
  return isDraftDirty(draft, target) && isNameValid(draft.display_name) && canEditAnyField;
}
