# Routes contract — 006-staff-management

## URLs

| URL                                | Renders                                                                        |
|------------------------------------|--------------------------------------------------------------------------------|
| `/settings`                        | Permanent redirect → `/settings/staff` (until other tabs ship)                 |
| `/settings/staff`                  | The Settings shell + Staff tab content                                         |
| `/settings/staff?selected=<id>`    | …with the edit panel populated for staff `id`                                  |
| `/settings/general`                | The Settings shell + a "Not part of this prototype" placeholder                |
| `/settings/notifications`          | Same — placeholder                                                              |
| `/settings/billing`                | Same — placeholder                                                              |

Selection state is URL-driven via `?selected=`. Toggling a tile-style row
either sets `?selected=<id>` or removes the param entirely. This makes the
edit panel state shareable + reload-safe.

## Auth gate

Both `app/(studio)/settings/layout.tsx` and `app/(studio)/settings/staff/
page.tsx` run on the server. The layout:

1. Calls `requireStudioSession()` (throws `AuthRedirectError` → middleware
   handles `/login` or `/select-staff` redirect; existing behavior).
2. Checks `viewer.staff.role`. If not in `("owner","manager")`, calls
   `redirect("/dashboard")`. No staff data is fetched before this branch.
3. Renders the Settings tab bar + `{children}`.

Technicians and front-desk staff who hit any `/settings/*` URL are
redirected to `/dashboard` with no flash. The `/settings/staff` page
itself re-resolves `viewer` (RSCs always re-resolve) so the panel
permissions can be computed against the operator role.

**No PIN re-prompt is shown for any mutation** — the role gate is the
sole authorization check (Clarifications Q1, FR-037).

## Query-param vocabulary

The page reads three query params on top of `?selected=`. They're
consumed once and removed via `router.replace` (client) for a clean URL.

### `?toast=<key>`

Triggers a single Sonner toast on mount. Keys:

| Key                | String emitted                              |
|--------------------|----------------------------------------------|
| `staff_added`      | `"{name} added to the roster"`              |
| `changes_saved`    | `"Changes saved"`                            |
| `pin_updated`      | `"PIN updated"`                              |
| `staff_deactivated`| `"{name} deactivated"`                      |
| `staff_reactivated`| `"Changes saved"` (no separate string)      |
| `staff_removed`    | `"{name} removed"`                          |

The `{name}` interpolation requires a `?name=` companion param
(URL-encoded display name). When a redirect sets `?toast=`, it also sets
`?name=` where the toast template needs it. Both params are stripped in
the same `router.replace`.

### `?error=<code>`

Surfaces an inline error message or a page-level toast (per-code; see
server-actions.contract.md § Error codes). Codes:

| Code                    | Meaning                                                          | Surface                                  |
|-------------------------|------------------------------------------------------------------|------------------------------------------|
| `name_too_short`        | display_name failed length check                                 | Inline error under the name input        |
| `invalid_role`          | role not in operator's allowed set                                | Inline error under the role select       |
| `invalid_color`         | color_token not in palette                                       | Inline error near the color picker       |
| `invalid_pin_shape`     | PIN not exactly 4 digits                                          | PIN modal returns to Enter step          |
| `pin_mismatch`          | confirm step didn't match enter step                              | PIN modal returns to Enter step          |
| `forbidden_target`      | Permission matrix rejected the mutation (manager × owner, or unauthorized role gate) | Page-level toast, destructive variant |
| `last_owner`            | Action would leave 0 active owners                                | Page-level toast, destructive variant    |
| `self_edit_blocked`     | Operator tried to demote / deactivate / remove themselves         | Page-level toast, destructive variant    |
| `not_found`             | target staff id resolved to no row                                | Page-level toast, destructive variant    |
| `forbidden`             | Operator role failed the route gate at action time (defense in depth) | Dashboard-level toast on redirect    |

The pre-clarification codes `override_required` and `override_failed` are
**gone** — there is no override flow.

### `?selected=<uuid>`

The selected staff row. Persisted across page renders; cleared by the
page's "click selected row to deselect" client interaction.

## Search params semantics

Search and "Show inactive" toggle state are **client-only** (R8) — not in
the URL. Persist:

- Search input: not persisted; resets on every page load.
- "Show inactive" toggle: `sessionStorage["tn:settings:staff:show-inactive"]`.

## Method semantics

All mutations are POST (Server Actions). The page itself is a GET-only
RSC. There are no API route handlers in this feature — every write goes
through a Server Action.
