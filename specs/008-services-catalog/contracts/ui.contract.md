# Contract: UI composition and drawer state machine

The Services page lives at `/settings/services`. It is a Server Component that composes:

```
┌──────────────────────────────────────────────────────────────┐
│  <TabBar /> (existing — edited to include "Services")        │
├──────────────────────────────────────────────────────────────┤
│  <PageHeader />  (server: title + "X active · Y total" line) │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ <CatalogList ...>  (client island)                     │  │
│  │   - search input + Show-archived toggle                │  │
│  │   - grouped list (category headers, alpha within)      │  │
│  │     each row composes <CatalogRow> (server)            │  │
│  │   - empty state (zero services) or no-match state      │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  Drawer overlay (off-canvas right; only when ?selected= or   │
│  ?adding=1; mounted by <Drawer>):                            │
│  ┌─────────────────────────────────────────────┐             │
│  │ <Drawer>  (client island)                   │             │
│  │   - title: "Add service" | "Edit service"   │             │
│  │   - live preview (color + name + cat + …)   │             │
│  │   - <ServiceForm> (client)                  │             │
│  │   - <StaffAssignmentList> (client)          │             │
│  │   - bottom action: "Archive" / "Restore"    │             │
│  │     opens <ArchiveDialog> (client)          │             │
│  │   - footer: Cancel + Save                   │             │
│  │   - <DiscardChangesDialog> (client) on dirty close │      │
│  └─────────────────────────────────────────────┘             │
│                                                              │
│  <ServicesToaster /> (client, Suspense-wrapped)              │
└──────────────────────────────────────────────────────────────┘
```

All visual values resolve to tokens in `styles/tokens.css`. New layout rules live in `styles/settings.css`.

---

## 1. URL shape

| Param | Values | Effect |
|---|---|---|
| `selected` | UUID | Opens the drawer in Edit mode for that service. Preserved on every action's failure redirect. |
| `adding` | `"1"` | Opens the drawer in Add mode (empty form). Cleared after a successful Save (the redirect replaces it with `?selected=<newId>`). |
| `toast` | toast key (see § 4) | Fires the matching Sonner toast then is stripped via `router.replace`. |
| `secondary` | toast key | Fires alongside `toast` (only used for `no_techs_assigned`). |
| `name` | URL-encoded string | Interpolated into the toast when present. |
| `error` | error code (see `server-actions.contract.md § 6`) | Renders a destructive Sonner toast with the human label. |

`selected` + `adding` are mutually exclusive at the UI level; if both are present, `selected` wins.

---

## 2. Drawer state machine

States: `closed`, `add-clean`, `add-dirty`, `edit-clean`, `edit-dirty`. Overlays: `confirm-discard`, `confirm-archive`.

| From | Event | To |
|---|---|---|
| `closed` | Click "Add service" (URL gains `?adding=1`) | `add-clean` |
| `closed` | Click row (URL gains `?selected=<id>`) | `edit-clean` |
| `add-clean` / `add-dirty` | Successful Save | `edit-clean` (URL flips to `?selected=<new id>`, same drawer re-mounts in Edit) |
| `edit-clean` / `edit-dirty` | Successful Save | `edit-clean` (baseline updated; same `?selected=`) |
| `*-clean` | Backdrop / Escape / Cancel | `closed` (URL drops `?adding=`/`?selected=`) |
| `*-dirty` | Backdrop / Escape / Cancel | `confirm-discard` overlay |
| `confirm-discard` | "Discard" | `closed` |
| `confirm-discard` | "Cancel" | `*-dirty` (restored) |
| `edit-clean` (active service) | Click "Archive service" | `confirm-archive` overlay |
| `confirm-archive` | "Archive" | Server action → on success → `edit-clean` (button flips to "Restore service") |
| `confirm-archive` | "Cancel" / backdrop | `edit-clean` |
| `edit-clean` (archived service) | Click "Restore service" | (no dialog) Server action → on success → `edit-clean` (button flips to "Archive service") |

The form transitions from `*-clean` to `*-dirty` whenever any field, the staff-assignment list, or any per-tech override differs from the baseline. The "Save" button is disabled in `*-clean` states.

---

## 3. Catalog list behavior

