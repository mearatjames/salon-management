# Role Permissions Contract — FR-080

Single source of truth for the per-role `label`, `summary`, `grants[]`,
and `blocks[]` strings that surface in three places:

1. The Thorough wizard's Permissions card (step 4 Review).
2. The Staff tab's role-tile picker hints in the Add Staff wizard (read-only display).
3. Any future role-comparison view (e.g. a future "Roles" page in Settings).

## Module

`lib/auth/role-permissions.ts` — pure TypeScript, no I/O, no React.
Importable from both server and client components.

```ts
import type { StudioRole } from "@/lib/auth/session";

export type RolePermissionDef = {
  /** Display label shown in the wizard, table chips, etc. */
  readonly label: string;
  /** One-line summary shown under the label. */
  readonly summary: string;
  /** Capabilities granted to this role. */
  readonly grants: readonly string[];
  /** Capabilities explicitly NOT granted to this role. */
  readonly blocks: readonly string[];
};

export const ROLE_PERMISSIONS: Readonly<Record<StudioRole, RolePermissionDef>> = {
  owner: {
    label: "Owner",
    summary:
      "Full access. Can manage staff, billing, settings, and offboard anyone except themselves.",
    grants: [
      "Calendar, Clients, Checkout, Walk-in",
      "Services & pricing",
      "End of Day & Day Report",
      "Refunds & voids (no manager approval needed)",
      "Settings (Staff, Billing, Onboarding)",
    ],
    blocks: [],
  },
  manager: {
    label: "Manager",
    summary:
      "Day-to-day operations. Can approve refunds/voids inline. Cannot manage billing or onboard new users.",
    grants: [
      "Calendar, Clients, Checkout, Walk-in",
      "Services & pricing",
      "End of Day & Day Report",
      "Refunds & voids (authorizing manager)",
      "Settings → Staff (edit-only)",
    ],
    blocks: ["Billing & subscription", "Onboarding new users"],
  },
  technician: {
    label: "Tech",
    summary:
      "Performs services, takes payments. Most won't have email login — PIN only on shared iPad.",
    grants: [
      "Calendar (own column)",
      "Clients (read + notes)",
      "Checkout (their tickets)",
      "Walk-in (seat next)",
    ],
    blocks: [
      "Refunds & voids",
      "Services & pricing edits",
      "Any Settings tab",
    ],
  },
  front_desk: {
    label: "Front desk",
    summary:
      "Books appointments, runs the kiosk, takes payments. No edit access to services or staff.",
    grants: [
      "Calendar (all techs)",
      "Clients",
      "Checkout (all tickets)",
      "Walk-in & kiosk pairing",
    ],
    blocks: [
      "Refunds & voids (manager required)",
      "Services & pricing",
      "Any Settings tab",
    ],
  },
};

export function getRolePermissions(role: StudioRole): RolePermissionDef {
  return ROLE_PERMISSIONS[role];
}
```

## Source

Strings are lifted verbatim from `design-system/prototypes/onboarding/data.jsx` (the prototype's `ROLE_PERMISSIONS` constant). Future copy edits flow from the prototype's source; do not edit the strings in code without re-syncing the prototype.

## Consumers

| Consumer | Path | Reads |
|---|---|---|
| `PermissionCard` | `components/lacquer/onboarding/permission-card.tsx` | All four fields. Renders the Thorough wizard step 4 card. |
| `RoleTilePicker` | `components/lacquer/onboarding/role-tile-picker.tsx` | `label` + `summary`. Renders the 4-tile picker in the Onboard sheet's Identity step. |
| `staff/edit-panel.client.tsx` (future enhancement) | `components/lacquer/staff/` | Optional: surface a role hint on the role select. Out of scope for this feature but the module is shared so a follow-up doesn't need a refactor. |

## Test coverage

`tests/unit/auth/role-permissions.test.ts`:

1. **Shape stability** — exact-snapshot test of the entire `ROLE_PERMISSIONS` object. Catches accidental drift between the module and the prototype. Updating this test is the gate that confirms a copy change was intentional.
2. **Coverage** — every `StudioRole` value is a key in `ROLE_PERMISSIONS`. Catches drift if `StudioRole` grows a new value without updating the map.
3. **No empty arrays** — every role's `grants` array has length ≥ 1 (owner has empty `blocks`, which is expected — explicitly asserted).
4. **No HTML / markup** — every string in `grants` and `blocks` is plain text (no `<`, `>`, `&`). Defensive against accidental copy-paste of JSX.

## Constraints

- This module is the **only** source of role-permission copy in the app. Other components MUST import from it; they MUST NOT duplicate the strings.
- The schema (label, summary, grants, blocks) is fixed for v1. Adding fields (e.g. `examples`, `permissions_url`) requires a constitution-aligned scope change (Principle V).
- Strings are static — no template interpolation, no i18n keys, no per-tenant overrides. Single salon, single language.
