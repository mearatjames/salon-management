# Contracts — 021-services-deductions

Four contract documents specifying the public surface of this feature. Implementation tasks reference these by section number.

| Contract | Scope |
|---|---|
| [`db-migration.contract.md`](./db-migration.contract.md) | Columns added to `public.services`, CHECK constraints, backfill behavior, RLS posture, regen-types step. |
| [`server-actions.contract.md`](./server-actions.contract.md) | `addService` + `updateService` extensions: new FormData keys, validator-call order, error codes, redirect targets. |
| [`audit-payload.contract.md`](./audit-payload.contract.md) | `SERVICE_DIFF_KEYS` extension; `service.added` and `service.updated` payload extensions; "deduction-only edit" example. |
| [`ui.contract.md`](./ui.contract.md) | Two-pane shell, panel state machine, chip vocabulary, Segmented control behavior, Net-to-tech preview, role-gated disabled state. |

Reading order for someone new to this feature: spec.md → plan.md § Summary → data-model.md → these contracts in the order listed above → quickstart.md.