- **Sort**: `category` ascending (alpha), then `name` ascending within each category. Identical to the SQL `order by` (so RSC stream and full hydrate produce the same order — see `data-model.md § 6` invariant 7).
- **Search**: case-insensitive substring match on `name`. Empty groups are hidden when search yields no rows for them.
- **Show archived**: toggles whether rows where `active = false` appear in the list. State persisted to `sessionStorage` for the operator's tab.
- **Row composition** (in order, left-to-right): a `<ColorSwatch>` rendered from `color_token`, the `name`, a duration pill (e.g. `45 min`), a price pill (`$45` / `From $20` / `$20 – $60` / `Variable`), and a tech-count pill (`{N} techs` or `No techs` in warning tone with an amber dot).
- **Archived row**: reduced opacity + an `Archived` badge.
- **Empty list**: Sparkles icon + "Add your first service to start booking appointments." + primary "Add service" CTA.
- **No-match list**: "No services match your search."

---

## 4. Toast vocabulary

Read by `<ServicesToaster />`. Each entry is `(url_key → text + variant)`.

| URL key | Variant | Text |
|---|---|---|
| `service_added` | success | `{name} added to the catalog` |
| `changes_saved` | success | `Changes saved` |
| `service_archived` | success | `{name} archived` |
| `service_restored` | success | `{name} restored` |
| `no_techs_assigned` | warning (secondary; may stack with success) | `Nobody can perform this service yet. Add techs from the edit drawer.` |
| `forbidden` (error param) | destructive | `Only owners and managers can edit the catalog.` |
| `name_too_short` (error param) | destructive | `Enter at least 2 characters for the service name.` |
| `category_required` (error param) | destructive | `Pick or type a category.` |
| `invalid_duration` (error param) | destructive | `Duration must be a positive number of minutes.` |
| `invalid_price` (error param) | destructive | `Price must be a positive amount.` |
| `invalid_bound` (error param) | destructive | `Variable price bounds must be positive amounts.` |
| `bounds_inverted` (error param) | destructive | `"From" price can't be higher than "To" price.` |
| `invalid_color` (error param) | destructive | `Pick one of the eight Lacquer colors.` |
| `invalid_override` (error param) | destructive | `Per-tech duration overrides must be a positive number of minutes.` |
| `not_found` (error param) | destructive | `That service no longer exists.` |
| `no_changes` (error param) | informational | `Nothing to save.` |
| `db_failure` (error param) | destructive | `Something went wrong. Please try again.` |

Sonner is the existing toast library (used by `StaffToaster`); this feature reuses it with no config changes.

---

## 5. Read-only mode (technician / front-desk operators)

When `viewer.staff.role` is not in `{owner, manager}`:

- The "Add service" button is rendered disabled with a tooltip "Only owners and managers can edit the catalog."
- The drawer still opens on row click (so the operator can view details) but every form input, color swatch, toggle, staff-assignment checkbox, per-tech override field, and bottom action (Archive / Restore) is disabled.
- The footer's "Save changes" / "Save service" button is replaced with a single neutral chip reading "View only".
- The "Discard changes?" dialog is unreachable (every input is disabled so no dirty state is possible).
- The Server Action prelude is the trust boundary: a direct FormData POST is rejected by `assertCanWriteCatalog` and surfaces as `?error=forbidden`.

---

## 6. Accessibility

- Drawer is a `<dialog>` (or shadcn `<Sheet>`) with role `dialog`, `aria-label="Edit service"` / `"Add service"`, focus trapped while open, Escape closes (subject to dirty-state gate).
- Catalog rows are `<button>` elements (not `<div onClick>`) — keyboard-reachable, native focus ring.
- Color swatches are radio buttons with visible labels for screen readers.
- The variable-price toggle is a labeled `<input type="checkbox">` (or shadcn `<Switch>`) with `aria-describedby` pointing at the help text.
- Toasts include the action that succeeded ("Gel polish added to the catalog") instead of a generic word so screen readers announce something meaningful.

---

## 7. Animation (per Lacquer motion language)

- Drawer slide-in: 300ms cubic-bezier(0.16, 1, 0.3, 1) (`var(--ease-out-expo, ease-out)`).
- Dialog (archive / discard): 200ms ease-out.
- Hover / press on rows and buttons: 150ms ease-out.
- No bounce, no spring, no scale. Toggles do not animate.
