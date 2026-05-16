# UI contract — 006-staff-management

This is the source of truth for which prototype section maps to which
file in the repo. Side-by-side comparisons against the canonical preview
HTML (`design-system/preview/*.html`) and the prototype JSX
(`design-system/prototypes/user-management/*.jsx`) are the acceptance
bar for Constitution Principle I.

## Page → file map

| Page region                  | Prototype source                          | New repo file                                                       |
|------------------------------|-------------------------------------------|---------------------------------------------------------------------|
| Settings shell + tab bar     | `StaffManagement.jsx:501-540`             | `app/(studio)/settings/layout.tsx` + `components/lacquer/settings/tab-bar.tsx` |
| Settings → General/Notif/Billing placeholders | `StaffManagement.jsx:511-516`  | `app/(studio)/settings/general/page.tsx`, `/notifications/page.tsx`, `/billing/page.tsx` |
| "Staff" page header (count, toggle, Add button) | `StaffManagement.jsx:522-540` | `components/lacquer/staff/page-header.tsx`                          |
| Search input                 | `StaffManagement.jsx:543-558`             | inside `components/lacquer/staff/staff-table.client.tsx`            |
| Staff table                  | `StaffManagement.jsx:561-602`             | `components/lacquer/staff/staff-table.client.tsx`                   |
| Empty-state ("Select a staff member") | `StaffManagement.jsx:608-613`    | `components/lacquer/staff/empty-state.tsx`                          |
| Edit panel                   | `StaffManagement.jsx:297-432`             | `components/lacquer/staff/edit-panel.client.tsx`                    |
| Color picker (8 swatches)    | `StaffManagement.jsx:27-42`               | `components/lacquer/staff/color-picker.tsx`                          |
| Add staff sheet              | `StaffManagement.jsx:47-294`              | `components/lacquer/staff/add-staff-wizard.client.tsx`              |
| Step bar (3 dots)            | `StaffManagement.jsx:120-138`             | inside `add-staff-wizard.client.tsx`                                |
| PIN modal                    | `PinModal.jsx:43-147`                     | `components/lacquer/staff/change-pin-modal.client.tsx`              |
| Confirm dialog (deactivate)  | `PinModal.jsx:149-180`                    | `components/lacquer/staff/confirm-dialog.tsx`                       |
| Confirm dialog (remove)      | `PinModal.jsx:149-180` (variant)          | same as above (variant prop)                                        |
| Numeric keypad (shared)      | `PinModal.jsx:8-41`                       | `components/lacquer/numeric-keypad.client.tsx` (R7) — 2 consumers   |
| Avatar (initials)            | `Components.jsx:56-62`                    | `components/lacquer/staff/staff-avatar.tsx`                          |
| Badge (role / status)        | `user-management.css` rules               | `components/lacquer/badge.tsx`                                       |
| Toggle (switch)              | `Components.jsx:71-78` (custom)           | shadcn `components/ui/switch.tsx` (R12)                              |

The pre-clarification map included a manager-PIN override dialog
(`override-dialog.client.tsx`) and an `override-copy.ts` constants file.
**Both are removed.** The override is gone per Clarifications Q1.

## Component classification

**Server Components** (no `"use client"`):

- `app/(studio)/settings/layout.tsx`, `/staff/page.tsx`, the 3
  placeholder pages
- `tab-bar.tsx`, `page-header.tsx`, `empty-state.tsx`, `color-picker.tsx`
  (no interaction; the swatches are radio inputs inside a form)
- `staff-avatar.tsx`, `badge.tsx`, `confirm-dialog.tsx` (uses shadcn
  `Dialog` which has a client wrapper internally, but our wrapper has
  no state — just renders strings)

**Client Components** (`"use client"`):

- `staff-table.client.tsx` (owns search + show-inactive state)
- `edit-panel.client.tsx` (owns draft state; reads
  `computeTargetPermissions` from `permissions.ts` to disable controls)
- `add-staff-wizard.client.tsx` (owns step + draft + PIN state)
- `change-pin-modal.client.tsx` (owns step + PIN buffers)
- `numeric-keypad.client.tsx` (owns digit buffer)
- `staff-toaster.client.tsx` (reads `?toast=` once, dispatches Sonner)

## Permission-driven disabled state

The edit panel reads `computeTargetPermissions(ctx)` once per render
(from the page Server Component, passed as a prop) and uses it to set
`disabled` on every control:

| Control               | Disabled when                                                                                  |
|-----------------------|------------------------------------------------------------------------------------------------|
| Display name input    | `!canEditDisplayName` (only manager × owner triggers this)                                     |
| Role select           | `!canEditRole` (self / last-owner / manager × owner)                                            |
| Role select options   | `roleOptionsFor(operator.role)` — manager-operators don't see "Owner"                          |
| Color picker          | `!canEditColor` (only manager × owner)                                                          |
| Active toggle         | `!canToggleActive` (self / last-owner / manager × owner)                                        |
| "Set PIN"/"Change"    | `!canSetPin` (only manager × owner)                                                             |
| "Deactivate" link     | `!canDeactivate` (target inactive / self / last-owner / manager × owner)                        |
| "Reactivate" link     | `!canReactivate` (target active / manager × owner)                                              |
| "Remove" link         | `!canRemove` (self / last-owner / manager × owner)                                              |

