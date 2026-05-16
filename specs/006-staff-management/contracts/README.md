# Contracts — 006-staff-management

The Staff settings feature exposes one route group, six Server Actions,
one audit-enum extension, one permission-matrix module, and one set of
toast strings. Each contract below is the **single source of truth** for
that surface — implementation that drifts is the implementation that's
wrong.

| Contract                                                       | What it pins down                                                              |
|----------------------------------------------------------------|--------------------------------------------------------------------------------|
| [`routes.contract.md`](./routes.contract.md)                   | URL shape, auth gate, query-param vocabulary (`?error=`, `?toast=`), search params |
| [`server-actions.contract.md`](./server-actions.contract.md)   | Input FormData, output redirect/revalidate, validation errors, audit payload   |
| [`audit.contract.md`](./audit.contract.md)                     | The six new `AuditAction` verbs and their payload shape                        |
| [`permissions.contract.md`](./permissions.contract.md)         | The operator × target × action permission matrix (the trust boundary)          |
| [`ui.contract.md`](./ui.contract.md)                            | Component tree, where each prototype section maps in the repo, toast strings, copy |

Conventions:

- **Server Actions** are exported from `app/(studio)/settings/staff/actions.ts`.
- All actions return `Promise<void>` and always end in `redirect(...)` —
  there are no return values; UI state is recovered via `?error=` /
  `?toast=` query params (matching the feature-003 idiom).
- All actions follow the same prelude: `requireStudioSession()` →
  `assertCanEnterSettings(viewer)` → `loadTarget(staff_id)` (skipped for
  `addStaff`) → `assertMutationAllowed(viewer, target, action)` →
  parse + validate FormData → mutate → audit → `revalidatePath` →
  `redirect`.
- **`assertMutationAllowed`** is the trust boundary. Rejection is
  `?error=forbidden_target` with **zero** audit rows written.
- **No `authorizing_staff_id`** in any audit payload — the manager-PIN
  inline override was removed in the 2026-05-15 clarifications session.
  `acting_as_staff_id` is the sole accountability key on every mutation
  row.
- **`revalidatePath`** is called *before* `redirect` so the destination
  renders fresh data. `redirect` throws inside Next.js so it is the last
  call in any branch.
