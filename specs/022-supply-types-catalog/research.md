# Phase 0 — Research: Supply types catalog

**Feature**: `022-supply-types-catalog` · **Date**: 2026-05-17

Decisions made during planning to resolve open questions and document non-obvious tradeoffs. Each entry is one decision; rationale and alternatives are explicit so reviewers can challenge them in isolation.

The three Clarifications recorded in `spec.md § Clarifications · Session 2026-05-17` (drop `supply_label` after backfill; backfill migration writes audit rows with a system actor; name validation matches `services.name` + the prior `supply_label` cap) are the **inputs** to this research, not decisions made here.

---

## R1 — Case-insensitive uniqueness mechanism: partial unique index on a generated column

**Decision**: Add a `name_canonical text generated always as (lower(trim(name))) stored` column on `supply_types`, then create a **partial unique index** on `name_canonical where archived = false`. The application also calls `canonicalizeName(s)` (lib/policy/canonicalize-name.ts) before comparing names client-side, but the database is the authority — the unique index is the one that rejects races.

**Rationale**:

- The spec requires case-insensitive uniqueness **across active types only** (Edge Case: "Rename collides with an archived type's name → allowed; archived types are excluded from the uniqueness constraint"). The partial index expresses this exactly: `unique (name_canonical) where archived = false`.
- A generated column is preferred over `unique (lower(trim(name)))` (function-based unique index) because:
  - Generated columns are stored, so the partial index has a real column to index — Postgres's planner reasons about it as a normal `b-tree` index on `text`.
  - The canonical form is visible in `select` output, useful for debugging operator collisions.
  - `lower(trim(...))` in the index definition is also fine but pushes the canonicalization logic into the index alone; making it a column lets the app read the same canonical value without recomputing.
- `stored` (rather than `virtual`) is required because Postgres only supports unique indexes on stored generated columns (as of PG 15+ on Supabase).

**Alternatives considered**:

- **Function-based unique index**: `create unique index supply_types_name_active_uq on supply_types (lower(trim(name))) where archived = false`. Works, but the canonical value is invisible in `select *` output — debugging collisions requires re-running `lower(trim(name))` in the query. Rejected on operator-ergonomics grounds.
- **Application-only uniqueness check**: SELECT first, then INSERT. Loses the race per the spec's Edge Case "Two operators race to create a supply type with the same name simultaneously" — the database invariant is what guarantees one wins.
- **CITEXT column**: Postgres ships a case-insensitive text type. Heavier than necessary for one column; Supabase doesn't enable the extension by default and adding extensions to managed Supabase requires a dashboard step the GitHub Actions pipeline doesn't perform. Rejected on scope-discipline grounds.

**Implementation note**: the SQL is documented in `contracts/db-migration.contract.md § 1`. The app's `canonicalizeName` helper (R2) mirrors the SQL `lower(trim(...))` semantics exactly so client-side soft-hint checks (US1 AC3, US2 AC4) match what the DB will enforce.

---

## R2 — Name canonicalization: `lower(trim(name))` with internal whitespace collapse

**Decision**: `canonicalizeName(s: string): string` returns `s.trim().toLowerCase().replace(/\s+/g, ' ')`. The migration backfill SQL uses the equivalent `regexp_replace(lower(trim(supply_label)), '\s+', ' ', 'g')` for deduping. The DB's `name_canonical` generated column is `lower(trim(name))` — **without** internal collapse — and the app validator collapses whitespace **before** insert/update so the stored `name` is already canonical (re. internal whitespace).

**Rationale**:

- Clarification Q3 settled the name validation rules: trim + min 2 + max 64 + free Unicode. Internal whitespace collapse (so `"GelX  tips"` and `"GelX tips"` dedupe) was implied by "trim leading/trailing whitespace" but worth pinning down explicitly here because the migration backfill must apply the **same** rule to legacy labels.
- The DB's generated column intentionally does NOT include `regexp_replace` — keeping it as `lower(trim(...))` makes the index function-simple and fast. The app layer collapses internal whitespace before submitting to the DB, so by the time `name_canonical` is computed there's nothing left to collapse.
- The migration applies `regexp_replace` in its backfill query because legacy `supply_label` strings may have double-spaces that operators typed manually — the canonicalization must match what new inserts will produce.

