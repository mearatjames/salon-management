# Phase 1 — Contracts: Per-staff payout exemptions

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

This directory holds the four executable contracts implementation must conform to. Each contract is the single source of truth for one boundary the feature touches.

| Contract | Boundary | What it pins down |
|---|---|---|
| [`db-migration.contract.md`](./db-migration.contract.md) | DB schema | The exact shape of migration `0018_staff_pay_deductions.sql`: columns added to `staff`, CHECK constraint, two triggers (FK-shape validation on `staff` INSERT/UPDATE + cascading prune on `supply_types` DELETE), no audit-log schema change, no RLS change. |
| [`server-actions.contract.md`](./server-actions.contract.md) | Server Actions | The extended `updateStaff` FormData shape (3 new fields), validator error codes, save-time wipe rule for `supply_except` when mode ≠ `partial`, the unchanged `addStaff`/`setStaffPin`/`deactivateStaff`/`reactivateStaff`/`removeStaff` actions. |
| [`audit-payload.contract.md`](./audit-payload.contract.md) | Audit log | The extended `staff.updated` payload shape (3 new diff keys), the `STAFF_DIFF_KEYS` array order, the raw-uuid rule for `supply_except` diff entries, the no-new-action-verb rule. |
| [`ui.contract.md`](./ui.contract.md) | UI components | The `<PayDeductionsSection>` state machine, the `<RosterFilterChips>` localStorage rule, the panel sectioning order, the live status badges derivation, the mobile bottom-sheet behavior, the add-staff wizard pills. |

Contracts depend on one another in a strict order: db-migration → server-actions → audit-payload → ui. A change to a contract MUST be propagated to the contracts that depend on it (e.g., adding a new diff key requires updating both audit-payload and ui).
