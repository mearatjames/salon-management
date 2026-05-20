# Phase 1 Data Model — Select staff redesign

**No schema change.** This feature introduces no tables, columns, migrations, or RLS
changes. It re-displays and filters existing `staff` records and continues to write the
existing `audit_log` rows. The section below documents the **view shape** that flows
from the RSC page to the client screen — it is a projection of existing columns, not
new persistence.

---

## Entity: Staff roster entry (read-only projection)

The roster is read by `app/(device)/select-staff/page.tsx` (RSC) from the `staff` table
and passed as a prop array to `select-staff-screen.client.tsx`.

| Field | Source column | Type | Notes |
|-------|---------------|------|-------|
| `id` | `staff.id` | `string` (uuid) | Tile identity; sent to `submitPin` as `staffId`. |
| `display_name` | `staff.display_name` | `string` | Shown on the tile and in the modal; the search target (FR-008). |
| `role` | `staff.role` | `string` | One of `owner` \| `manager` \| `technician` \| `front_desk`. Drives the role label and the sort order (FR-004). |
| `color_token` | `staff.color_token` | `string` | A `--avatar-*` CSS variable name; drives the initials-avatar tint (FR-002, FR-026). |
| `pin_reset_admin_at` | `staff.pin_reset_admin_at` | `string \| null` | When non-null, the tile shows the admin-PIN-reset notice (FR-021). |

### Query (unchanged from today)

```sql
select id, display_name, role, color_token, pin_reset_admin_at
from staff
where active = true
  and pin_hash is not null      -- FR-005: only staff with a PIN set
order by role, display_name;
```

RLS allows authenticated reads of `staff`; the device's Supabase Auth session satisfies
it. `pin_hash` itself is **never** projected into the roster prop — it is read only
inside the `submitPin` Server Action.

### Eligibility (FR-005)

A staff record appears on the roster **iff** `active = true` AND `pin_hash IS NOT NULL`.
Inactive staff and staff without a PIN are excluded.

### Ordering (FR-004)

Role priority `owner (0) → manager (1) → technician (2) → front_desk (3)`, then
`display_name` ascending within each role. Applied client-side after the search filter
so filtered results keep the same order.

### Derived / presentation values (not persisted)

| Value | Derivation |
|-------|------------|
| Initials avatar | First + last initial of `display_name` (single-word name → first two letters), upper-cased. |
| Role label | `owner→Owner`, `manager→Manager`, `technician→Tech`, `front_desk→Front desk`. |
| Search match | `display_name.toLowerCase().includes(query.trim().toLowerCase())` — partial, case-insensitive (FR-008). |

---

## Transient client state (not persisted, not in the URL)

Owned by `select-staff-screen.client.tsx` / `pin-entry-modal.client.tsx`:

| State | Type | Lifecycle |
|-------|------|-----------|
| `query` | `string` | Search box value. Reset → full roster reappears (FR/US2-4). |
| `selectedStaffId` | `string \| null` | `null` = grid only; non-null = modal open for that staff. Set on tile tap, cleared on dismiss/success. |
| PIN buffer | `string` (≤4 digits) | Inside the keypad; never rendered as digits — only the 4-dot indicator (FR-012). Cleared on dismiss, on a new tile selection (FR-019), and after a failed attempt (FR-017). |
| `attemptError` | `boolean` / counter | Drives the indicator error state and a deterministic keypad buffer reset between attempts. |

A page refresh discards all of the above → the modal closes and the grid is shown
(spec edge case "page refresh during entry"). This **replaces** the prior
`?selectedTileId=` URL parameter.

---

## Audit records written (unchanged — FR-020, SC-007)

`submitPin` continues to write exactly one `audit_log` row per **completed** 4-digit
attempt, via `recordAuth`:

| Outcome | `action` | `payload` |
|---------|----------|-----------|
| Correct PIN | `staff.signed_in` | `{ previous_staff_id }` when an operator cookie was already present, else `{}`. |
| Wrong PIN | `staff.pin_failed` | `{ reason: "mismatch" }` |
| Inactive / no `pin_hash` target | `staff.pin_failed` | `{ reason: "invalid_target" }` |

Dismissing the modal after 1–3 digits writes **nothing** — only a completed 4-digit
submission reaches `submitPin` (spec edge case "dismiss mid-entry").
