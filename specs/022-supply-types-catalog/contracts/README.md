# Contracts Index — 022-supply-types-catalog

Four contracts, one per interface surface. Each is the authoritative source for its surface; the data model, plan, and tasks reference these.

| Contract | What it locks down |
|---|---|
| [`db-migration.contract.md`](./db-migration.contract.md) | SQL for `0017_supply_types_catalog.sql` — table create, indexes, trigger, RLS, services FK column, backfill, CHECK swap, supply_label drop, audit-log INSERT |
| [`server-actions.contract.md`](./server-actions.contract.md) | The 4 new catalog Server Actions (`createSupplyType`, `renameSupplyType`, `archiveSupplyType`, `reactivateSupplyType`) + the 2 modified service actions (`addService`, `updateService` — supply FormData field swap) — signatures, FormData keys, error codes, redirect shapes, audit obligations |
| [`audit-payload.contract.md`](./audit-payload.contract.md) | Payload shapes for the 4 new `supply_type.*` audit verbs + the diff-key swap on `service.added` / `service.updated` |
| [`ui.contract.md`](./ui.contract.md) | EditPolicySheet shell state machine + SupplyTypePicker (Popover + Command) + SupplyTypesSection (rename / archive / expand) — including the picker's inline-create flow, the section's empty/loading/error states, and the keyboard map |

Read order for a reviewer: db-migration → audit-payload → server-actions → ui. The DB is the foundation; the audit shapes are derivable from the DB shape; the actions implement the contract that produces those audit rows; the UI consumes the actions.
