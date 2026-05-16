// Per-tech assignment diff for `updateService`. Pure — used inside the
// Server Action to compute the four-arm operation list documented in
// `data-model.md § 5.2`.
//
// Returned operations:
//   added                — staff present in draft but not baseline
//   removed              — staff present in baseline but not draft (only ids)
//   overrides_changed    — staff present in both, but `duration_min_override`
//                          differs (excludes added/removed; those carry their
//                          override in the row payload directly)

import type { ServiceAssignment } from "./_types";

export type AssignmentDiff = {
  added: ServiceAssignment[];
  removed: string[];
  overrides_changed: Array<{
    staff_id: string;
    before: number | null;
    after: number | null;
  }>;
};

function index(rows: readonly ServiceAssignment[]): Map<string, ServiceAssignment> {
  const m = new Map<string, ServiceAssignment>();
  for (const r of rows) m.set(r.staff_id, r);
  return m;
}

export function staffAssignmentDiff(
  baseline: readonly ServiceAssignment[],
  draft: readonly ServiceAssignment[]
): AssignmentDiff {
  const base = index(baseline);
  const next = index(draft);

  const added: ServiceAssignment[] = [];
  const removed: string[] = [];
  const overrides_changed: AssignmentDiff["overrides_changed"] = [];

  for (const [id, draftRow] of next) {
    const baseRow = base.get(id);
    if (!baseRow) {
      added.push({ staff_id: id, duration_min_override: draftRow.duration_min_override });
      continue;
    }
    if (baseRow.duration_min_override !== draftRow.duration_min_override) {
      overrides_changed.push({
        staff_id: id,
        before: baseRow.duration_min_override,
        after: draftRow.duration_min_override,
      });
    }
  }

  for (const [id] of base) {
    if (!next.has(id)) removed.push(id);
  }

  return { added, removed, overrides_changed };
}
