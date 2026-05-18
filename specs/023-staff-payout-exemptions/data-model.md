# Phase 1 — Data Model: Per-staff payout exemptions

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

Schema delta, app-layer type extensions, validation rules, state transitions, and invariants for the per-staff payout exemptions. Authoritative source for column types is the migration this document is the basis for: `supabase/migrations/0018_staff_pay_deductions.sql`.

This feature adds **three new columns** to `public.staff` (`card_fee_exempt`, `supply_mode`, `supply_except`), **one new CHECK constraint** on `public.staff` (`staff_supply_except_empty_unless_partial_chk`), and **two new triggers** (one on `staff` for FK-shape validation, one on `supply_types` for cascading prune) — but **no new tables**, **no new RLS roles**, and **no schema change** on `audit_log` (per research § R3).

---

## 1. Schema delta

### 1.1 New columns on `public.staff`

| Column            | Type      | Constraints                                                                                                            | Notes                                                                                                  |
|-------------------|-----------|------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `card_fee_exempt` | `boolean` | `not null default false`                                                                                               | True = tech is exempt from the standard card processing fee on card-paid services.                     |
| `supply_mode`     | `text`    | `not null default 'apply'`; column-level `check (supply_mode in ('apply','partial','exempt'))`                          | `apply` = all supply costs deducted; `partial` = only types in `supply_except` are exempt; `exempt` = no supply costs deducted. |
| `supply_except`   | `uuid[]`  | `not null default '{}'`; element-existence enforced by trigger (research § R1)                                          | UUIDs reference `public.supply_types(id)`. Only populated when `supply_mode = 'partial'`.              |

### 1.2 New CHECK constraint on `public.staff`

```sql
alter table public.staff
  add constraint staff_supply_except_empty_unless_partial_chk
    check (
      supply_mode = 'partial'
      or array_length(supply_except, 1) is null
    );
```

Reads: "if supply_mode is anything other than 'partial', the `supply_except` array MUST be empty." `array_length(arr, 1) is null` is Postgres' canonical way to test for empty arrays (length-of-zero-array returns NULL in PG). Pairs with the app-layer save-time wipe rule (FR-002) — DB CHECK is the backstop.

### 1.3 New triggers

Per research § R1, FK-shape integrity on `supply_except` is enforced by two PL/pgSQL row triggers because Postgres does not support `FOREIGN KEY` on array elements.

#### `staff_assert_supply_except_valid_trg`