**Alternatives considered**:

- **No internal collapse** — `"GelX  tips"` and `"GelX tips"` would be considered different. Bad operator UX (two visually-identical types in the picker dropdown); rejected.
- **NFC Unicode normalization** in addition to lowercase — overkill for this scale and risks under-deduping when an operator's keyboard produces precomposed accented characters vs. decomposed ones. Defer until production sees a real collision; not worth the dependency on `String.prototype.normalize` semantics across runtimes.
- **Locale-aware lowercase** (`toLocaleLowerCase('tr')`) — Turkish dotted/dotless I would change behavior. Postgres's `lower()` is locale-aware per the DB collation (`en_US.UTF-8` for Supabase by default); the JS `toLowerCase()` is locale-independent. Diverging is fine because the DB's index is the authority; the app's check is a soft hint. Documented here as a known minor divergence — operator-visible behavior is identical for ASCII names (the entire production sample).

**Implementation note**: a Vitest spec covers `canonicalizeName("  GelX  tips & gel  ")` → `"gelx tips & gel"` and a handful of Unicode cases (`"Café"` → `"café"`, NOT `"cafe"`).

---

## R3 — Migration's audit-log writes: no schema change needed; use null FK columns + payload-encoded actor marker

**Decision**: The migration writes audit-log rows directly via `INSERT INTO public.audit_log (...)` with `actor_user_id = NULL`, `acting_as_staff_id = NULL`, `entity_type = 'supply_type'`, `entity_id = <new uuid>`, `action = 'supply_type.created'`, and `payload = jsonb_build_object('name', name, 'source', 'migration:022', 'from_label', from_label)`. **No `audit_log` schema change is required.**

**Rationale**:

