# Phase 1 — Data Model: Past Cash Counts

## Existing table: `public.cash_drawer_sessions` — extension

Add one column. No constraint changes — the existing
`cash_drawer_close_consistency_chk` and
`cash_drawer_notes_required_when_variance_chk` checks continue to hold
after every edit because the edit RPC recomputes `variance_cents` and
trims `notes` server-side.

```sql
alter table public.cash_drawer_sessions
  add column if not exists updated_at timestamptz;

-- No default and no trigger: `updated_at` is set explicitly by the edit
-- RPC. A NULL value means "never edited since close." This is the
-- on-row source for the "Last edited at" line in the detail panel
-- (FR-009). The "was it edited?" boolean still comes from audit_log
-- per FR-009; `updated_at` only powers the timestamp display.
```

No new indexes. The existing `cash_drawer_sessions_business_day_idx (business_day desc)` already covers the list query.

### Field semantics (additions and clarifications)

| Field | Meaning |
|------|---------|
| `updated_at` | NULL until first edit. Set to `now()` by `pos_edit_cash_drawer` on every successful edit (including no-op edits per research R5). Powers the "Last edited at [time]" line in the detail panel. |

### State machine — unchanged

```
   (no row)
       │
       │  pos_close_cash_drawer (lazy open)
       ▼
   ┌────────┐                                  ┌────────┐
   │  open  │── pos_close_cash_drawer ────────▶│ closed │◀─┐
   └────────┘                                  └────────┘  │
                                                    │      │
                                                    │      │  pos_edit_cash_drawer
                                                    └──────┘  (self-loop; no state change)
```

Edits are a self-loop on the `closed` state — the session never leaves `closed`. No "reopen" transition exists in v1.

---

## New RPC: `public.pos_edit_cash_drawer`

```sql
public.pos_edit_cash_drawer(
  p_session_id     uuid,   -- the closed session to edit
  p_counted_cents  int,    -- new counted amount (>= 0)
  p_notes          text,   -- new notes (may be empty if new variance is 0)
  p_operator       uuid,   -- staff.id of the editor
  p_device_user_id uuid    -- auth.uid() of the device user
) returns uuid              -- returns the session id (echo)
```

Returns the edited session's `id`. Atomic: lock the row, validate it is closed, recompute the new variance, enforce the notes rule, update the row, write the audit. All in one transaction.

`security definer; set search_path = public, pg_temp; revoke all from public; grant execute to service_role`. Mirrors the existing `pos_close_cash_drawer`.

### Steps

