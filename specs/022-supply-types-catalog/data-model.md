# Phase 1 — Data Model: Supply types catalog

**Feature**: `022-supply-types-catalog` · **Date**: 2026-05-17

Schema delta, app-layer type extensions, validation rules, state transitions, and invariants for the supply-types catalog and the `services` refactor. The authoritative source for column types is the migration this document is the basis for: `supabase/migrations/0017_supply_types_catalog.sql`.

This feature adds **one new table** (`public.supply_types`), **one new column** on `public.services` (`supply_type_id`), **drops one column** on `public.services` (`supply_label`), **replaces one CHECK constraint** on `public.services` (`services_supply_pair_chk`), and adds new entries to the existing `audit_log` content (`entity_type = 'supply_type'`, four new `action` values) — but **no schema change** on `audit_log` (per research § R3).

---

## 1. Schema delta

### 1.1 New table — `public.supply_types`

| Column           | Type          | Constraints                                                                       | Notes                                                                       |
|------------------|---------------|-----------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| `id`             | `uuid`        | `primary key default gen_random_uuid()`                                           | Stable identifier — survives renames; what services reference.              |
| `name`           | `text`        | `not null`; column-level `check (length(trim(name)) between 2 and 64)`            | Display name. Whitespace-collapsed + trimmed by app before INSERT/UPDATE.   |
| `name_canonical` | `text`        | `not null generated always as (lower(trim(name))) stored`                         | Canonical form for the partial unique index (per research § R1).            |
| `archived`       | `boolean`     | `not null default false`                                                          | False = visible in picker; true = hidden from picker, visible in section.   |
| `created_at`     | `timestamptz` | `not null default now()`                                                          | Set on first INSERT.                                                         |
| `updated_at`     | `timestamptz` | `not null default now()`                                                          | Bumped by `supply_types_set_updated_at_trg` on any column change.            |

### 1.2 New indexes — `public.supply_types`

- **`supply_types_name_active_uq`** (partial unique index): `unique (name_canonical) where archived = false`. Enforces FR-004 / FR-006 (no duplicate active names, case-insensitive). Archived rows are excluded — operators can reactivate without colliding with themselves, and renaming TO an archived name is allowed (Edge Case: "Rename collides with an archived type's name — allowed").
- **`supply_types_archived_name_idx`**: `(archived, name_canonical)` — used by the picker's `select where archived = false order by name` and by the EditPolicySheet section's `select … order by archived, name`.

### 1.3 New trigger — `public.supply_types`

- **`supply_types_set_updated_at_trg`** — `before update on public.supply_types for each row execute function public.set_updated_at()`. The trigger function `public.set_updated_at` is already defined (used by `staff`, `services`, etc.); the migration just attaches it.

### 1.4 New column on `public.services` — `supply_type_id`

| Column           | Type   | Constraints                                                                | Notes                                                                                      |
|------------------|--------|----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| `supply_type_id` | `uuid` | nullable; `references public.supply_types(id) on delete restrict`          | NULL when supply is off; non-NULL FK when supply is on. ON DELETE RESTRICT per research §R7. |

### 1.5 Dropped column on `public.services`

- `supply_label text` — **dropped in the same migration after backfill** per Clarification Q1. The migration's order: create table → add column → backfill → swap CHECK constraint → drop column → write audit rows. After this migration, no service row stores a free-text supply name; all supply identity is via FK.

### 1.6 Replaced CHECK constraint on `public.services`

- **Dropped**: `services_supply_pair_chk` (the 0016 version that paired `supply_amount_cents` with `supply_label`).
- **Added**: `services_supply_pair_chk` (the 0017 replacement) — pairs `supply_amount_cents` with `supply_type_id`:

  ```sql
  alter table public.services
    drop constraint if exists services_supply_pair_chk;
  alter table public.services
    add constraint services_supply_pair_chk check (
      (supply_amount_cents is null and supply_type_id is null)
      or
      (supply_amount_cents is not null
       and supply_type_id is not null
       and supply_amount_cents between 1 and 5000)
    );
  ```

  Reads: "Both columns null (Supply off), OR both non-null with amount in `[1, 5000]` (Supply on)." Per FR-012.

