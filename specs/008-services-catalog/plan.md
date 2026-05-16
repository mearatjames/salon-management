# Implementation Plan: Services catalog (top-level /services)

**Branch**: `008-services-catalog` | **Date**: 2026-05-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-services-catalog/spec.md`

## Summary

Add a top-level **Services** destination at `/services` and wire the existing sidebar `services` nav item (Sparkles icon, shipped disabled in feature 007) to point at it. An owner or manager can manage the salon's service catalog — add, edit, archive, and restore services and decide which technicians can perform each one (with optional per-tech duration overrides). Reads are open to every authenticated operator; writes are gated to `owner`/`manager` inside every Server Action, and every successful write emits an `audit_log` row with `action='service.*'`.

Approach: a new `services` table + a `staff_services` join table land in `supabase/migrations/0003_services_catalog.sql` and are auto-applied by the two existing GitHub Actions (`db-migrate-preview.yml` on PR, `db-migrate-prod.yml` on push to `main`). The page (`app/(studio)/services/page.tsx`) is a Server Component that fetches services + assignment counts + the staff roster in parallel and composes a Lacquer layout inside the studio shell (sidebar + topbar, no tab strip): a grouped catalog list on the left and an off-canvas right drawer that doubles as Add and Edit. The drawer is a client island (form state, variable-price toggling, per-tech duration overrides, "Discard changes?" guard) wired to five Server Actions (`addService`, `updateService`, `archiveService`, `restoreService`, plus `loadServiceWithAssignments` as a read helper for the drawer's initial draft baseline). Mirrors the staff-feature prelude: `requireStudioSession` → role gate → `validate*` → permission check → service-role insert/update → `recordAudit` → `revalidatePath` + redirect with a `?toast=` / `?error=` query param.

Variable-price storage is settled by Clarifications Q1: `price_cents` is non-null and stores `price_from_cents` (or `0`) when `variable_price` is true; the `variable_price` flag is the sole signal for "show as range". Per Q2, duration stays a single fixed number even for variable-price services. Per Q3 a new service is pre-seeded with category `Other`. Per Q4 a successful Add keeps the drawer open and flips it to Edit mode for the just-created service. Per Q5 the active-toggle verbs remain "Archive / Restore" (catalog idiom) rather than the staff feature's "Deactivate / Reactivate".

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 (App Router + RSC + Server Actions)

**Primary Dependencies**: `next`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `lucide-react`, `clsx`, `sonner` (toasts — already in use by the staff feature); shadcn/ui primitives in `components/ui/*`; Lacquer tokens in `styles/tokens.css`. No new runtime dependencies.

**Storage**: Supabase Postgres. Two new tables (`public.services`, `public.staff_services`) added via `supabase/migrations/0003_services_catalog.sql`. One controlled-vocabulary extension to the existing `audit_log.action` enum-by-CHECK: four new verbs (`service.added`, `service.updated`, `service.archived`, `service.restored`). No new columns on existing tables. No new RLS roles.

**Testing**: Vitest for pure helpers — validators (name/category/duration/price/color/bounds), the per-tech-override diff, the catalog group/sort comparator, and the variable-price label formatter (`From $X` / `$X – $Y` / `Variable`). Playwright `services.spec.ts` exercises the seven user stories end-to-end against a seeded local Supabase: list-with-group, Add (incl. category auto-complete and the drawer-stays-open-flips-to-Edit assertion), Edit + per-tech overrides, Archive/Restore, variable-price round-trip, the read-only state for a `technician` operator, and the toast sequence.

**Target Platform**: Vercel (Next.js 16 Fluid Compute by default); browsers used by Tang Nails staff — modern Chrome/Safari on macOS, iPadOS, Windows laptops.

**Project Type**: Web application (single Next.js project at repo root — `app/`, `components/`, `lib/`, `styles/`, `tests/`, `supabase/migrations/`).

**Performance Goals**: First catalog paint (cold SSR) within ~250ms p95 against the local Supabase seed; the read query is a single round-trip joining `services` left-joined with a `staff_services` count subquery. Search/filter on the client (sort + substring match over ≤100 rows) MUST complete within 100ms of a keystroke (SC-006, SC-007).

**Constraints**:
- No raw hex codes, no off-scale spacing, no font weights outside 400/500/600 (Constitution Principle I).
- All writes flow through Server Actions; the kiosk JWT must not be granted any access to either new table (Principle II + system-design RLS posture).
- Every successful mutation writes an `audit_log` row with `acting_as_staff_id = viewer.staff.id`, `entity_type = 'service'`, `entity_id = <service uuid>` (Principle III).
- Migration applied automatically by `.github/workflows/db-migrate-{preview,prod}.yml`. No manual `supabase db push` (Constitution v1.0.3 "Schema drift forbidden").
- `services.taxable` is captured and stored but has no read site outside the drawer — schema reservation per Principle V.
- Drag-drop reorder and Square sync are explicitly out of scope per the spec.
- Animation ≤300ms ease-out (drawer slide and dialog show per Lacquer motion language).

**Scale/Scope**: Single salon. Expected catalog size ≤100 services across ≤20 categories. ≤10 concurrent operator devices. Scope of this feature: one new migration, one new page + drawer + dialog + toast bridge client island, four Server Actions + one read helper, ~10 validator/helper modules, ~4 Vitest specs, one Playwright spec, plus a one-line edit to `components/lacquer/sidebar/nav-items.ts` to enable the previously-disabled `services` nav entry (set `href: "/services"`, drop `disabled: true`). The Settings shell layout (`app/(studio)/settings/layout.tsx`) is **not** touched — Services no longer lives under Settings. The Settings tab-bar (`components/lacquer/settings/tab-bar.tsx`) loses its existing `services` entry as part of this feature so the leftover tab doesn't shadow the new top-level route.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | ✅ Pass | Every visual value resolves to a token in `styles/tokens.css`. Reuses Lacquer primitives already on disk: the studio shell + sidebar (feature 007), `components/lacquer/staff/*` for drawer + dialog + toaster patterns, `components/ui/*` shadcn primitives, Lucide icons (Plus, Search, Eye, EyeOff, AlertCircle, Archive, ArchiveRestore, X). The new Lacquer namespace (`components/lacquer/services/*`) composes existing primitives — no second component library. Acceptance includes a side-by-side comparison against `design-system/ui_kits/studio/Settings.jsx` (services list mock) and the staff drawer in browser preview. |
| **II. Server-Authoritative Architecture** | ✅ Pass | All reads on the page use `createSupabaseServerClient()` from a Server Component; mutations are five Server Actions (`addService`, `updateService`, `archiveService`, `restoreService`, plus the `loadServiceWithAssignments` read helper used by the drawer's initial baseline). Each action's prelude mirrors the staff feature: `requireStudioSession` → `assertCanWriteCatalog` (owner OR manager) → `validate*` → matrix check → service-role mutation → `recordAudit` → `revalidatePath` + redirect with `?toast=`/`?error=`. The client drawer holds form state only; it never writes to the DB. No Square calls in this feature; the kiosk JWT receives no grant on either new table (RLS denies; see contracts/db-rls.contract.md). |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | ✅ Pass — partial scope | This feature does not handle money flows — `price_cents` is a catalog default, snapshotted at checkout by the (future) `ticket_items` rows per the system design. The audit obligation is met: each of the four write actions awaits a `recordAudit('service.<verb>', ...)` insert before redirecting (the redirect line is unreachable until the audit row commits). Payload shapes are documented in `contracts/audit.contract.md` and include the new `entity_type='service'` route in `lib/auth/audit.ts`. The four new verbs join the existing `AuditAction` union and the `STAFF_ENTITY_ACTIONS` set is replaced with a per-entity-type dispatch table. |
| **IV. Test-First for Critical Paths** | ✅ Pass — partial scope | Per Principle IV, TDD-with-failing-tests is mandatory for money/auth/refund/cash-drawer/tip-allocation/audit logic. This feature does not change any of those; the new audit verbs route through the existing `recordAudit` whose insert is already covered. Still ships: (1) Vitest unit specs for `_validation.ts` (name, category, duration, price, color, bounds), `_sort.ts` (group-by-category-then-name), `_format.ts` (the variable-price label formatter), and the `permissions.ts` matrix (canWriteCatalog × operator role); (2) one Playwright spec covering all seven user stories end-to-end; (3) one Vitest spec asserting `recordAudit('service.*')` writes the expected `entity_type='service'`. All run in CI on every PR. |
| **V. Scope Discipline & Cost Restraint** | ✅ Pass | Scope matches the system-design § 8 "Settings (owner/manager)" services row exactly. Three explicit out-of-scope items from the user input (Square catalog sync, tax computation, service photos/marketing) stay deferred; drag-drop reorder is explicitly deferred and replaced by `category → name` deterministic sort. The `taxable` flag is captured and stored but has no compute path or read site outside the drawer toggle (Principle V "schema reservations" treatment, parallel to the system design's `tax_cents` reservation). No new infrastructure, no new paid services, no new dependencies — only two new Postgres tables that fit comfortably inside the existing Supabase free tier. |

**Gate result: PASS — proceed to Phase 0.** No violations to justify; Complexity Tracking table is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/008-services-catalog/
├── plan.md                              # This file
├── spec.md                              # Already written (/speckit-specify + /speckit-clarify)
├── research.md                          # Phase 0 — decisions + rationale
├── data-model.md                        # Phase 1 — schema, types, validations, transitions
├── quickstart.md                        # Phase 1 — how to run, verify, and visually compare
├── contracts/
│   ├── README.md                        # Index across the four contracts
│   ├── db-rls.contract.md               # services + staff_services columns and RLS policies
│   ├── server-actions.contract.md       # The five actions, FormData shape, error codes
│   ├── audit.contract.md                # service.* verbs + payload shapes
│   └── ui.contract.md                   # Page composition, drawer state machine, toast vocab
└── checklists/
    └── requirements.md                  # Already written (/speckit-specify)
```

### Source Code (repository root)

The repo is a single Next.js 16 App Router project at the root. This feature adds and edits the following:

```text
supabase/
└── migrations/
    └── 0003_services_catalog.sql        # NEW — creates services + staff_services; extends audit_log CHECK

app/
└── (studio)/
    └── settings/
        └── services/                    # NEW — feature directory
            ├── page.tsx                            # Server Component: data fetch + page chrome
            ├── actions.ts                          # 5 Server Actions + 1 read helper
            ├── permissions.ts                      # canWriteCatalog matrix (owner|manager → write)
            ├── _types.ts                           # CatalogService, ServiceAssignment, drawer types
            ├── _validation.ts                      # name, category, duration, price, color, bounds
            ├── _sort.ts                            # group-by-category then alpha within group
            ├── _filter.ts                          # case-insensitive substring match on name
            ├── _format.ts                          # variable-price label formatter
            ├── _diff.ts                            # staff-assignment add/remove/duration-change diff
            └── toasts.ts                           # Toast vocabulary (added/changes_saved/archived/restored/no_techs)

components/
└── lacquer/
    └── services/                                   # NEW — namespace
        ├── page-header.tsx                                  # Server: title + summary line
        ├── empty-state.tsx                                  # Server: zero-catalog state (Sparkles + CTA)
        ├── catalog-list.client.tsx                          # Client: search + Show-archived + grouped list
        ├── catalog-row.tsx                                  # Server: single row (color, name, price, dur, pill)
        ├── drawer.client.tsx                                # Client: Add/Edit drawer state machine
        ├── service-form.client.tsx                          # Client: form fields (incl. variable-price)
        ├── staff-assignment-list.client.tsx                 # Client: tick + per-tech duration override
        ├── archive-dialog.client.tsx                        # Client: confirmation dialog
        ├── discard-changes-dialog.client.tsx                # Client: "Discard changes?" guard
        └── services-toaster.client.tsx                      # Client: URL → Sonner bridge (parallel to StaffToaster)

components/
└── lacquer/
    └── settings/
        └── tab-bar.tsx                  # EDIT — REMOVE the existing { id: "services", … } entry (Services is no longer a Settings tab)

components/
└── lacquer/
    └── sidebar/
        └── nav-items.ts                  # EDIT — flip the existing services entry from { href: null, disabled: true } to { href: "/services" }

lib/
└── auth/
    └── audit.ts                         # EDIT — add 4 verbs to AuditAction union and route them to entity_type "service"

styles/
└── settings.css                         # EDIT — append .settings-services-grid (legacy class name retained for the page wrapper), .services-drawer, .service-list-* rules. The CSS keeps living in settings.css because every stylesheet is loaded globally; renaming the file would be churn without benefit.

tests/
├── unit/
│   └── services/
│       ├── validation.test.ts                      # NEW — _validation.ts
│       ├── sort.test.ts                            # NEW — _sort.ts (group-by + within-group order)
│       ├── format.test.ts                          # NEW — _format.ts (variable-price label rules)
│       ├── diff.test.ts                            # NEW — _diff.ts (assignment add/remove/change)
│       ├── permissions.test.ts                     # NEW — permissions.ts matrix
│       └── audit-service-entity.test.ts            # NEW — recordAudit routes service.* to entity_type "service"
└── e2e/
    └── services.spec.ts                            # NEW — seven user stories end-to-end

CLAUDE.md                                # EDIT (auto by Phase 1 step 3) — update SPECKIT block to point at this plan
```

**Structure Decision**: Single Next.js project (Option 1 — DEFAULT for this repo, established in 001-project-scaffolding and reinforced in 006 + 007). The feature mirrors the **006-staff-management** layout one-for-one: same file naming (`actions.ts`, `permissions.ts`, `_types.ts`, `_sort.ts`, `_filter.ts`, `_validation.ts`, `toasts.ts`), same Server-Action prelude, same URL-toast bridge pattern, same drawer/dialog client-island split. Only the new client island file names diverge — services uses a single `drawer.client.tsx` instead of staff's separate `edit-panel.client.tsx` + `add-wizard.client.tsx` because services has no multi-step wizard (the form is one screen with conditional reveals for variable-price bounds and per-tech overrides).

## Complexity Tracking

No constitution violations to justify. Table intentionally omitted.
