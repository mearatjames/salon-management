// Permission helpers for the supply-types catalog Server Actions.
//
// Re-exports the shared catalog-write gate from the services surface so
// the policy actions share one authority — owner OR manager.
//
// Contract: specs/022-supply-types-catalog/contracts/server-actions.contract.md § 8

export { assertCanWriteCatalog, PermissionError } from "../../services/permissions";
