# Contract — `public.pos_close_cash_drawer`

## Signature

```sql
public.pos_close_cash_drawer(
  p_counted_cents int,
  p_expected_cents int,
  p_notes text,
  p_operator uuid,
  p_business_day date
) returns uuid
```

- `security definer`, `set search_path = public, pg_temp`.
- `revoke all from public`; `grant execute to service_role`.
- Returns the closed session's `id` on success.
- Raises a Postgres exception with one of the named errcodes below on failure.

## Inputs

| Param | Notes |
|-------|-------|
| `p_counted_cents` | Operator's counted amount in cents. Must be `>= 0`. |
| `p_expected_cents` | The expected total the operator was looking at when they pressed Close Out Day. The RPC re-derives the current expected total and rejects the close if they differ. |
| `p_notes` | Operator's note. Must be non-empty (whitespace-stripped) when the variance is non-zero; may be NULL otherwise. |
| `p_operator` | `staff.id` of the operator. Caller (Server Action) is responsible for verifying this matches the cookie and that the role is `owner` or `manager`. |
| `p_business_day` | Salon-local date the session belongs to. The caller derives this from `getSalonTimezone()` + `now()`. |

## Behaviour

1. **Lazy open**: `INSERT INTO cash_drawer_sessions (opened_by_staff_id, business_day) VALUES (p_operator, p_business_day) ON CONFLICT DO NOTHING`. The partial unique index ensures only one open row.
2. **Lock**: `SELECT id, expected_cents, counted_cents FROM cash_drawer_sessions WHERE business_day = p_business_day FOR UPDATE`.
   - If `closed_at IS NOT NULL`, raise `cash_drawer_already_closed` (errcode `P0001`, message `cash_drawer_already_closed`).
3. **Recompute expected**: query `SELECT coalesce(sum(case when kind='refund' then -amount_cents else amount_cents end), 0) AS expected_cents FROM payments WHERE method='cash' AND status='succeeded' AND processed_at >= start AND processed_at < end`, where `start`/`end` are the UTC bounds of `p_business_day` in the salon's timezone.
4. **Stale check**: if `recomputed_expected != p_expected_cents`, raise `cash_drawer_expected_changed` (errcode `P0001`, message `cash_drawer_expected_changed`).
5. **Variance + notes**: `variance := p_counted_cents - (opening_cents + recomputed_expected)`. If `variance != 0` and `p_notes` is NULL or all-whitespace, raise `cash_drawer_note_required` (errcode `P0001`).
6. **Write close**: `UPDATE cash_drawer_sessions SET closed_at = now(), closed_by_staff_id = p_operator, expected_cents = recomputed_expected, counted_cents = p_counted_cents, variance_cents = variance, notes = nullif(btrim(p_notes), '') WHERE id = <locked id>`.
7. **Write audit**: `INSERT INTO audit_log (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload) VALUES ('cash_drawer.closed', NULL, p_operator, 'cash_drawer', <session_id>, jsonb_build_object('expected_cents', recomputed_expected, 'counted_cents', p_counted_cents, 'variance_cents', variance, 'notes', p_notes, 'session_id', <session_id>))`.
8. **Return**: the session id.

`actor_user_id` is `NULL` at the RPC layer because the RPC is invoked by the service-role client. The Server Action is responsible for fetching `auth.uid()` and either passing it as a parameter (preferred — extend the signature with `p_device_user_id uuid` if/when other call sites need it) or writing an additional audit entry. Decision: extend the signature to take `p_device_user_id uuid` so the audit row carries both.

**Revised signature** (final):

```sql
public.pos_close_cash_drawer(
  p_counted_cents int,
  p_expected_cents int,
  p_notes text,
  p_operator uuid,
  p_device_user_id uuid,
  p_business_day date
) returns uuid
```

## Error codes

| Errcode | Message | Caller action |
|---------|---------|----------------|
| `P0001` | `cash_drawer_already_closed` | Server Action maps to `{ ok: false, code: "ALREADY_CLOSED" }`. UI re-renders the done screen with the existing row. |
| `P0001` | `cash_drawer_expected_changed` | Server Action maps to `{ ok: false, code: "EXPECTED_CHANGED" }`. UI reloads and shows the recount banner. |
| `P0001` | `cash_drawer_note_required` | Server Action maps to `{ ok: false, code: "NOTE_REQUIRED" }`. UI re-focuses the note field. The page should never let this fire — the CTA is disabled — but it's a server-side safety net. |
| `23505` (unique_violation) on `cash_drawer_sessions_one_open_idx` | n/a | Cannot occur once we use `ON CONFLICT DO NOTHING`. If it does, surface as a 500. |

## Test coverage (Vitest)

- Happy path: zero-variance close on an empty drawer-session row writes the close + audit, returns the session id.
- Variance + non-empty note: writes the close with `variance_cents != 0` and `notes != null`.
- Variance + empty note: raises `cash_drawer_note_required`.
- Stale snapshot: caller passes `p_expected_cents` that doesn't match the recomputed value; raises `cash_drawer_expected_changed`.
- Second close attempt: raises `cash_drawer_already_closed`.
- Refund netting (synthetic): a `kind='refund'` payment row reduces the recomputed expected total.
- Lazy-open: when no open row exists, the RPC creates one and immediately closes it.
- Audit row shape: payload matches `{expected_cents, counted_cents, variance_cents, notes, session_id}` and the audit row carries both `actor_user_id` (device) and `acting_as_staff_id` (operator).