- **Timing**: `before insert or update`
- **Scope**: `for each row` on `public.staff`
- **Action**: For each element of `NEW.supply_except`, verify `EXISTS (select 1 from supply_types where id = elem)`. If any element fails the existence check, raise `foreign_key_violation` exception with message `'supply_except contains an id not present in supply_types'`.
- **Fires on**: every staff INSERT or UPDATE that touches the row (Postgres can't selectively fire triggers based on changed columns alone; the trigger function early-returns when `array_length(NEW.supply_except, 1) is null`).

#### `supply_types_prune_from_staff_trg`

- **Timing**: `after delete`
- **Scope**: `for each row` on `public.supply_types`
- **Action**: `update public.staff set supply_except = array_remove(supply_except, OLD.id) where OLD.id = any(supply_except)`. This satisfies FR-003 ("If a supply-type catalog row is ever physically deleted, all staff records referencing its identifier MUST have that identifier removed automatically.") The update is no-op for staff whose `supply_except` doesn't contain the dead id (the `WHERE` clause filters them out).
- **Fires on**: every `supply_types` DELETE. 022 uses archive-not-delete (the `archive_supply_type` action sets `archived = true`, not DELETE), so this trigger fires only in disaster-recovery scenarios.

### 1.4 No new indexes

The three new columns are read together with the rest of the staff row in every query that touches them (panel render, roster fetch, audit-diff comparison). They are not selectively-indexed.

### 1.5 No RLS change

The new columns are read and written under the same row-level policies that already cover the existing `staff` columns (per the 006 RLS setup). The triggers run as `SECURITY DEFINER` only if needed for cross-table access — both triggers access `supply_types` and `staff` which the calling role can already access (the trigger inherits the SQL caller's role), so no `SECURITY DEFINER` is needed.

### 1.6 No `audit_log` schema change

Per research § R3, the audit-payload extension is content-only — the existing `staff.updated` action verb is reused with the JSONB payload extended to include the three new diff keys. `audit_log` table structure, columns, and indexes are unchanged.

---

## 2. App-layer types

### 2.1 `RosterStaff` extension

`app/(studio)/settings/staff/_types.ts` extends the existing `RosterStaff` type with three new fields:

```ts
export type StaffSupplyMode = "apply" | "partial" | "exempt";

export type RosterStaff = {
  id: string;
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  created_at: string;
  /** Derived in the page Server Component: `pin_hash !== null`. */
  pin_set: boolean;
  // NEW in 023:
  card_fee_exempt: boolean;
  supply_mode: StaffSupplyMode;
  supply_except: readonly string[];
};
```

`supply_except` is `readonly string[]` to signal immutability at the app boundary (the panel's draft state copies on every edit). The SQL column type is `uuid[]` — the app stringifies on read (Supabase returns uuids as strings already) and re-coerces on write.

### 2.2 `loadSupplyCatalogForStaff` return type

`app/(studio)/settings/staff/_supply-catalog.ts` exports:

```ts
export type SupplyCatalogTypeRow = {
  id: string;
  name: string;
  archived: boolean;
  service_count: number;
  sample_amount_cents: number | null; // null when service_count = 0
};

export type SupplyCatalogForStaff = {
  types: SupplyCatalogTypeRow[];
};

export async function loadSupplyCatalogForStaff(
  staffId: string
): Promise<SupplyCatalogForStaff>;
```

The returned `types` array is **alphabetized by `name` ascending** (matches FR-006 row ordering). Empty `types` array signals the empty-state UI ("No supply types defined yet. Add some on the Services page first.") — FR-006's empty case from US2 #6.

### 2.3 `StaffSnapshot` (audit-diff)

`app/(studio)/settings/staff/_audit-diff.ts` exports:

```ts
export const STAFF_DIFF_KEYS = [
  "display_name",
  "role",
  "color_token",
  "active",
  "card_fee_exempt",
  "supply_mode",
  "supply_except",
] as const;

export type StaffSnapshotKey = (typeof STAFF_DIFF_KEYS)[number];

export type StaffSnapshot = {
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  card_fee_exempt: boolean;
  supply_mode: StaffSupplyMode;
  supply_except: readonly string[];
};

export type StaffChanges = {
  before: Partial<StaffSnapshot>;
  after: Partial<StaffSnapshot>;
  changes: readonly StaffSnapshotKey[];
};

export function buildChanges(
  before: StaffSnapshot,
  after: StaffSnapshot
): StaffChanges;
```

Implementation rules:
- For non-array keys: `before[key] !== after[key]` is the diff predicate.
- For `supply_except` (the only array key): two arrays are equal iff `[...a].sort().join(',') === [...b].sort().join(',')`. Element order is not significant (the validator dedupes via `Set`; the array contains uuids which are stable strings).
- `changes` array preserves the order of `STAFF_DIFF_KEYS` (display_name first, supply_except last).
- `before` and `after` are scoped projections — only keys present in `changes` appear.

---

## 3. Validation rules

### 3.1 `validateSupplyMode(raw): StaffSupplyMode`

`app/(studio)/settings/staff/_validation.ts` extends with:

```ts
export function validateSupplyMode(input: string): StaffSupplyMode {
  if (input === "apply" || input === "partial" || input === "exempt") {
    return input;
  }
  throw new ValidationError("invalid_supply_mode");
}
```

New `ValidationErrorCode` value: `"invalid_supply_mode"`.

### 3.2 `validateSupplyExcept(raw, allowedIds): string[]`

```ts
export function validateSupplyExcept(
  raw: readonly string[],
  allowedIds: ReadonlySet<string>
): string[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError("invalid_supply_except_shape");
  }
  const deduped = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue; // drop non-strings silently
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (!allowedIds.has(trimmed)) continue; // drop unknown ids silently (defensive — stale tab)
    deduped.add(trimmed);
  }
  const result = Array.from(deduped);
  if (result.length > 64) {
    return result.slice(0, 64);
  }
  return result;
}
```

New `ValidationErrorCode` value: `"invalid_supply_except_shape"` (only thrown when `raw` isn't an array — FormData's `getAll()` always returns an array, so this is defensive against non-FormData callers).

Validation deviates from the standard "throw on invalid input" pattern in two places (both intentional, both spec-driven):
1. Unknown ids are **dropped silently** (not thrown) — defensive against stale tabs where the operator's UI shows ids that have since been archived/deleted (FR-012). This is the documented behavior.
2. The 64-entry cap **truncates silently** (not throws) — the cap is a defensive limit on pathological FormData submissions, not a domain rule. Realistic catalog size is ≤30 (production); 64 is the cap (FR-004).

### 3.3 No new validators for `card_fee_exempt`

The boolean field is parsed directly via `formData.get("card_fee_exempt") === "on"`. No validator needed (the value is a boolean, no shape error possible).

---

## 4. State transitions

### 4.1 Supply-mode transitions (UI-driven, save-time persistence)

| From      | To        | UI behavior on toggle                                                                                                                                                                                              | Save persistence                                                                                              |
|-----------|-----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `apply`   | `partial` | Per-type picker fades in (300ms; instant under reduced-motion). Picker is unchecked unless the operator previously selected types in this session (draft state preserved per Clarify Q4).                          | Persist `supply_mode = 'partial'`, `supply_except = <ticked ids>`.                                            |
| `apply`   | `exempt`  | Per-type picker stays hidden. No additional inputs visible.                                                                                                                                                        | Persist `supply_mode = 'exempt'`, `supply_except = '{}'` (wiped regardless of any pre-existing persisted set). |
| `partial` | `apply`   | Per-type picker fades out (300ms; instant). Draft ticks are PRESERVED in the panel's draft state (per Clarify Q4) so switching back to `partial` restores them.                                                    | Persist `supply_mode = 'apply'`, `supply_except = '{}'` (wiped — saves blow away the ticks).                  |
| `partial` | `exempt`  | Same as partial→apply (picker fades out, draft preserved).                                                                                                                                                          | Persist `supply_mode = 'exempt'`, `supply_except = '{}'` (wiped).                                              |
| `exempt`  | `apply`   | No visible change (neither mode shows the picker).                                                                                                                                                                  | Persist `supply_mode = 'apply'`, `supply_except = '{}'` (already empty).                                       |
| `exempt`  | `partial` | Per-type picker fades in. Picker is unchecked unless prior draft state has ticks (which there typically aren't — the operator just came from `exempt` which has no ticks; the draft preservation is a from-`partial` aid). | Persist `supply_mode = 'partial'`, `supply_except = <ticked ids>`.                                            |

The DB CHECK `staff_supply_except_empty_unless_partial_chk` rejects any persist that violates the mode-vs-empty invariant. The trigger `staff_assert_supply_except_valid_trg` rejects any persist with unknown supply-type ids.

### 4.2 Card-fee-exempt transitions

Two-state toggle with no transition complexity: `false ↔ true`. The DB CHECK is implicit in the boolean type.

### 4.3 Audit row creation per save

`updateStaff` writes ONE `staff.updated` audit row per save where `buildChanges(before, after).changes.length > 0` (i.e., at least one of the seven snapshotable keys changed). Within that row:

- `payload.before` — projection of `before` over the changed keys.
- `payload.after` — projection of `after` over the changed keys.
- `payload.changes` — the changed-keys array in `STAFF_DIFF_KEYS` order.

When all seven keys are unchanged (no-op save), no audit row is written — but typical saves change at least one field, so this is rarely the case in practice.

---

## 5. Migration outline (0018_staff_pay_deductions.sql)

```sql
-- 0018_staff_pay_deductions.sql
-- Feature: 023-staff-payout-exemptions

-- 1. Add three new columns to public.staff with defaults.
alter table public.staff
  add column if not exists card_fee_exempt boolean not null default false,
  add column if not exists supply_mode text not null default 'apply'
    check (supply_mode in ('apply','partial','exempt')),
  add column if not exists supply_except uuid[] not null default '{}';

-- 2. Add the mode-vs-empty CHECK constraint.
alter table public.staff
  add constraint staff_supply_except_empty_unless_partial_chk
    check (
      supply_mode = 'partial'
      or array_length(supply_except, 1) is null
    );

-- 3. Element-existence trigger function + trigger.
create or replace function public.staff_assert_supply_except_valid()
returns trigger
language plpgsql
as $$
begin
  if array_length(new.supply_except, 1) is not null then
    if exists (
      select 1
      from unnest(new.supply_except) as elem(id)
      left join public.supply_types t on t.id = elem.id
      where t.id is null
    ) then
      raise foreign_key_violation
        using message = 'supply_except contains an id not present in supply_types';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_assert_supply_except_valid_trg on public.staff;
create trigger staff_assert_supply_except_valid_trg
  before insert or update on public.staff
  for each row execute function public.staff_assert_supply_except_valid();

-- 4. Cascading-prune trigger function + trigger on supply_types.
create or replace function public.supply_types_prune_from_staff()
returns trigger
language plpgsql
as $$
begin
  update public.staff
  set supply_except = array_remove(supply_except, old.id)
  where old.id = any(supply_except);
  return old;
end;
$$;

drop trigger if exists supply_types_prune_from_staff_trg on public.supply_types;
create trigger supply_types_prune_from_staff_trg
  after delete on public.supply_types
  for each row execute function public.supply_types_prune_from_staff();

-- 5. No data backfill — the new columns ship with defaults that match the
--    intended initial state for every existing staff row (no exemptions).
```

The migration is **transactional** (Supabase CLI wraps each file in a single transaction by default) — either every step commits together or none does. Idempotent throughout (`if not exists`, `if exists`, `or replace`) — re-running the migration after a successful apply is a no-op.

---

## 6. Invariants (asserted by code, DB, or both)

1. `supply_except` IS NEVER non-empty when `supply_mode <> 'partial'`. *Enforced by*: DB CHECK + app save-time wipe + Vitest unit test for `updateStaff` save shape.
2. Every uuid in `supply_except` references an existing row in `supply_types`. *Enforced by*: BEFORE trigger on `staff` INSERT/UPDATE + app `validateSupplyExcept` allowed-id filter + Vitest unit test.
3. When a `supply_types` row is DELETEd, every `staff.supply_except` containing its id is updated to remove it (no dangling references survive). *Enforced by*: AFTER DELETE trigger on `supply_types` + Playwright integration test that DELETEs a seeded supply_type and asserts the staff's `supply_except` no longer contains the dead id.
4. `supply_mode` is always one of three permitted values. *Enforced by*: DB column CHECK + app `validateSupplyMode` + Vitest unit test.
5. Every staff update that mutates any of `card_fee_exempt`/`supply_mode`/`supply_except` writes exactly one `staff.updated` audit row with a `changes` array naming the changed fields. *Enforced by*: `updateStaff` action calling `recordAudit` before `revalidatePath + redirect` + Playwright e2e assertion (audit assertions land before the action implementation per Constitution IV).
6. The audit diff for `supply_except` stores raw uuids only — no name snapshot. *Enforced by*: `buildChanges` implementation + Vitest unit test asserting the shape.
7. The roster filter chip's persisted key is `tn:settings:staff:filter`. The legacy `tn:settings:staff:show-inactive` key is never read and never written. *Enforced by*: `RosterFilterChips` component code + Vitest unit test for the storage key constants.
8. Self-edit of own `card_fee_exempt`/`supply_mode`/`supply_except` IS permitted. Self-edit of own role/active remains blocked. *Enforced by*: `SELF_BLOCKED_ACTIONS` not containing `'update_pay_deductions'` + Vitest unit test on `assertMutationAllowed` for self target with the action.

These invariants are the contract between the data model and the rest of the system. Every existing and future consumer of `staff.{card_fee_exempt,supply_mode,supply_except}` can rely on them.