### 1.7 RLS posture (per research § R8)

```sql
alter table public.supply_types enable row level security;

drop policy if exists supply_types_select_authenticated on public.supply_types;
create policy supply_types_select_authenticated
  on public.supply_types
  for select
  to authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policies — writes go via the service-role
-- client through the Server Actions. Same posture as public.services.
```

The `services` table's RLS is unchanged; the new column inherits the existing posture.

### 1.8 No `audit_log` schema change

`audit_log.actor_user_id` is already nullable, `audit_log.entity_type` is plain text, `audit_log.action` is plain text. The migration writes `INSERT INTO audit_log` rows with `actor_user_id = NULL`, `entity_type = 'supply_type'`, `action = 'supply_type.created'`, and a payload object carrying the system actor marker. See research § R3 and contracts/audit-payload.contract.md § 2.

### 1.9 Backfill behavior

The migration executes (in order) a single `INSERT INTO supply_types (name) SELECT DISTINCT regexp_replace(initcap(lower(trim(supply_label))), '\s+', ' ', 'g') AS name FROM services WHERE supply_label IS NOT NULL` (deduped at the SQL layer by the partial unique index — but the SELECT is already DISTINCT on the canonical form to short-circuit). Then `UPDATE services SET supply_type_id = (SELECT id FROM supply_types WHERE name_canonical = regexp_replace(lower(trim(services.supply_label)), '\s+', ' ', 'g')) WHERE supply_label IS NOT NULL`. Finally `ALTER TABLE services DROP COLUMN supply_label`.

The audit rows for the seeded types are inserted via `INSERT INTO audit_log … SELECT 'supply_type.created', NULL, NULL, 'supply_type', st.id, jsonb_build_object('name', st.name, 'source', 'migration:022', 'from_label', orig.from_label) FROM supply_types st JOIN (SELECT DISTINCT supply_label AS from_label, regexp_replace(lower(trim(supply_label)), '\s+', ' ', 'g') AS canonical FROM services WHERE supply_label IS NOT NULL) orig ON orig.canonical = st.name_canonical` (one audit row per seeded type; the `from_label` is the first encountered legacy label that produced it, useful for debugging if a backfill anomaly surfaces).

The full SQL is documented in `contracts/db-migration.contract.md`.

### 1.10 Migration ordering

```text
1. CREATE TABLE public.supply_types (…);                       -- 1.1
2. CREATE UNIQUE INDEX supply_types_name_active_uq …;           -- 1.2
3. CREATE INDEX supply_types_archived_name_idx …;               -- 1.2
4. CREATE TRIGGER supply_types_set_updated_at_trg …;            -- 1.3
5. ALTER TABLE public.supply_types ENABLE ROW LEVEL SECURITY;   -- 1.7
6. CREATE POLICY supply_types_select_authenticated …;           -- 1.7
7. ALTER TABLE public.services ADD COLUMN supply_type_id …;     -- 1.4
8. INSERT INTO public.supply_types (name) SELECT DISTINCT …;    -- 1.9 (backfill — types)
9. UPDATE public.services SET supply_type_id = …;               -- 1.9 (backfill — services)
10. ALTER TABLE public.services DROP CONSTRAINT services_supply_pair_chk;  -- 1.6
11. ALTER TABLE public.services ADD  CONSTRAINT services_supply_pair_chk CHECK (…);  -- 1.6
12. ALTER TABLE public.services DROP COLUMN supply_label;       -- 1.5 (drop AFTER backfill + CHECK swap)
13. INSERT INTO public.audit_log (…) SELECT …;                  -- 1.9 (audit rows for seeded types)
```

