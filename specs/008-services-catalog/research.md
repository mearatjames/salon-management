# Phase 0 — Research: Services catalog (top-level /services)

**Feature**: `008-services-catalog` · **Date**: 2026-05-15

This document records the technical decisions that resolve every open question raised by the spec + the clarification session. There are no NEEDS CLARIFICATION markers left to dispatch — the spec was tightened through five clarification rounds before planning began. The decisions below either restate clarifications in implementation terms or pin down implementation-level choices that the spec correctly deferred to the plan.

Each entry follows: **Decision** · **Rationale** · **Alternatives considered**.

---

## R1. `services.price_cents` is non-null; variable-price services store `price_from_cents` (or 0) in it

**Decision**: `services.price_cents` is declared `not null integer check (price_cents >= 0)`. For variable-price services it stores `price_from_cents` if set, otherwise `0`. The boolean `variable_price` flag is the sole signal that downstream consumers (this page's catalog row formatter; later, the calendar tile and checkout) use to render "From $X", "$X – $Y", or "Variable" instead of the bare amount.

**Rationale**: Clarification Q1 (recorded under `## Clarifications`). Aligns with the system-design schema (`services (id, name, duration_min, price_cents, color_token, category, taxable, active)` — no nullable marker). Every downstream consumer reads a single column with no null-handling fork. Snapshot columns on the future `appointment_services` and `ticket_items` rows still capture the actual charged amount, so the catalog's seed value never rewrites history.

**Alternatives considered**:
- Nullable `price_cents` (the spec's original draft). Rejected — every consumer would need a `?? 0` or branch on `variable_price`; matches no existing column pattern.
- Treat `price_cents` as the canonical "starting price" and drop `price_from_cents`. Rejected — would lose the explicit "no lower bound set" state (which the variable-price UI uses to render plain "Variable" instead of "From $0").

## R2. Duration is a single fixed integer even for variable-price services

**Decision**: `services.duration_min` stays `not null integer check (duration_min > 0)`. There is no `variable_duration` flag. The Add/Edit drawer requires a positive integer in every form state.

**Rationale**: Clarification Q2. Adding parallel `duration_min_from` / `duration_min_to` columns now would double the schema for the same column class and force every consumer (calendar slot generator, per-tech override math, search/filter heuristics) to handle a range. The default duration is treated as the typical estimate; if real-world usage shows it's too noisy, a follow-up feature ships the range columns then.

**Alternatives considered**:
- Couple `variable_price` and `variable_duration` into one toggle. Rejected — confuses two independent business concepts (price vs. time) and complicates the per-tech override field.
- Make `duration_min` nullable for variable-price services. Rejected — the calendar needs *some* number to size a booking slot; null forces every consumer to pick a fallback constant.

## R3. `category` is required, pre-seeded with `"Other"` on the Add form

**Decision**: `services.category` is `not null text check (length(trim(category)) > 0)`. The Add drawer's initial state sets `category = 'Other'`. The auto-complete list reads `select distinct category from services order by category` and prepends a `+ Create '<typed>'` option whenever the typed text has no exact (case-insensitive) match.

**Rationale**: Clarification Q3. A required column with a sensible default keeps the list-view grouping trivial (every row has a section), keeps the auto-complete useful (every saved category appears), and removes the empty-state "Uncategorized" group. First-run owners can save without typing a category; they can rename or replace it any time.

**Alternatives considered**:
- Optional `category`, render orphan rows under "Uncategorized". Rejected — adds a nullable-column code path for zero functional gain.
- Required with no default (force a typing decision on every Add). Rejected — slows first-run UX and adds a validation barrier where a sensible default exists.

## R4. After a successful Add save, the drawer stays open and flips to Edit mode

**Decision**: `addService` succeeds → `revalidatePath` → `redirect('/services?selected=<new id>&toast=service_added&name=<encoded>')`. The page's RSC re-renders with `?selected=<new id>`, the drawer detects the selection and re-opens in Edit mode for the just-created service (title becomes "Edit service", baseline matches saved values so Save is disabled, the bottom action becomes "Archive service"). Visually one continuous frame; no flash of an empty drawer.

**Rationale**: Clarification Q4. Add and Edit then share one post-save mental model (matching `updateService` in FR-020). Owners commonly tweak a service immediately after creating it (add another tech, set a per-tech override).

**Alternatives considered**:
- Close the drawer (the spec's first draft). Rejected — forces the owner to re-click the row to make any follow-up tweak.
- Close the drawer then immediately auto-open it in Edit mode. Rejected — produces a visible flash between states; bad on slower devices and noisier in Playwright snapshots.

## R5. Active-toggle verbs are "Archive / Restore" (not "Deactivate / Reactivate")

**Decision**: User-facing copy uses "Archive service" (on a destructive button, with a confirmation dialog) and "Restore service" (non-destructive, no dialog). The underlying column is the same `active` boolean used by the staff feature; only the verbs in chrome differ. Audit verbs match: `service.archived` and `service.restored`.

**Rationale**: Clarification Q5. The verbs match the domain (POS/catalog idiom; Square, Shopify, etc.); the staff feature's "deactivate" verbiage reads wrong on items. The audit verbs use the corresponding nouns so any future audit dashboard filter (`action like 'service.%'`) makes intuitive sense.

**Alternatives considered**: see Clarifications Q5 options table.

## R6. Migration file numbering and apply path

**Decision**: The migration is `supabase/migrations/0003_services_catalog.sql`. It is applied to the hosted Supabase **preview** project automatically by `.github/workflows/db-migrate-preview.yml` when the PR is opened/synchronized, and to the **production** project automatically by `.github/workflows/db-migrate-prod.yml` when the merge lands on `main`. No manual `supabase db push` is required at any point; doing so by hand is reserved for emergencies (Constitution v1.0.3 § Development Workflow & Quality Gates).

**Rationale**: Existing repo convention (`0001_auth_schema.sql`, `0002_staff_management.sql`). The migration set on `main` matches production exactly; the migration set on the PR matches the preview Supabase project exactly. The Vercel preview deploy of this PR will not run until the preview-apply workflow has succeeded.

**Alternatives considered**: None — the workflow exists; using it is mandatory.

## R7. `services` RLS policies

**Decision**: Enable RLS on both new tables. Policies:

- `services_read_any_authenticated`: `for select to authenticated using (true)` — reads are open to every authenticated user (matches the spec's "all operators can read" rule and the system-design's "any authenticated Supabase user can read all rows" posture).
- No `insert`, `update`, or `delete` policy on either table. Writes happen via the service-role client inside Server Actions; service-role bypasses RLS. This mirrors the staff feature's approach (003 + 006).
- `staff_services_read_any_authenticated`: same shape as above.
- Kiosk JWT is not granted access to either table. (Confirmed by inspecting `lib/auth/cookie.ts` and the kiosk middleware path — kiosk requests authenticate with a token whose claims do not match either policy's `to authenticated` audience, so RLS denies. This is the same pattern enforced by every existing table except `walk_ins`.)

**Rationale**: Spec FR-035 requires the project's existing RLS pattern. Reads are universally permitted; writes route exclusively through Server Actions. Defense in depth: every Server Action also re-verifies the operator's role (FR-031).

**Alternatives considered**: write policies on the `authenticated` role gated by a Postgres function reading `current_setting('request.jwt.claims', true) -> 'staff_role'`. Rejected — duplicates application logic in SQL with no added safety beyond what the service-role Server Action gate provides; introduces a JWT-claim contract this app does not otherwise rely on.

## R8. `staff_services` schema shape

**Decision**: `staff_services` is a join table with the columns:

| Column                  | Type          | Constraints                                              |
|-------------------------|---------------|----------------------------------------------------------|
| `staff_id`              | `uuid`        | `not null references public.staff(id) on delete cascade` |
| `service_id`            | `uuid`        | `not null references public.services(id) on delete cascade` |
| `duration_min_override` | `int`         | nullable; `check (duration_min_override > 0)` when set    |
| `created_at`            | `timestamptz` | `not null default now()`                                 |
| `updated_at`            | `timestamptz` | `not null default now()`                                 |
| **PK**                  |               | `primary key (staff_id, service_id)`                     |

`updated_at` is touched by an `update` trigger only when `duration_min_override` actually changes (parallel to existing pattern). `on delete cascade` is safe because neither `staff` nor `services` is ever hard-deleted in this app (the staff feature uses `removed_at`; services use `active`).

**Rationale**: Matches the system-design data model verbatim plus the `created_at`/`updated_at` columns mandated by FR-034. Composite primary key prevents duplicate assignments. The nullable `duration_min_override` is the explicit "no override" sentinel that FR-022 / FR-006 of US3 references.

**Alternatives considered**:
- Surrogate `id` PK + `unique (staff_id, service_id)`. Rejected — needlessly wider rows for zero benefit; no foreign key from any other table references a `staff_services` row directly.

## R9. `audit_log` controlled vocabulary extension (application-layer only)

**Decision**: The migration does **not** touch `audit_log`. Verified against `supabase/migrations/0001_auth_schema.sql`: `audit_log.action` is declared `text not null` with no CHECK constraint. The controlled vocabulary lives at the application layer in `lib/auth/audit.ts` via the `AuditAction` TypeScript union. This feature extends that union with four new verbs (`service.added`, `service.updated`, `service.archived`, `service.restored`) and replaces the hard-coded `STAFF_ENTITY_ACTIONS` set with a per-entity-type dispatch table keyed by verb prefix (`service.* → service`, the existing `staff.*` mutation verbs → `staff`, everything else → `auth`).

**Rationale**: Constitution Principle III requires controlled-vocabulary `action` values; the existing implementation enforces that via the `recordAudit(action: AuditAction, ...)` typed signature — a non-`AuditAction` string is a TS error at the call site. The prefix dispatch keeps the helper closed against future feature additions (the next feature's verbs route correctly with no edit to the helper).

**Alternatives considered**:
- Add a DB-side CHECK constraint as part of this migration. Rejected — would change behavior of the existing `audit_log` table for reasons unrelated to this feature's scope (Principle V). The TS union already meets the controlled-vocabulary requirement.

## R10. `loadServiceWithAssignments` is a read helper, not a Server Action endpoint

**Decision**: The drawer's initial baseline (when re-opened via `?selected=`) is provided by the page's RSC fetch — the same query that returns the catalog list also returns each service's full `staff_services` rows so the drawer can hydrate without a separate round-trip. There is no separate Server Action for "load one service"; the read helper sits inside `actions.ts` only for the type contract (the page imports `loadServiceWithAssignments(id)` as a typed projection over the page's already-fetched data).

**Rationale**: Single round-trip on the cold paint; the drawer hydrates from props instead of a client `fetch`. Mirrors the staff feature where `EditPanel` receives its `target` as a prop fetched server-side.

**Alternatives considered**:
- Separate `loadServiceWithAssignments(id)` Server Action invoked client-side on drawer open. Rejected — extra round-trip on every row click; loses the SSR-warmed cache.

## R11. Tab-bar insertion order

**Decision**: The `TABS` constant in `components/lacquer/settings/tab-bar.tsx` becomes: General · Staff · **Services** · Notifications · Billing. Services slots in between Staff and Notifications because that order matches the build-order in `docs/system-design.md` ("settings → calendar → clients → walk-in/kiosk → square → checkout → end-of-day").

**Rationale**: Predictable ordering; existing tab-active matching uses `pathname.startsWith(href)` so the addition needs no logic change.

**Alternatives considered**:
- Append at the end (after Billing). Rejected — Billing is a placeholder tab; placing the live tab between two real tabs (Staff, Notifications) reads better.

## R12. Drawer state machine and "Discard changes?" gate

**Decision**: The drawer is a single client island with five primary states (`closed`, `add-clean`, `add-dirty`, `edit-clean`, `edit-dirty`) plus an overlay state (`confirm-discard`) and the (rare) `confirm-archive`. Transitions:

- `closed` → `add-clean` on "Add service" click; baseline = factory defaults (category=Other, duration=30, color=Rose, taxable=true, variable=false, no staff).
- `closed` → `edit-clean` on row click; baseline = saved service + assignments.
- Any form change marks the state `*-dirty`; comparing to baseline drives the Save button's enabled state.
- Save → server round-trip → on success, the URL changes via `redirect(?selected=<id>&toast=...)`, the page re-renders, and the drawer re-mounts in `edit-clean` for the now-saved row.
- Close gesture (backdrop / Escape / Cancel) in any `*-clean` state → drawer closes (no dialog). In any `*-dirty` state → overlay = `confirm-discard`; Discard closes the drawer, Cancel returns to the dirty state.

The state machine lives entirely in the client island; the URL only carries `?selected=` (and the toast/error params). No global state library required.

**Rationale**: Mirrors the staff feature's per-row edit-panel "switching rows discards drafts silently" rule (FR-022 in staff) but adapted to a drawer that's a single visible component instead of a permanent panel. The five-state shape is the minimum needed to differentiate Save-enabled vs. Save-disabled and dialog-needed vs. silent-close.

**Alternatives considered**:
- Promote `confirm-discard` to its own page/modal route. Rejected — over-engineered for a single-decision gate.
- Skip the dialog entirely and use `beforeunload` (browser-native unsaved-changes prompt). Rejected — only fires on tab close; doesn't fire on backdrop click or Escape.

## R13. URL → Sonner toast bridge

**Decision**: Mirror the staff feature's `StaffToaster` client island: a small `<ServicesToaster />` reads `useSearchParams()` for `?toast=<key>` / `?error=<code>` / `?name=<encoded>`, fires the matching Sonner toast (with the service name interpolated when present), then calls `router.replace(pathname + paramsWithoutToast)` to strip the params so a refresh does not re-fire the toast. Wrapped in `<Suspense fallback={null}>` per Next 16 strict-streaming rules.

**Vocabulary** (full list in `_constants` per `contracts/ui.contract.md`):

| Key | Toast text |
|-----|------------|
| `service_added` | `{name} added to the catalog` |
| `changes_saved` | `Changes saved` |
| `service_archived` | `{name} archived` |
| `service_restored` | `{name} restored` |
| `no_techs_assigned` | `Nobody can perform this service yet. Add techs from the edit drawer.` (secondary, may stack) |

**Rationale**: Already established pattern; reusing it keeps the user-facing toast behavior identical to the staff page.

**Alternatives considered**: in-component imperative `toast(...)` calls inside each form. Rejected — `addService` is a Server Action that calls `redirect()`, so there's no client-side continuation to fire the toast from.

## R14. Drag-drop reorder is explicitly out of scope; sort is deterministic

**Decision**: The catalog list is grouped by `category` ascending and sorted by `display_name` ascending within each group. There is no `display_order` column, no manual reorder UI, no per-user ordering preference. The user input and spec both call this out as deferred.

**Rationale**: Matches the spec; avoids a column the calendar / pickers would also need to honor; matches what every existing list surface in the app already does (the staff page uses the same alpha sort within role priority).

**Alternatives considered**:
- Add a nullable `display_order` column now and defer the UI. Rejected — speculative generality (Principle V).

## R15. Local Playwright + Vitest gates fit existing CI

**Decision**: The new specs slot into the existing `tests/unit/` and `tests/e2e/` directories and are picked up automatically by `npm test` and `npm run test:e2e`. The full pre-push gate (`format:check` → `lint` → `typecheck` → `test` → `test:e2e --workers=1`) is documented in `CLAUDE.md` § "Pre-push quality gates"; this feature does not change the gate set.

**Rationale**: Existing convention; no new test infrastructure needed.

**Alternatives considered**: None — the gate set is constitutional.