- Spec Clarification Q2 settled that the migration writes audit rows with a system actor. The follow-up question — how to represent that actor when `audit_log` has no obvious "system" channel — was hedged in the spec Assumption ("If the existing `audit_log` schema lacks a non-FK actor channel, the migration adds the minimum surface needed").
- Reading the schema (`supabase/migrations/0001_auth_schema.sql:42-53`) settles it: `actor_user_id uuid` is nullable (no `not null` constraint), `acting_as_staff_id uuid references public.staff(id) on delete set null` is also nullable. **Both FK columns being NULL is the existing semantics for a device/system-level event** (the helper's source comment at `lib/auth/audit.ts:32-37` already documents this for "device-level events"). The migration just uses that semantic explicitly.
- The `actor = 'system:migration'` marker lives in `payload.source = 'migration:022'` rather than a new column. Adding `actor_label text` would be the alternative but a column added solely for one-time migration rows is not justified — operators looking at the audit log can filter on `payload->>'source' = 'migration:022'` (or on `action = 'supply_type.created' AND actor_user_id IS NULL` more loosely).
- This avoids any risk of an `audit_log` schema migration colliding with audit logic in other in-flight branches (every feature touches audit; an additive column is conservative but still a coordination cost).

**Alternatives considered**:

- **Add a `actor_label text` column to audit_log**: clean but a coordination tax. If a future feature needs a non-FK actor channel for a recurring use case (e.g., cron jobs, webhooks) it can be added then with a clearer cost/benefit story.
- **Encode the system marker in `action`** (e.g., `system.supply_type.created`): breaks the prefix-based `deriveEntityType` dispatch; would require changing the helper to handle the prefix specially. Worse ergonomics for a one-time event.
- **Skip the audit rows entirely** (the alternative the user explicitly rejected in Clarification Q2): would violate SC-007's "no catalog mutation succeeds without an audit row" invariant for the seeded types.

**Operator-side query examples**:

```sql
-- "Where did this type come from?"
select payload from public.audit_log
 where entity_type = 'supply_type'
   and entity_id = '<type id>'
   and action = 'supply_type.created'
 order by ts asc
 limit 1;

-- "Show me all types that were seeded by the migration."
select entity_id, payload->>'name' as name, payload->>'from_label' as from_label
 from public.audit_log
 where action = 'supply_type.created'
   and payload->>'source' = 'migration:022';
```

**Implementation note**: the migration's audit-log INSERT is a single `insert into audit_log (...) select 'supply_type.created', null, null, 'supply_type', id, jsonb_build_object(...) from inserted_types` chained off the supply-types backfill. The shape is locked into `contracts/db-migration.contract.md § 4` so a reviewer can verify it without reading the SQL.

---

## R4 — Picker UX: shadcn Combobox (Popover + Command) with inline-create row

**Decision**: The supply-type picker is a standard shadcn Combobox composition — `Popover` for the dropdown panel, `Command` (cmdk-style) for the searchable list, a fixed `CommandItem` at the bottom rendering "+ Create new supply type…" that triggers the inline-create flow. The picker emits a hidden `<input name="supply_type_id">` so the existing FormData-submission path is unchanged.

**Rationale**:

- This is the canonical shadcn pattern for "select-from-a-list-or-create-new" and matches the prototype's UX (`design-system/prototypes/services/EditPolicySheet.jsx` lines 484–548 use the same inline-create + list pattern in the SupplyTypesSection itself).
- `Command` ships built-in keyboard navigation (arrow up/down, Enter to select, type-to-filter) — required by the spec's "alphabetical with inline + at bottom" affordance (FR-009).
- Using shadcn `Popover` + `Command` rather than a one-off Combobox keeps the dependency surface flat — both primitives are already vendored in `components/ui/*` (per CLAUDE.md design-system rule 3: "no second component library"). Verified by grepping the existing surface; both are present.
- The inline-create flow is a `<form>` with a single text input and a Save button. On submit it calls `createSupplyType` (Server Action) directly from the picker. The action returns the new type id; the picker uses that to select the row immediately (no re-fetch needed because the picker's catalog list is rebuilt by the page's RSC on next render — the picker just merges the new row optimistically into its local state for the duration of the panel session).

**Alternatives considered**:

- **Native `<select>` + a separate "Add new" button**: poor mobile UX, no type-ahead, doesn't match prototype.
- **Headless UI Combobox**: not part of the project's component vocab; would violate CLAUDE.md rule 3.
- **Custom dropdown built from scratch**: reinvents what `Command` already does (keyboard nav, filter, ARIA), and the existing `archive-dialog.client.tsx` from 008 already proves `Popover` works correctly for the project's overlay needs.

**Implementation note**: the picker component is `components/lacquer/services/supply-type-picker.client.tsx`; it's a client island so it can hold the open/selected state and the inline-create draft. Its props are `{ types: SupplyTypeLite[]; selectedId: string | null; onSelect: (id: string) => void; disabled?: boolean }`. The hidden FormData input is emitted by the picker, not by `<DeductionsSection>` — keeps the picker self-contained.

---

## R5 — Catalog read pattern: single LEFT JOIN at the existing load query

**Decision**: Extend `loadCatalog()` in `app/(studio)/services/_load.ts` to add `LEFT JOIN public.supply_types st ON st.id = services.supply_type_id` and project `st.name AS supply_type_name`. The catalog row's `supply_type_id` and `supply_type_name` are both available everywhere services are read. The Edit Policy sheet's Supply Types section uses a separate `loadSupplyTypesCatalog()` helper that returns `{ id, name, archived, usage_count, services: ServiceLite[] }` per row — single query joining `supply_types` to `services` aggregated by `count(*) filter (where active)` and `array_agg(services.id, services.name, services.color_token, services.supply_amount_cents)`.

**Rationale**:

- The single LEFT JOIN keeps the catalog query at one round-trip (matches 008/021's performance budget). The picker on the edit panel reads `supply_types` via `loadSupplyTypesCatalog()` — a second query at page-render time, ≤30 rows, negligible.
- The EditPolicySheet section needs both per-type usage counts AND the per-type service list (for the expansion sub-rows in US4). `array_agg` with `count(*) filter` gives both in a single round-trip — Supabase's `supabase-js` doesn't expose `array_agg` directly but the equivalent query can run via `supabase.rpc('list_supply_types_with_usage')` (a Postgres function defined in the migration) OR via two parallel queries (`select supply_types ...` + `select supply_type_id, count(*) ... group by supply_type_id`). Picked the **two parallel queries** approach because it avoids a new function definition in the migration (the queries fan out at the JS layer in `_load.ts`).
- Archived types appear in the section but NOT in the picker — the picker filters `where archived = false` at the JS layer (the catalog list is shared across both surfaces; one fetch, two views).

**Alternatives considered**:

- **RPC function** (`list_supply_types_with_usage`): cleaner single round-trip, but adds a function definition the migration must maintain. Two parallel queries are cheaper to maintain at this scale.
- **N+1 query in JS** (load types, then count for each): trivially worse than aggregated counts; rejected.

**Implementation note**: `loadSupplyTypesCatalog()` lives in `app/(studio)/settings/policy/_load.ts`. The services page imports it directly to render the section. Its result type is documented in `data-model.md § 2.2`.

---

## R6 — Revalidation path set: both `/services` and `/settings/staff`

**Decision**: Every successful catalog mutation calls both `revalidatePath('/services')` AND `revalidatePath('/settings/staff')`. The latter does not yet read supply types (`/settings/staff` is feature 006, untouched by 022 — the per-staff exemptions for supply types ship in 023), but the revalidation is harmless today and removes the coupling between 022 and 023.

**Rationale**:

- FR-015 mandates it explicitly: "Every catalog mutation that changes the visible name or active status of a type MUST cause both `/services` and `/settings/staff` to revalidate so dependent pages see the change on next render."
- `revalidatePath` is a Next.js cache-invalidation primitive — calling it on a path that doesn't currently read the data is a no-op at render time (the page re-renders with no observable change). Cost: a single in-memory cache flag flip per call. Negligible.
- This way, when 023 ships the per-staff exemption checklist on `/settings/staff` that reads from `supply_types`, the revalidation is already wired and 023 only has to add the reader — no re-touching of 022's actions.

**Alternatives considered**:

- **Defer the `/settings/staff` revalidation until 023 ships its reader**: would require 023 to revisit every supply-types Server Action and add the call. Worse, easy to forget.
- **Use `revalidateTag('supply_types')` everywhere**: cleaner long-term, but the existing 008/021 surfaces already use `revalidatePath` exclusively. Mixing strategies adds confusion. If a future feature consolidates on tags, both paths can be flipped together.

**Implementation note**: a tiny helper `revalidateSupplyTypeConsumers()` in `app/(studio)/settings/policy/actions.ts` calls both `revalidatePath` calls. Each catalog mutation calls the helper once before its `redirect`.

---

## R7 — `services.supply_type_id` FK behavior: `ON DELETE RESTRICT`

**Decision**: `services.supply_type_id uuid references public.supply_types(id) on delete restrict`.

**Rationale**:

- Archive (`archived = true`) is the user-facing equivalent of deletion in this catalog — actual `DELETE FROM supply_types` is not a supported operation. RESTRICT defends against a future bug or manual operator query that would try to delete a referenced type and silently null out service rows.
- The spec already enforces "cannot archive a type with active references" at the application layer (FR-007). RESTRICT at the FK layer is defense-in-depth: if some path skips the app check, the DB still refuses to break the reference.
- `SET NULL` would turn a defensive-delete bug into silent data loss; rejected.
- `CASCADE` would delete the services along with the type — catastrophic; rejected.

**Implementation note**: documented in `contracts/db-migration.contract.md § 1.2`.

---

## R8 — `supply_types` RLS posture: mirror `services`

**Decision**: `select to authenticated using (true)`; no `insert`/`update`/`delete` policies (writes go via the service-role client, same as `services`). The kiosk JWT has no policy on `supply_types`.

**Rationale**:

- Mirrors the existing `services` table pattern exactly (`supabase/migrations/0003_services_catalog.sql`). Operators must be able to read the catalog to render the picker; mutations go through Server Actions which use the service-role client to bypass RLS.
- The kiosk surface (per Constitution II) has no business reading or writing the supply-types catalog — the kiosk only inserts `walk_ins` rows. Omitting any kiosk policy means the JWT can't `select supply_types` at all, which is correct.

**Alternatives considered**: none — the pattern is established and the constitution is explicit.

**Implementation note**: documented in `contracts/db-migration.contract.md § 1.4`.

---

## R9 — EditPolicySheet shell scope this phase

**Decision**: Ship the sheet shell (mount animation, scrim, Esc/scrim close, internal scroll, header with title + close button) but render ONLY the Supply Types section as content. The card-fee defaults section, payment-method matrix, exempt-tech list, and category-defaults grid from the prototype stay deferred to Phase 2 of the deductions roadmap.

**Rationale**:

- The 022 spec's revised Assumption (see `spec.md § Assumptions`) calls this out: "This feature therefore ships **both** (a) the minimal Edit Policy sheet shell … and (b) the 'Supply types' section inside it. The card-fee defaults section, payment-method matrix, and other Phase-2 policy content stay deferred; the sheet renders only the Supply Types section in this feature."
- The shell is small and stable — a `Sheet` primitive (already in `components/ui/sheet.tsx`), a scrim, a header, a scrollable body. Implementing it now means Phase 2 of the deductions roadmap can add the other sections as additional `<section>` children without re-architecting the shell.
- Reusing the same right-side-sheet pattern from the prototype keeps the visual language consistent — the operator's "go to /services, click Edit policy, edit a thing" mental model works for both this feature and the Phase-2 follow-ups.

**Alternatives considered**:

- **Skip the sheet — put the Supply Types section on a standalone `/settings/policy` page**: would violate the spec's assumption that the policy lives in a sheet on the services page. Also worse UX — operators don't think of supply-type management as a separate destination.
- **Inline the Supply Types section directly on the services page** (no sheet): clutters the page; the section needs the "click to manage" affordance the sheet provides.

**Implementation note**: the shell is `components/lacquer/services/edit-policy-sheet.client.tsx`; it accepts `{ open, onOpenChange, children }` props and just renders the standard shadcn `Sheet` with the Tang Nails sheet animation tokens.

---

## Decisions Summary

| # | Decision | Where enforced |
|---|---|---|
| R1 | Partial unique index on generated `name_canonical` column, filtered to `archived = false` | DB (migration 0017) |
| R2 | `canonicalizeName(s) = trim + lower + collapse-whitespace`; SQL backfill uses `regexp_replace(lower(trim(...)), '\s+', ' ', 'g')` | App (`lib/policy/canonicalize-name.ts`) + migration SQL |
| R3 | Migration writes audit rows with `actor_user_id = NULL` + `payload.source = 'migration:022'`; no schema change | Migration SQL |
| R4 | Picker = shadcn `Popover` + `Command` Combobox with inline-create `CommandItem` at bottom | `components/lacquer/services/supply-type-picker.client.tsx` |
| R5 | Single LEFT JOIN at `loadCatalog`; two parallel queries for the section's per-type usage data | `app/(studio)/services/_load.ts` + `app/(studio)/settings/policy/_load.ts` |
| R6 | Every catalog mutation revalidates both `/services` and `/settings/staff` | `revalidateSupplyTypeConsumers()` helper |
| R7 | `services.supply_type_id … on delete restrict` | DB |
| R8 | `supply_types` RLS = `select to authenticated`; no insert/update/delete policies | DB |
| R9 | EditPolicySheet shell ships with only the Supply Types section as content this phase | `components/lacquer/services/edit-policy-sheet.client.tsx` |

All Phase 0 unknowns resolved. Proceed to Phase 1 — Design & Contracts.