Wrapped in a transaction by the Supabase CLI's `db push` by default — all-or-nothing.

---

## 2. App-layer type extensions

### 2.1 `app/(studio)/services/_types.ts` — replace `supply_label` with FK + denormalized name

```ts
export type SupplyTypeLite = {
  id: string;
  name: string;
  archived: boolean;
};

export type CatalogService = {
  // … existing 008 + 021 fields, MINUS supply_label …
  // -- card_fee_mode, card_fee_custom_cents, supply_amount_cents stay --
  supply_type_id: string | null;
  /** Resolved on read via LEFT JOIN supply_types — read-only; never submitted back to the server. */
  supply_type_name: string | null;
};
```

`ServiceDraftBaseline` already extends `CatalogService` with `assignments`; the swapped fields ride through automatically.

### 2.2 `app/(studio)/settings/policy/_load.ts` — NEW `loadSupplyTypesCatalog`

```ts
export type SupplyTypeRow = {
  id: string;
  name: string;
  archived: boolean;
  usage_count: number;
  services: Array<{
    id: string;
    name: string;
    color_token: string;
    supply_amount_cents: number;
  }>;
};

export type SupplyTypesCatalog = {
  active: SupplyTypeRow[];   // archived = false, sorted by name ASC
  archived: SupplyTypeRow[]; // archived = true,  sorted by name ASC
};

export async function loadSupplyTypesCatalog(): Promise<SupplyTypesCatalog>;
```

Implementation: two parallel queries (per research § R5) — `select id, name, archived from supply_types order by archived, name` and `select supply_type_id, services.id, services.name, services.color_token, services.supply_amount_cents from services where active = true and supply_type_id is not null order by services.name`. Fan-out at the JS layer to assemble the per-type usage_count + services arrays.

### 2.3 `service-form.client.tsx` — `ServiceDraft` field swap

```ts
export type ServiceDraft = {
  // … existing 008 + 021 fields …
  card_fee_mode: CardFeeMode;
  card_fee_custom_dollars: string;
  supply_on: boolean;
  supply_amount_dollars: string;
  // REPLACED: supply_label: string  ->  supply_type_id: string | null
  supply_type_id: string | null;
};
```

The `supply_type_id` is preserved across toggle-off cycles (FR-021 already covers buffer preservation) so a fat-finger off → on cycle re-selects the same type. When the picker is opened with `supply_type_id = null` (after an off → on flip with no prior selection), the picker shows the empty state ("Pick a supply type") with the inline-create row visible.

---

## 3. Validation rules

### 3.1 `app/(studio)/services/_validation.ts` — swap

```ts
export type ValidationErrorCode =
  // … existing 008 codes …
  | "invalid_card_fee_mode"
  | "invalid_card_fee_custom"
  | "card_fee_custom_too_large"
  | "invalid_supply_amount"
  | "supply_amount_too_large"
  // REMOVED: "invalid_supply_label", "supply_label_too_long"
  | "invalid_supply_type";    // NEW: missing or malformed supply_type_id when supply is on
```

```ts
/** UUID-loose shape (mirrors UUID_SHAPE_LOOSE in actions.ts). Required when supply is on. */
export function validateSupplyTypeId(input: string): string {
  const trimmed = readString(input).trim();
  if (!UUID_SHAPE_LOOSE.test(trimmed)) {
    throw new ValidationError("invalid_supply_type");
  }
  return trimmed;
}
```

The old `validateSupplyLabel` is deleted. The `SUPPLY_LABEL_MAX_LEN` constant is removed.

### 3.2 `app/(studio)/settings/policy/_validation.ts` — NEW

