// EditPolicyButton (server component shell) — reads the operator's role
// server-side, decides the disabled state, and renders the client island
// that owns the open state + URL bridge.
//
// Following the same role-gate pattern the 008 `<CatalogList>` uses for
// the "Add service" button: the actual gate runs server-side via
// `canWriteCatalog(role)`; the disabled UI is wrapped with the shared
// `<OwnerOnlyTooltip>` so non-privileged operators see the calm
// explanation instead of a silently inert control.
//
// The Server Actions called from inside the sheet (createSupplyType /
// renameSupplyType / archiveSupplyType / reactivateSupplyType) each
// re-check via `assertCanWriteCatalog` — the UI disable is purely UX.
//
// Contracts:
//   - specs/022-supply-types-catalog/contracts/ui.contract.md § 1

import { EditPolicyButtonClient } from "@/components/lacquer/services/edit-policy-button.client";
import { canWriteCatalog, type StudioRole } from "@/app/(studio)/services/permissions";
import type { SupplyTypesCatalog } from "@/app/(studio)/settings/policy/_load";

export type EditPolicyButtonProps = {
  /** Operator's role — drives the disabled affordance. */
  role: StudioRole;
  /** Supply-types catalog from `loadSupplyTypesCatalog()` — passed through to the sheet. */
  catalog: SupplyTypesCatalog;
};

export function EditPolicyButton({ role, catalog }: EditPolicyButtonProps) {
  const canWrite = canWriteCatalog(role);
  return <EditPolicyButtonClient disabled={!canWrite} catalog={catalog} />;
}
