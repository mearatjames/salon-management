# Contract — `pos_edit_cash_drawer` RPC

Location: `supabase/migrations/0015_cash_drawer_edits.sql`. Invoked from `editCashDrawerAction` via the service-role client.

## Signature

```sql
create or replace function public.pos_edit_cash_drawer(
  p_session_id     uuid,
  p_counted_cents  int,
  p_notes          text,
  p_operator       uuid,
  p_device_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
```

Returns the edited `cash_drawer_sessions.id` (echo of `p_session_id`).

Grants:

```sql
revoke all on function public.pos_edit_cash_drawer(uuid, int, text, uuid, uuid) from public;
grant execute on function public.pos_edit_cash_drawer(uuid, int, text, uuid, uuid) to service_role;
```

## Steps

1. **Lock the row.**

    ```sql
    select id, opening_cents, expected_cents, counted_cents, variance_cents, notes, closed_at
      into v_session_id, v_opening, v_expected, v_before_counted, v_before_variance, v_before_notes, v_closed_at
      from public.cash_drawer_sessions
      where id = p_session_id
      for update;
    ```

   - If no row found: `raise exception 'cash_drawer_session_missing' using errcode = 'P0001';`
   - If `v_closed_at is null`: `raise exception 'cash_drawer_session_not_closed' using errcode = 'P0001';`

2. **Compute new variance.**

    ```sql
    v_new_variance := p_counted_cents - (v_opening + v_expected);
    ```

3. **Trim notes.**

    ```sql
    v_trimmed_notes := nullif(btrim(p_notes), '');
    ```

4. **Enforce notes rule.**

    ```sql
    if v_new_variance != 0 and v_trimmed_notes is null then
      raise exception 'cash_drawer_note_required' using errcode = 'P0001';
    end if;
    ```

5. **Update the row.**

    ```sql
    update public.cash_drawer_sessions
      set counted_cents = p_counted_cents,
          variance_cents = v_new_variance,
          notes = v_trimmed_notes,
          updated_at = now()
      where id = p_session_id;
    ```

   `opening_cents`, `expected_cents`, `business_day`, `opened_*`, `closed_*`, `created_at` are not touched.

6. **Write the audit row in the same transaction.**

    ```sql
    insert into public.audit_log
      (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload)
      values (
        'cash_drawer.edited',
        p_device_user_id,
        p_operator,
        'cash_drawer',
        p_session_id,
        jsonb_build_object(
          'before', jsonb_build_object(
            'counted_cents', v_before_counted,
            'variance_cents', v_before_variance,
            'notes', v_before_notes
          ),
          'after', jsonb_build_object(
            'counted_cents', p_counted_cents,
            'variance_cents', v_new_variance,
            'notes', v_trimmed_notes
          ),
          'session_id', p_session_id
        )
      );
    ```

7. **Return.**

    ```sql
    return p_session_id;
    ```

## Idempotency

- The RPC is safe to retry: re-submitting the same values produces the same end state (the UPDATE is a self-overwrite when nothing changed) and writes another audit row (research R5 — intentional).
- Concurrency is last-write-wins on the row UPDATE (research R2). Two simultaneous edits both succeed at the SQL level; both write audit rows; the row reflects whichever transaction committed last. The change-history accordion shows both.

## Error codes

| Postgres error message | Meaning | Server Action code |
|-----------------------|---------|--------------------|
| `cash_drawer_session_missing` | No row for `p_session_id`. | `NOT_FOUND` |
| `cash_drawer_session_not_closed` | The row exists but is still open. | `NOT_CLOSED` |
| `cash_drawer_note_required` | Resulting variance is non-zero and trimmed notes is empty. | `NOTE_REQUIRED` |
| (other) | Unexpected (constraint violation, connection issue). | `UNEXPECTED` |

## Constraint safety

After this RPC commits, both pre-existing check constraints continue to hold:

- `cash_drawer_close_consistency_chk`: `closed_at` and `closed_by_staff_id` are unchanged; `expected_cents` is unchanged; `counted_cents` is the new value; the constraint's formula `variance_cents = counted_cents - (opening_cents + expected_cents)` holds because step 2 recomputes it from the same inputs.
- `cash_drawer_notes_required_when_variance_chk`: step 4 enforces the same rule before the UPDATE runs, so the constraint's predicate (`variance = 0 OR notes is non-empty`) is satisfied by every successful UPDATE.

## Test coverage (Vitest + a Postgres integration shim, matching the 019 pattern)

- Happy path: edit a clean close, counted changes from $164.50 to $164.00, notes provided → row reflects new values, `updated_at` advances, audit row exists with correct before/after payload.
- Notes rule: edit clean close → make variance non-zero with empty notes → `cash_drawer_note_required` raised; row unchanged.
- Notes-clearable path: edit a short close back to zero variance with empty notes → succeeds; row's notes is `NULL`.
- Idempotent no-op: re-submit current values → success, row unchanged values-wise but `updated_at` advances; new audit row written.
- Role gate is enforced upstream (Server Action level), not in the RPC; the RPC test asserts it does not have its own role check.
- Open-session rejection: pass an id for a row whose `closed_at IS NULL` → `cash_drawer_session_not_closed` raised.
- Missing session rejection: pass a random uuid → `cash_drawer_session_missing` raised.
- Audit row payload shape matches the documented JSON schema.