```ts
export type SupplyTypeValidationErrorCode =
  | "name_too_short"      // < 2 chars after trim+collapse
  | "name_too_long"       // > 64 chars after trim+collapse
  | "name_taken"          // case-insensitive collision with another active type
  | "type_not_found"      // id doesn't exist (defense in depth — race or stale tab)
  | "type_in_use"         // archive blocker — at least one active service references it
  | "type_already_active" // reactivate called on an already-active type (no-op)
  | "type_already_archived"; // archive called on an already-archived type (no-op)

/** Trim, whitespace-collapse, then enforce [2, 64] chars. Returns the canonicalized
 *  display name (the `name` column value to persist — NOT the canonical lowercase form).
 *  Uses canonicalizeName() for the equivalence check but persists the display string. */
export function validateSupplyTypeName(input: string): string;
```

Implementation: `const collapsed = readString(input).trim().replace(/\s+/g, ' '); if (collapsed.length < 2) throw …("name_too_short"); if (collapsed.length > 64) throw …("name_too_long"); return collapsed;`. The DB's partial unique index does the cross-row uniqueness check; the action wraps the `INSERT` / `UPDATE` and maps the `23505` Postgres unique-violation error code to `name_taken`.

### 3.3 `lib/policy/canonicalize-name.ts` — NEW pure helper

```ts
/** Canonical comparison form for supply-type names.
 *  Equivalent to the DB's name_canonical generated column (lower(trim(name)))
 *  combined with the SQL backfill's regexp_replace(…, '\s+', ' ', 'g'). */
export function canonicalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

Used by:
- The picker's client-side soft-hint collision check (US1 AC3: "case-insensitively matches an existing active type → soft hint").
- The Server Actions' optional pre-check before submitting (the DB still has the final say — research § R1).
- The migration backfill SQL mirrors this in raw SQL: `regexp_replace(lower(trim(supply_label)), '\s+', ' ', 'g')`.

---

## 4. Audit payload extensions

### 4.1 `SERVICE_DIFF_KEYS` — swap

```ts
const SERVICE_DIFF_KEYS = [
  // … existing 13 keys (08 + 021 minus supply_label) …
  // REMOVED: "supply_label"
  "supply_type_id",   // NEW: replaces supply_label in the diff machinery
] as const;
```

### 4.2 `ServiceDiffSnapshot` — swap

```ts
type ServiceDiffSnapshot = {
  // … existing 13 fields …
  supply_type_id: string | null;   // REPLACED supply_label: string | null
};
```

### 4.3 New `supply_type.*` audit verbs

Each catalog Server Action awaits `recordAudit` before its `redirect`. Payload shapes are locked in `contracts/audit-payload.contract.md § 1`:

- **`supply_type.created`**: `{ name: string, source?: 'migration:022', from_label?: string }`. The `source` + `from_label` fields appear ONLY for migration-seeded rows (see research § R3). Operator-created rows have just `{ name }`.
- **`supply_type.renamed`**: `{ before: { name: string }, after: { name: string } }`.
- **`supply_type.archived`**: `{ name: string }` (captured at archive time so the row reads naturally if the name is later changed during reactivate-rename cycles).
- **`supply_type.reactivated`**: `{ name: string }`.

The `recordAudit` helper's `AuditAction` union grows by 4 entries; `deriveEntityType` switch grows by one prefix.

### 4.4 `service.added` / `service.updated` payload swap

The `before` and `after` snapshots in the existing `service.added` and `service.updated` payloads swap `supply_label: string | null` for `supply_type_id: string | null`. The resolved type name is NOT echoed in the service-update payload — operators tracing a service's history follow the FK to the `supply_type.renamed` event log for name changes (this is the whole point of stable ids: the service row's audit history shows what it was attached to, not what the attachment was called at the time).

---

## 5. State transitions

### 5.1 Supply state on a service (no change from 021)

```text
   off ──→ on  (supply_type_id required; amount required)
   on  ──→ off (clears both columns on save)