Each disabled control carries a `title` tooltip explaining why:

- Self constraint: "You can't change your own role or active state." or
  "You can't deactivate or remove yourself."
- Last-owner: "At least one owner must remain."
- Manager × owner: "Only owners can edit owner accounts."

## Toast strings

Exported from `app/(studio)/settings/staff/toasts.ts`:

```ts
export const TOAST = {
  staffAdded: (name: string) => `${name} added to the roster`,
  changesSaved: () => "Changes saved",
  pinUpdated: () => "PIN updated",
  staffDeactivated: (name: string) => `${name} deactivated`,
  staffRemoved: (name: string) => `${name} removed`,
  // Error variants
  forbiddenTarget: () => "Only owners can edit owner accounts.",
  lastOwner: () => "At least one owner must remain.",
  selfEditBlocked: () => "You can't change your own role, deactivate, or remove yourself.",
  notFound: () => "That staff member was removed by another tab.",
  forbidden: () => "Staff settings is restricted to owners and managers.",
};
```

Tests import these constants by name (no string duplication).

## Dialog strings

| Dialog              | Title                       | Body                                                                                                          | CTA           |
|---------------------|-----------------------------|---------------------------------------------------------------------------------------------------------------|---------------|
| Deactivate          | "Deactivate {name}?"        | "{name} won't be able to log in until you reactivate them. Their appointments and history are unaffected."     | "Deactivate"  |
| Remove              | "Remove {name}?"            | "{name} will be removed from the staff roster and won't appear on the login screen. Their appointment history stays on record." | "Remove"      |

The four override-dialog variants from the pre-clarification plan are
**removed**.

The deactivate dialog does NOT show an upcoming-appointment count
(deferred to the appointments feature per Clarifications Q2).

## Empty-states / inline strings

| Surface                          | Copy                                            |
|----------------------------------|-------------------------------------------------|
| Search returns no rows           | "No staff match your search."                   |
| Page first load (no selection)   | "Select a staff member" (heading) + "Choose someone from the roster to edit their details, change their role, or update their PIN." (body) |
| Add wizard step 3 (with PIN set) | "{name} can now log in with their 4-digit PIN." |
| Add wizard step 3 (no PIN)       | "{name} has been added. Set a PIN before they can log in." |
| PIN row (set state)              | "4-digit PIN set"                                |
| PIN row (unset state)            | "No PIN set" + "Required to log in"             |
| Inline "last-owner" tooltip      | "At least one owner must remain."                |
| Inline "self-edit" tooltip       | "You can't change your own role or active state." |
| Inline "manager × owner" tooltip | "Only owners can edit owner accounts."           |

## Token discipline

Per Principle I, every visual value on every file listed above must
trace to a token. This is enforced by `speckit-design-auditor` (run
against this feature before merge — see plan.md § Quality gates).
Notable mappings:

| Visual                          | Token                                        |
|---------------------------------|----------------------------------------------|
| Page background                 | `var(--background)`                          |
| Card surface                    | `var(--card)`                                |
| Border                          | `var(--border)`                              |
| Primary action                  | `var(--primary)` / `var(--primary-foreground)`|
| Destructive action              | `var(--destructive)` / `var(--destructive-foreground)` |
| Avatar background               | `oklch(from var(--avatar-<color>) l c h / 0.15)` |
| Avatar text                     | `var(--avatar-<color>)`                       |
| "Active" badge bg               | `oklch(from var(--success) l c h / 0.15)`     |
| "Inactive" badge bg             | `oklch(from var(--muted-foreground) l c h / 0.15)` |
| Card radius                     | `var(--radius-lg)` (12px)                    |
| Sheet radius                    | `var(--radius-xl)` (16px) on top corners only |
| Dialog radius                   | `var(--radius-xl)` (16px)                    |
| Button radius                   | `var(--radius-sm)` (6px)                     |
| Input radius                    | `var(--radius-xs)` (4px)                     |
| Pill radius                     | `var(--radius-full)`                         |
| Hover/press transitions         | 150 ms `var(--ease-out)`                     |
| Sheet/dialog enter              | 300 ms `var(--ease-out)`                     |
| Tabular numerals                | `.tnum` class (already in tokens.css)         |

## Icons

Lucide only, 1.5 px stroke, sized 16 / 20 / 24:

| Surface                       | Icon                | Size |
|-------------------------------|---------------------|------|
| PIN set state in row & panel  | `ShieldCheck`       | 16   |
| PIN unset state               | `KeyRound`          | 16   |
| Add staff CTA                 | `Plus`              | 16   |
| Search input                  | `Search`            | 16   |
| Active state pill             | `Check`             | 12 (inline) |
| Inactive state pill           | `EyeOff`            | 12 (inline) |
| Toast: success                | `CheckCircle2`      | 16   |
| Toast: destructive            | `AlertCircle`       | 16   |
| Deactivate dialog             | `PowerOff`          | 20   |
| Remove dialog                 | `Trash2`            | 20   |
| Keypad backspace              | `Delete`            | 16   |

No emoji anywhere on these surfaces.