1. **Lock the row.** `SELECT … FROM cash_drawer_sessions WHERE id = p_session_id FOR UPDATE`. If no row, raise `cash_drawer_session_missing`. If `closed_at IS NULL`, raise `cash_drawer_session_not_closed` (you can't edit a count that was never taken; the close screen is for that).
2. **Capture before-values.** Stash the current `counted_cents`, `variance_cents`, and `notes` for the audit payload.
3. **Compute new variance.** `v_new_variance := p_counted_cents - (opening_cents + expected_cents)` using the row's frozen `opening_cents` and `expected_cents` (immutable per FR-007).
4. **Trim notes.** `v_trimmed := nullif(btrim(p_notes), '')`.
5. **Enforce notes rule.** If `v_new_variance != 0 AND v_trimmed IS NULL`, raise `cash_drawer_note_required`.
6. **Write the update.** `UPDATE … SET counted_cents = p_counted_cents, variance_cents = v_new_variance, notes = v_trimmed, updated_at = now() WHERE id = p_session_id`.
7. **Write the audit.** `INSERT INTO audit_log (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload) VALUES ('cash_drawer.edited', p_device_user_id, p_operator, 'cash_drawer', p_session_id, jsonb_build_object('before', jsonb_build_object('counted_cents', v_before_counted, 'variance_cents', v_before_variance, 'notes', v_before_notes), 'after', jsonb_build_object('counted_cents', p_counted_cents, 'variance_cents', v_new_variance, 'notes', v_trimmed), 'session_id', p_session_id))`.

### Error codes

| Code | When | UI mapping |
|------|------|------------|
| `cash_drawer_session_missing` | No row for `p_session_id`. | Redirect to history list with a transient "Session not found" toast. Probably an old URL. |
| `cash_drawer_session_not_closed` | The row exists but is still open. | Redirect to `/end-of-day` to use the close screen instead. (Should not happen via the UI — the history list only links to closed rows.) |
| `cash_drawer_note_required` | `variance != 0 AND notes is empty`. | Same UX as the close screen's `NOTE_REQUIRED` — inline error, keep form state. |
| (other) | Unexpected. | Generic "Could not save changes" toast; log via `console.error`. |

---

## Existing tables read by this feature

| Table | Columns read | Why |
|-------|-------------|------|
| `cash_drawer_sessions` | all (id, opened_at, opened_by_staff_id, opening_cents, closed_at, closed_by_staff_id, expected_cents, counted_cents, variance_cents, notes, business_day, created_at, updated_at) | Source rows for the history list (`closed_at is not null` filter) and the detail page (single id lookup). |
| `staff` | `id, display_name, color_token` | Resolve `closed_by_staff_id` → display name on every list row and detail. Resolve `acting_as_staff_id` from each `audit_log` edit row → editor display name for the "Edited" badge and change-history accordion. |
| `audit_log` | `id, action, acting_as_staff_id, created_at, payload` | Source for the "Edited" pill on each list row (existence check) and the change-history accordion on the detail page (full payload, ordered newest to oldest). Filter: `action = 'cash_drawer.edited' AND entity_id = <session_id>`. |
| `settings` | `salon.timezone` row | Salon timezone for date / time display formatters. Read via existing `getSalonTimezone()`. |

No new writes other than the edit RPC's `UPDATE` + `INSERT INTO audit_log` pair.

---

## Audit vocabulary additions

In `lib/auth/audit.ts`:

```ts
export type AuditAction =
  // … existing …
  // Added by feature 020 (entity_type "cash_drawer")
  | "cash_drawer.edited";
```

`deriveEntityType` does not need a new branch — the existing `cash_drawer.*` prefix rule (added by feature 019) already routes `cash_drawer.edited` to `"cash_drawer"`.

---

## Migration plan

One new migration: `supabase/migrations/0015_cash_drawer_edits.sql`.

Sections, in order:

1. `ALTER TABLE … ADD COLUMN updated_at` (no default, no trigger).
2. Create `public.pos_edit_cash_drawer` function body (per RPC contract).
3. `REVOKE ALL FROM public` + `GRANT EXECUTE TO service_role` on the new function.

No backfill needed — `updated_at IS NULL` for every existing row, which correctly means "never edited since close."

---

## Validation rules surfaced from spec

| FR | Where enforced |
|----|----------------|
| FR-001 (owner/manager only, redirect technicians) | `app/(studio)/end-of-day/history/page.tsx` + `app/(studio)/end-of-day/history/[sessionId]/page.tsx` + Server Action |
| FR-002 (list shape, ordering, color tokens) | `lib/end-of-day/history.ts` query + `components/lacquer/eod/history/history-row.tsx` rendering |
| FR-003 (90-day default, "Show earlier" pagination) | `lib/end-of-day/history.ts` `loadCashHistoryList(opts)` `{limit, offset}` |
| FR-004 ("View past counts" link in `/end-of-day` header) | Edit `app/(studio)/end-of-day/page.tsx` header chrome |
| FR-005 (detail panel content) | `components/lacquer/eod/history/detail-view.tsx` (server component) |
| FR-006 (edit form: prefilled numpad + notes) | `components/lacquer/eod/history/edit-form.client.tsx` |
| FR-007 (server-side recompute, immutable fields) | `pos_edit_cash_drawer` RPC (only `counted_cents`, `variance_cents`, `notes`, `updated_at` change) |
| FR-008 (audit row with before/after payload, same transaction) | `pos_edit_cash_drawer` RPC step 7 |
| FR-009 (Edited pill on row + Last-edited-by line on detail; derived from audit_log) | `history.ts` query left-joins audit_log; `detail-view.tsx` consumes the derived flag |
| FR-010 (Change history accordion from audit_log payloads) | `history.ts` `loadCashHistoryDetail` returns the audit row set; `change-history.tsx` renders |
| FR-011 (formatting tokens, salon-tz timestamps) | Existing `formatCurrency` and `lib/time/format.ts` helpers |
| FR-012 (notes optional when new variance = 0; required otherwise) | RPC step 5 + check constraint on table (already present from 019) |
| FR-013 (no-op edits are safe to retry; always write audit) | RPC unconditional UPDATE + INSERT (research R5) |