```

Invariant: `supply_amount_cents` and `supply_type_id` are both null (off) or both non-null (on). Enforced by the new `services_supply_pair_chk` (1.6) AND by the Server Action's null-on-toggle behavior (FR-021, unchanged from 021).

### 5.2 Supply type lifecycle

```text
   created (active) ──→ renamed (active, new name)
   created (active) ──→ archived (when usage_count = 0)
   archived         ──→ reactivated (active)
   active           ──→ (delete? not supported in v1)
```

Invariants:

- `archived = true` → MUST have zero active services with `supply_type_id = self.id` (FR-007 — app-enforced at the action layer; the FK's `ON DELETE RESTRICT` is defense-in-depth for hypothetical direct deletes).
- `archived = false` AND `name_canonical = other.name_canonical` (for any other active type) → forbidden (DB partial unique index, FR-006).
- Reactivate of an archived type whose name now collides with an active type → rejected with `name_taken` (FR-008).

### 5.3 Picker / display state

```text
   Picker (on services edit panel):
     SELECT id, name FROM supply_types WHERE archived = false ORDER BY name;
     (Archived types never appear; per FR-009.)

   EditPolicySheet section:
     Active group:    archived = false, sorted by name
     Archived group:  archived = true,  sorted by name (muted sub-section, with "Reactivate")
     (Per FR-009 / FR-010 / US3 AC2.)
```

---

## 6. Invariants (cross-cutting)

| Invariant | Where enforced |
|---|---|
| `supply_type.name` length-and-trim: `length(trim(name)) BETWEEN 2 AND 64` | Column CHECK (DB) + `validateSupplyTypeName` (app) |
| `supply_type.name_canonical` uniqueness across active types | Partial unique index `supply_types_name_active_uq` (DB) + soft hint via `canonicalizeName` (app) |
| `services.supply_amount_cents IS NULL ⇔ services.supply_type_id IS NULL` | `services_supply_pair_chk` (DB) + Server Action clear-on-toggle (app, unchanged from 021) |
| `services.supply_amount_cents ∈ [1, 5000]` when set | Pair CHECK (DB) + `validateSupplyAmountDollars` (app, unchanged from 021) |
| Archiving forbidden while any active service references the type | Application: pre-check in `archiveSupplyType` (`select count(*) from services where supply_type_id = $1 and active = true` → `type_in_use` if > 0); FK `ON DELETE RESTRICT` is the defense-in-depth backstop (we never actually `DELETE FROM supply_types` in v1 — archive is the supported lifecycle) |
| Every catalog mutation has an `audit_log` row | Server Actions await `recordAudit` before redirect (mirrors 008/021 pattern); migration writes its own rows via direct INSERT (per research § R3 + SC-007) |
| Renames don't rewrite `services` rows | A rename is a single `UPDATE supply_types SET name = …` — no `services` rows change. The picker / chip resolves the name on next read via the LEFT JOIN |
| Picker excludes archived types | `loadSupplyTypesCatalog` returns them in a separate array; the picker reads only `active`. The section reads both |
| Both `/services` and `/settings/staff` revalidate on every mutation | `revalidateSupplyTypeConsumers()` helper called from every catalog action (per research § R6) |

---

## 7. Migration SQL — `supabase/migrations/0017_supply_types_catalog.sql`

The migration is documented in [contracts/db-migration.contract.md](./contracts/db-migration.contract.md). Outline (the contract file has the full SQL):

```sql
-- 0017_supply_types_catalog.sql
-- Feature: 022-supply-types-catalog
--
-- Promotes free-text services.supply_label to a first-class supply_types
-- catalog. Creates supply_types, adds services.supply_type_id, backfills
-- from existing supply_label values (case-insensitively deduped + canonicalized),
-- replaces services_supply_pair_chk, drops services.supply_label, and writes
-- one supply_type.created audit row per seeded type.
--
-- Wrapped in the implicit transaction Supabase CLI applies to each
-- migration file — all-or-nothing.

