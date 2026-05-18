# Implementation Plan: Supply types catalog + Services refactor

**Branch**: `022-supply-types-catalog` | **Date**: 2026-05-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-supply-types-catalog/spec.md`

## Summary

Promote the free-text `services.supply_label` column (shipped in 021) to a **first-class supply-types catalog** so identical supplies are guaranteed identical via stable ids, renames flow through every consumer, and the future Staff Settings exemption checklist (023) can reference types by id instead of by name.

Three layered deliveries in one feature:

1. **Schema refactor** — migration `0017_supply_types_catalog.sql` creates `public.supply_types`, adds `services.supply_type_id` with a FK to the new table, **backfills** every distinct case-insensitive `supply_label` value into a seeded `supply_types` row, repoints each affected service at its matching type id, **drops `services.supply_label`** in the same migration (per Clarification Q1), and replaces the existing `services_supply_pair_chk` with one that pairs `supply_amount_cents` against `supply_type_id` instead. The migration writes one `supply_type.created` audit row per seeded type with `actor_user_id = null` + a payload-embedded `actor: 'system:migration'` marker (per Clarification Q2 — no `audit_log` schema change required because `actor_user_id` is already nullable; see research § R3).
2. **Edit Policy sheet shell + Supply Types section** — 021 deferred the Edit Policy sheet to Phase 2 and the 022 spec's earlier assumption that the sheet "already exists" was inaccurate (the spec Assumption has been corrected). This feature ships the minimal sheet shell (right-side overlay with scrim, 200ms mount animation, Esc/scrim close, a single "Supply types" section as its only content this phase). The shell adapts `design-system/prototypes/services/EditPolicySheet.jsx` — only the Supply Types section is implemented; the card-fee defaults section and payment-method matrix stay deferred to Phase 2 of the deductions roadmap. A new "Edit policy" button in the services page header is the only entry point.
3. **Supply-type picker on the service edit panel** — the supply sub-row in `<DeductionsSection>` swaps its free-text `<input name="supply_label">` for a `<SupplyTypePicker>` (shadcn Combobox-style): lists active types alphabetically, has an inline "+ Create new supply type…" affordance that calls the new `createSupplyType` Server Action and pre-selects the created type without a full form save, and submits `supply_type_id` (uuid) instead of `supply_label` (text). The FormData field name changes from `supply_label` → `supply_type_id`; the `_validation.ts` validator changes from `validateSupplyLabel` (string ≤ 64) to `validateSupplyTypeId` (UUID shape + the loose 8-4-4-4-12 hex pattern used elsewhere). The DB CHECK constraint changes from pairing amount with a non-empty label to pairing amount with a non-null FK.

Five new / changed Server Actions: `createSupplyType`, `renameSupplyType`, `archiveSupplyType`, `reactivateSupplyType` (in `app/(studio)/settings/policy/actions.ts`, a new route), plus the existing `addService` + `updateService` in `app/(studio)/services/actions.ts` (FormData field swap + validator swap, no structural changes). Each catalog mutation writes an `audit_log` row using a new `supply_type.*` action prefix routed through `recordAudit` (the `AuditAction` TS union and `deriveEntityType` switch grow by one entity type — `entity_type` is plain text in the DB so no schema change there either). Every successful mutation calls `revalidatePath('/services')` AND `revalidatePath('/settings/staff')` to satisfy FR-015 (the latter is forward-looking for 023; harmless today).

The audit log payload for the migration's seeded rows is `{ name, source: 'migration:022', from_label: '<original label>' }` so an operator later asking "where did this type come from?" sees both the canonicalized name AND the original free-text label it was deduped from. Per the spec's revised assumption (`spec.md § Assumptions` line 1), the migration applies through the existing GitHub Actions Supabase pipeline — no manual `supabase db push`.

Constitution gates: all five principles pass (I — every value resolves to a token, no second component library, picker uses shadcn primitives; II — all mutations are Server Actions, RLS unchanged, authorization via `assertCanWriteCatalog` from 008 mirrored for catalog mutations; III — every catalog mutation audited with before/after, migration writes audit rows so SC-007 holds uniformly, no money moved this phase; IV — Vitest for the new validators + the migration's name-canonicalization helper, Playwright spec covers US1–US5 end-to-end; V — scope matches the spec exactly, no per-staff exemptions (023), no checkout wiring (still Phase 3 of deductions roadmap), no payment-method matrix in the sheet).

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 (App Router + RSC + Server Actions). Existing target — no version change.

**Primary Dependencies**: `next`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `lucide-react`, `clsx`, `sonner` (toasts), shadcn/ui primitives in `components/ui/*` (specifically `Popover`, `Command`, `Switch`, `Button` for the picker; `Sheet` for the EditPolicySheet shell), `radix-ui` (already vendored — Combobox is built from `Popover` + `Command`), Lacquer tokens in `styles/tokens.css`. **No new runtime dependencies.** The Combobox is shadcn's standard `Popover + Command` composition; `Sheet` is the existing shadcn primitive used elsewhere (Card-fee policy sheet from prototype, Archive confirmation sheet from 008's `archive-dialog.client.tsx`).

**Storage**: Supabase Postgres. One new migration (`supabase/migrations/0017_supply_types_catalog.sql`) creates `public.supply_types` (id, name, archived, created_at, updated_at, name_canonical generated column for the partial unique index), adds `services.supply_type_id uuid references supply_types(id) on delete restrict`, drops the existing `services_supply_pair_chk` and adds a new one pairing `supply_amount_cents` with `supply_type_id`, drops the `services.supply_label` column, and inserts seeded `supply_types` rows + audit-log rows for the backfill. **One new table**, no new RLS roles (the table grants `select to authenticated using (true)` mirroring `services`), no `audit_log` schema change (see research § R3). The `entity_type = 'supply_type'` value is new in audit_log content but the column is plain text — no migration.

**Testing**: Vitest for the new pure helpers — (a) `canonicalizeName` (trim + lowercase per research § R2) used by both the migration backfill SQL (via inline `lower(trim(name))`) and the app's create/rename validators; (b) `validateSupplyTypeName` (trim + min 2 + max 64 + free Unicode per Clarification Q3); (c) `validateSupplyTypeId` (UUID-loose shape, mirrors the existing `UUID_SHAPE_LOOSE` in `actions.ts`). Playwright `tests/e2e/supply-types-catalog.spec.ts` exercises the five user stories end-to-end against the seeded local Supabase: US1 (pick from picker + inline create), US2 (rename propagates), US3 (archive blocked when in use, succeeds when freed), US4 (usage count + expansion + jump-to-service), US5 (post-migration display invariant). The existing `services-deductions.spec.ts` from 021 is updated to use the picker instead of the free-text input (T0XX in tasks).

**Target Platform**: Vercel (Next.js 16 Fluid Compute by default); browsers used by Tang Nails staff — modern Chrome/Safari on macOS, iPadOS, Windows laptops. Studio tablets (1024×720 primary) are the responsive floor. The EditPolicySheet collapses gracefully on narrower viewports (the shell is right-aligned with a `min(440px, 100vw - 16px)` width matching the prototype).

**Project Type**: Web application (single Next.js project at repo root — `app/`, `components/`, `lib/`, `styles/`, `tests/`, `supabase/migrations/`).

**Performance Goals**:
- **Picker open**: dropdown renders within 100ms of click on a catalog of ≤50 types (single `select ... order by name` against the table). The list query is fetched per page-render via the RSC `loadCatalog()` helper (not per-keystroke) — the Combobox filters client-side.
- **Inline create**: Server Action round-trip completes within the 008 budget (one `INSERT` + one `recordAudit` insert; no additional queries). The picker pre-selects the new type from the action's redirect param without re-fetching the catalog.
- **Catalog list paint**: unchanged from 021. The new `services` query joins `supply_types` via a single LEFT JOIN to resolve the name for the chip — adds ≤1ms to the existing query.
- **EditPolicySheet open**: 220ms entry animation (already in the prototype, mirrors 008's `archive-dialog` animation budget).

**Constraints**:
- Every visual value resolves to a Lacquer token (Constitution I). No raw hex, no off-scale spacing, no font weight outside 400/500/600, no emoji in chrome. The picker dropdown uses `--popover` / `--popover-foreground` / `--accent` / `--border` tokens; the sheet uses `--background`, `--card`, `--muted`, `--border`, `--ring` — all already in `styles/tokens.css`.
- All writes flow through Server Actions; the kiosk JWT has no policy on `supply_types` (Constitution II).
- Every successful catalog mutation writes an `audit_log` row with before/after where applicable (Constitution III). Per Clarification Q2 the backfill migration writes one `supply_type.created` row per seeded type (with the system actor marker in payload), so SC-007 holds uniformly.
- Authorization mirrors 021: only `owner` or `manager` may mutate. Non-privileged operators see disabled controls with the existing "Only owners and managers can edit the catalog." tooltip from 008 (`owner-only-tooltip.tsx`).
- Migration applied via the existing GitHub Actions (`db-migrate-preview.yml` on PR; `db-migrate-prod.yml` on push to `main`). **No manual `supabase db push`** (Constitution v1.0.3 "Schema drift forbidden").
- Name validation: trim, min 2, max 64, free Unicode, case-insensitive uniqueness across active types — matches the existing `services.name` minimum and the prior 021 `supply_label` cap (Clarification Q3).
- The migration is **transactional** (all-or-nothing) — Supabase CLI's `db push` wraps each migration file in a single transaction by default, so either every step (table create, FK add, backfill, label drop, audit rows) commits together or none does. The plan does not depend on any one step landing in isolation.
- No new currency precision: amounts remain integer cents end-to-end.
- Animation budget unchanged: 200ms sheets (sheet entry), 150ms hover/press (picker option highlight).

**Scale/Scope**: Single salon. Expected supply-types catalog size ≤30 types (production sample today: ~6 distinct labels in 021). ≤100 services. ≤10 concurrent operator devices. Scope of this feature:
- 1 new migration (`0017_supply_types_catalog.sql`) — 1 new table + 1 new column on services + 1 new CHECK + 1 dropped CHECK + 1 dropped column + backfill INSERTs + audit-log INSERTs.
- 1 new route — `app/(studio)/settings/policy/` (page + actions + load helper). The route is reached only via the "Edit policy" button in the services page header; there is no sidebar entry (Phase-2 deductions roadmap will add one when the card-fee section ships).
- 1 modified Server Action file — `app/(studio)/services/actions.ts` (FormData field swap `supply_label` → `supply_type_id`, validator swap).
- 1 modified validator file — `app/(studio)/services/_validation.ts` (delete `validateSupplyLabel` + `invalid_supply_label` + `supply_label_too_long`; add `validateSupplyTypeId` + `invalid_supply_type` error code).
- 1 modified types file — `app/(studio)/services/_types.ts` (replace `supply_label: string | null` with `supply_type_id: string | null` + a denormalized `supply_type_name: string | null` resolved on read via the JOIN; the latter is read-only and never round-trips through FormData).
- 1 modified load helper — `app/(studio)/services/_load.ts` (extend the catalog query to LEFT JOIN supply_types and project the name; mirror in `loadServiceWithAssignments`).
- 1 modified audit-diff file — `app/(studio)/services/_audit-diff.ts` (rename `supply_label` key → `supply_type_id` in `SERVICE_DIFF_KEYS`; the diff machinery is otherwise unchanged).
- 1 modified format helper — `app/(studio)/services/_format.ts` (the supply chip text now takes a resolved name string instead of the raw label column).
- 1 modified UI client — `components/lacquer/services/deductions-section.client.tsx` (swap the free-text `<input name="supply_label">` for the new `<SupplyTypePicker>` client component; same hidden-FormData wiring pattern, the picker emits a hidden `<input name="supply_type_id">` when supply is on).
- 4 new UI files in `components/lacquer/services/`:
  - `supply-type-picker.client.tsx` — Combobox-style picker (Popover + Command) with inline create row; consumes the catalog list as a prop.
  - `edit-policy-sheet.client.tsx` — sheet shell (mount animation, scrim, Esc/scrim close); renders the Supply Types section as its only child.
  - `supply-types-section.client.tsx` — the section card; rename inline, archive with usage-count blocker, expand to see referencing services, jump-to-service.
  - `edit-policy-button.tsx` — the page-header button that opens the sheet (server component; uses a small `<EditPolicyTrigger>` client island to manage the open state).
- 1 modified page header — `components/lacquer/services/page-header.tsx` (mount the new "Edit policy" button next to "Add service"; gated by `assertCanWriteCatalog` so technicians see a disabled button with the same tooltip pattern).
- 1 modified studio page — `app/(studio)/services/page.tsx` (mount the EditPolicySheet root + pass the supply-types catalog list and services-by-type map to it).
- 1 modified recordAudit helper — `lib/auth/audit.ts` (extend the `AuditAction` union with 4 new verbs `supply_type.{created,renamed,archived,reactivated}`; extend `deriveEntityType` to return `'supply_type'` for `action.startsWith('supply_type.')`).
- 1 modified CSS file — `styles/settings.css` (append `.supply-type-picker*`, `.edit-policy-sheet*`, `.supply-types-section*`, `.supply-types-row*` selectors — every value resolves to a token).
- 6–8 new Vitest specs (validators, name canonicalization, audit-diff key swap).
- 1 new Playwright spec (`tests/e2e/supply-types-catalog.spec.ts` covering US1–US5).
- 1 updated Playwright spec (`tests/e2e/services-deductions.spec.ts` — change supply assertions from text input to picker selection).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | ✅ Pass | Every visual value resolves to a token in `styles/tokens.css`. The EditPolicySheet shell adapts `design-system/prototypes/services/EditPolicySheet.jsx` — only the Supply Types section is implemented; everything else stays deferred to Phase 2 of the deductions roadmap. The picker is a shadcn `Popover + Command` Combobox composition (no second component library); the sheet uses the existing shadcn `Sheet` primitive. Icons stay Lucide (`Box`, `Plus`, `Check`, `ArrowRight`, `X`) sized 12/14/16, 1.5px stroke. The supply-type id chip in the section header uses `--muted` background + `--muted-foreground` text (already declared). The picker's selected check icon uses `--primary` per shadcn defaults. Acceptance includes a side-by-side compare against the EditPolicySheet prototype's Supply Types section as the last step before final gate. The 021 `archive-dialog.client.tsx` and `discard-changes-dialog.client.tsx` are unchanged and untouched. |
| **II. Server-Authoritative Architecture** | ✅ Pass | All reads on `/services` and `/settings/policy` continue via `createSupabaseServerClient()` from Server Components. Mutations: existing `addService` + `updateService` extended with the FormData-field swap; four new Server Actions in `app/(studio)/settings/policy/actions.ts` for catalog mutations. Each new action's role gate is `assertCanWriteCatalog(viewer.staff.role)` — mirroring 008/021 (owner OR manager). Client islands hold form/draft state only; they never write to the DB. The kiosk JWT has no policy on `supply_types` (mirrors `services`). The picker's inline-create flow calls `createSupplyType` as a Server Action and receives the new type's id back via the action's redirect param — the picker doesn't re-fetch the catalog from the client side. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | ✅ Pass — partial scope | No money moves in this feature (catalog-only; checkout wiring stays Phase 3 of the deductions roadmap per spec Assumptions). The audit obligation: (a) extend `AuditAction` with `supply_type.{created,renamed,archived,reactivated}` and `deriveEntityType` to return `'supply_type'` for the prefix; (b) every catalog mutation awaits `recordAudit` before `revalidatePath` + `redirect`, matching the 008/021 prelude exactly; (c) per Clarification Q2 the backfill migration writes one `supply_type.created` audit row per seeded type using a direct `INSERT INTO audit_log` with `actor_user_id = null` + `acting_as_staff_id = null` + payload `{ name, source: 'migration:022', from_label }`. SC-007 ("no catalog mutation succeeds without a corresponding audit row") holds uniformly. The `service.updated` payload's `before`/`after` snapshots swap `supply_label: string \| null` for `supply_type_id: uuid \| null` (the resolved name is NOT in the audit — the type id is the durable identifier; renames are a separate `supply_type.renamed` event with its own before/after `name` values). |
| **IV. Test-First for Critical Paths** | ✅ Pass — partial scope | Per Principle IV, TDD-with-failing-tests is mandatory for money/auth/refund/cash-drawer/tip-allocation/audit logic. This feature touches **audit logic** (new `supply_type.*` verbs + the migration's seeded rows) — the audit assertions in the Playwright spec land BEFORE the implementation that satisfies them (the spec scaffolds `tests/e2e/supply-types-catalog.spec.ts` with audit-row assertions in Phase 2 of the tasks file). Vitest unit tests for the three new pure helpers (`canonicalizeName`, `validateSupplyTypeName`, `validateSupplyTypeId`) and the `buildChanges` extension (which now diffs `supply_type_id` instead of `supply_label`). All tests run in CI on every PR. |
| **V. Scope Discipline & Cost Restraint** | ✅ Pass | Scope matches the spec exactly. Explicit out-of-scope items stay deferred: (1) per-staff exemptions against supply types — 023; (2) wiring deductions into checkout / receipts / EOD cash / payouts — Phase 3 of deductions roadmap; (3) the card-fee defaults section, payment-method matrix, and any other content of the EditPolicySheet beyond the Supply Types section — Phase 2 of deductions roadmap; (4) the `from_label` payload field on seeded audit rows is migration-only, not a structural surface for normal operations. No new infrastructure, no new paid services, no new dependencies — one new small table on the Supabase free tier, well inside the ~$25–45/mo envelope. |

**Gate result: PASS — proceed to Phase 0.** No violations to justify; Complexity Tracking table is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/022-supply-types-catalog/
├── plan.md                              # This file
├── spec.md                              # Already written (/speckit-specify + /speckit-clarify)
├── research.md                          # Phase 0 — decisions + rationale
├── data-model.md                        # Phase 1 — schema delta, types, validators, transitions, migration outline
├── quickstart.md                        # Phase 1 — how to run, verify, and visually compare
└── contracts/
    ├── README.md                        # Index across the four contracts
    ├── db-migration.contract.md         # 0017 table create + column add + backfill + drop + audit-log INSERT shape
    ├── server-actions.contract.md       # 4 new catalog actions + extended addService/updateService FormData keys + error codes
    ├── audit-payload.contract.md        # `supply_type.*` payload shapes + service.* diff-key swap
    └── ui.contract.md                   # EditPolicySheet shell behavior + SupplyTypePicker state machine + SupplyTypesSection vocab
```

### Source Code (repository root)

The repo is a single Next.js 16 App Router project at the root. This feature adds and edits the following:

```text
supabase/
└── migrations/
    └── 0017_supply_types_catalog.sql                # NEW — create supply_types, add services.supply_type_id, backfill, drop services.supply_label, write audit rows for seeded types

lib/
├── auth/
│   └── audit.ts                                     # EDIT — extend AuditAction with supply_type.{created,renamed,archived,reactivated}; extend deriveEntityType for the 'supply_type' prefix
└── policy/
    └── canonicalize-name.ts                         # NEW — pure helper: canonicalizeName(s) = s.trim().toLowerCase().replace(/\s+/g, ' ') (consumed by app validators and re-implemented in SQL for the migration backfill)

app/
└── (studio)/
    ├── services/
    │   ├── page.tsx                                  # EDIT — mount <EditPolicySheet> + pass supply_types catalog + services-by-type map
    │   ├── actions.ts                                # EDIT — swap supply_label FormData key → supply_type_id; swap validator
    │   ├── _load.ts                                  # EDIT — extend catalog query with LEFT JOIN supply_types; expose supply_type_id + supply_type_name
    │   ├── _types.ts                                 # EDIT — replace supply_label with supply_type_id + supply_type_name (read-only)
    │   ├── _validation.ts                            # EDIT — delete validateSupplyLabel + 2 error codes; add validateSupplyTypeId + 1 error code
    │   ├── _audit-diff.ts                            # EDIT — swap supply_label key for supply_type_id in SERVICE_DIFF_KEYS + the snapshot shape
    │   ├── _format.ts                                # EDIT — supply chip text now takes the resolved name string (not the raw column)
    │   ├── _deductions.ts                            # KEEP — unchanged (no math change)
    │   ├── _diff.ts                                  # KEEP — unchanged
    │   ├── _filter.ts                                # KEEP — unchanged
    │   ├── _sort.ts                                  # KEEP — unchanged
    │   ├── permissions.ts                            # KEEP — unchanged (assertCanWriteCatalog covers all field writes)
    │   └── toasts.ts                                 # EDIT — add toast keys: supply_type_created, supply_type_renamed, supply_type_archived, supply_type_reactivated
    └── settings/
        └── policy/
            ├── actions.ts                            # NEW — createSupplyType, renameSupplyType, archiveSupplyType, reactivateSupplyType
            ├── _load.ts                              # NEW — loadSupplyTypesCatalog(): list + per-type usage counts (single query w/ count(*) FILTER)
            ├── _validation.ts                        # NEW — validateSupplyTypeName, validateSupplyTypeId, plus 3 new ValidationErrorCode values
            └── permissions.ts                        # NEW — reuses assertCanWriteCatalog via re-export from services/permissions.ts (no policy duplication)

components/
└── lacquer/
    └── services/
        ├── deductions-section.client.tsx             # EDIT — swap supply <input name="supply_label"> for <SupplyTypePicker>
        ├── supply-type-picker.client.tsx             # NEW — Combobox (Popover + Command) with inline "+ Create new supply type…" row; calls createSupplyType
        ├── edit-policy-sheet.client.tsx              # NEW — sheet shell (mount animation, scrim, Esc/scrim close); renders SupplyTypesSection
        ├── edit-policy-button.tsx                    # NEW — server component wrapper for the page-header trigger; gates on assertCanWriteCatalog
        ├── supply-types-section.client.tsx           # NEW — inline rename, archive blocker, expand-to-services, jump-to-service
        ├── page-header.tsx                           # EDIT — mount <EditPolicyButton> next to "Add service"
        ├── catalog-row.tsx                           # KEEP — DeductionChips already accepts a resolved name string (no change to chip rendering)
        ├── catalog-list.client.tsx                   # KEEP — unchanged
        ├── edit-panel.client.tsx                     # KEEP — unchanged (the change is inside DeductionsSection)
        ├── service-form.client.tsx                   # KEEP — unchanged (passes through to DeductionsSection)
        ├── archive-dialog.client.tsx                 # KEEP — unchanged
        ├── discard-changes-dialog.client.tsx        # KEEP — unchanged
        ├── empty-state.tsx                           # KEEP — unchanged
        ├── owner-only-tooltip.tsx                    # KEEP — reused by the EditPolicyButton + SupplyTypesSection controls
        └── services-toaster.client.tsx              # KEEP — unchanged (URL-toast bridge picks up the new keys automatically via toasts.ts)

styles/
└── settings.css                                       # EDIT — append .supply-type-picker*, .edit-policy-sheet*, .supply-types-section*, .supply-types-row* selectors. Every value resolves to a token.

tests/
├── unit/
│   ├── services/
│   │   ├── validation.test.ts                        # EDIT — drop supply_label cases; add validateSupplyTypeId cases (UUID-loose shape)
│   │   └── audit-diff-keys.test.ts                  # EDIT — assert SERVICE_DIFF_KEYS now contains supply_type_id (not supply_label)
│   └── policy/
│       ├── canonicalize-name.test.ts                # NEW — covers trim, lowercase, internal-whitespace collapse, Unicode
│       └── validation.test.ts                        # NEW — validateSupplyTypeName (min/max/empty/trim) + validateSupplyTypeId
└── e2e/
    ├── supply-types-catalog.spec.ts                  # NEW — US1 (picker + inline create), US2 (rename propagates), US3 (archive blocker), US4 (usage count + jump), US5 (post-migration display)
    └── services-deductions.spec.ts                   # EDIT — change supply assertions from text input to picker selection (preserves the US3 from 021)

CLAUDE.md                                              # EDIT (auto by Phase 1 step 3) — update SPECKIT block to point at this plan
```

**Structure Decision**: Single Next.js project (Option 1 — DEFAULT for this repo, established in 001 and reused by every feature since 006). This feature introduces **one new route** (`app/(studio)/settings/policy/`) housing the catalog Server Actions, and **extends** the 008/021 file tree everywhere else — same `_validation.ts` / `_types.ts` / `_load.ts` private-helper pattern, same Server-Action prelude, same URL-toast bridge, same `components/lacquer/services/*` namespace for picker + sheet (because the surfaces are reached from the services page, not from a standalone settings sub-page in this phase). The new route lives under `settings/policy/` (rather than `settings/supply-types/`) so it can absorb the rest of the EditPolicySheet's policy content when Phase 2 of the deductions roadmap ships, without a second rename. The page itself (`app/(studio)/settings/policy/page.tsx`) is not created in this feature — the actions file exists as an isolated Server Actions module that the services page's EditPolicySheet imports directly. When Phase 2 lands and the route needs its own page (e.g., for a deep-link target or a sidebar entry), the page can be added without touching the actions file.

## Complexity Tracking

No constitution violations to justify. Table intentionally omitted.
