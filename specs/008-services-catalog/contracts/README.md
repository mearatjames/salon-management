# Contracts — Services catalog

Each file documents an interface this feature exposes. Tasks and tests cite these contracts; implementation that drifts from them is a bug.

| Contract | Owns |
|---|---|
| [`db-rls.contract.md`](./db-rls.contract.md) | The two new tables (`services`, `staff_services`), their columns, constraints, indexes, triggers, and RLS policies. |
| [`server-actions.contract.md`](./server-actions.contract.md) | The five Server Actions (`addService`, `updateService`, `archiveService`, `restoreService`) + the typed read helper (`loadServiceWithAssignments`). FormData shapes, success/failure URLs, error codes. |
| [`audit.contract.md`](./audit.contract.md) | The four new `service.*` audit verbs, their payload shapes, and the `entity_type` dispatch update. |
| [`ui.contract.md`](./ui.contract.md) | Page composition (RSC → client islands), the drawer state machine, the URL → toast bridge, the visual primitives the page composes. |