-- 1. Table + indexes + trigger + RLS.
create table if not exists public.supply_types (
  id              uuid        primary key default gen_random_uuid(),
  name            text        not null,
  name_canonical  text        not null generated always as (lower(trim(name))) stored,
  archived        boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint supply_types_name_len_chk check (length(trim(name)) between 2 and 64)
);

create unique index if not exists supply_types_name_active_uq
  on public.supply_types (name_canonical) where archived = false;

create index if not exists supply_types_archived_name_idx
  on public.supply_types (archived, name_canonical);

drop trigger if exists supply_types_set_updated_at_trg on public.supply_types;
create trigger supply_types_set_updated_at_trg
  before update on public.supply_types
  for each row execute function public.set_updated_at();

alter table public.supply_types enable row level security;
drop policy if exists supply_types_select_authenticated on public.supply_types;
create policy supply_types_select_authenticated
  on public.supply_types
  for select to authenticated using (true);

-- 2. Add the FK column on services.
alter table public.services
  add column if not exists supply_type_id uuid references public.supply_types(id) on delete restrict;

-- 3. Backfill: seed supply_types from distinct legacy labels, then point services.
--    The display name is the cleaned-up form of the first encountered legacy label
--    (whitespace collapsed, otherwise preserved — operators can rename later).
insert into public.supply_types (name)
select distinct regexp_replace(trim(supply_label), '\s+', ' ', 'g') as name
  from public.services
 where supply_label is not null
 -- A second-line guard against an empty trimmed label sneaking through.
   and length(trim(supply_label)) > 0
on conflict do nothing;

update public.services s
   set supply_type_id = (
     select id from public.supply_types st
      where st.name_canonical = regexp_replace(lower(trim(s.supply_label)), '\s+', ' ', 'g')
   )
 where s.supply_label is not null;

-- 4. Replace the supply pair CHECK constraint.
alter table public.services
  drop constraint if exists services_supply_pair_chk;
alter table public.services
  add constraint services_supply_pair_chk check (
    (supply_amount_cents is null and supply_type_id is null)
    or
    (supply_amount_cents is not null
     and supply_type_id is not null
     and supply_amount_cents between 1 and 5000)
  );

-- 5. Drop the legacy column.
alter table public.services drop column if exists supply_label;

-- 6. Write one supply_type.created audit row per seeded type, with the
--    system-actor marker in payload (per research § R3).
insert into public.audit_log (action, actor_user_id, acting_as_staff_id, entity_type, entity_id, payload)
select
  'supply_type.created',
  null,
  null,
  'supply_type',
  st.id,
  jsonb_build_object(
    'name', st.name,
    'source', 'migration:022',
    'from_label', coalesce(
      (select min(supply_label) from public.services s
        where regexp_replace(lower(trim(s.supply_label)), '\s+', ' ', 'g') = st.name_canonical),
      st.name
    )
  )
from public.supply_types st
where not exists (
  select 1 from public.audit_log al
   where al.action = 'supply_type.created'
     and al.entity_id = st.id
);
```

> Note: the audit-row INSERT relies on `services` rows reading `supply_label` to resolve `from_label`. Because step 5 drops `services.supply_label`, the audit INSERT must run **before** step 5. The outline above lists step 5 before step 6 — the contract version reorders them to put the audit INSERT immediately after the UPDATE (between steps 3 and 4) so the `from_label` lookup still has a column to read. See `contracts/db-migration.contract.md` for the canonical order.

After this migration is applied, `npx supabase gen types typescript --local > lib/db/types.ts` regenerates the types so `services.Row` no longer has `supply_label`, gains `supply_type_id`, and the new `supply_types` table appears.

---

## 8. Open questions

None. All three spec Clarifications are resolved in the planning artifacts (R1/R2/R3 + Q1/Q2/Q3 in spec). The migration ordering nuance in § 7 above (audit INSERT must precede `drop column`) is internal to the contract and surfaced explicitly there.
