# Implementation Plan: Per-staff payout exemptions + Settings → Staff redesign

**Branch**: `023-staff-payout-exemptions` | **Date**: 2026-05-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-staff-payout-exemptions/spec.md`

## Summary

Phase 2b of the deductions roadmap. Captures **per-staff overrides** for both card-fee and supply deductions and **redesigns the Settings → Staff surface** to match the latest Lacquer prototype. Same capture-and-display posture as 021 — the new values persist and are surfaced to operators, but checkout-time application stays Phase 3 (out of scope).

Three layered deliveries in one feature:

1. **Schema extension + data integrity** — migration `0018_staff_pay_deductions.sql` adds three columns to `public.staff`: `card_fee_exempt boolean not null default false`, `supply_mode text not null default 'apply' check in ('apply','partial','exempt')`, and `supply_except uuid[] not null default '{}'`. A row-level CHECK enforces `supply_except = '{}' when supply_mode <> 'partial'`. A `before insert or update` trigger (`staff_assert_supply_except_valid_trg`) verifies every element of `supply_except` exists in `supply_types` (Postgres can't FK-constrain array elements directly — research § R1). An `after delete on supply_types` trigger (`supply_types_prune_from_staff_trg`) defensively removes dead ids from every `staff.supply_except` if a row is ever physically deleted (022 uses archive-not-delete, so this is belt-and-suspenders for disaster recovery). Migration writes one `staff.updated` audit row per affected staff if any pre-existing row's defaults differ from the new schema defaults — in practice zero, because the columns are new with `not null default` values, so no backfill data movement. No audit-log schema change required.

2. **Per-staff Pay & deductions surface** — a new `<PayDeductionsSection>` client component in `components/lacquer/staff/pay-deductions-section.client.tsx`, mounted inside the redesigned `<EditPanel>`. Three rows: (a) Card processing fee toggle with subtitle resolved from `formatDefaultCardFeeLabel()` per Clarify Q5; (b) Supply deductions segmented control (Apply all / Some / Exempt); (c) per-type picker (visible only when `supply_mode = 'partial'`) listing every active supply type plus any archived type currently in the tech's `supply_except`. Per-row usage hint computed server-side by a new helper `app/(studio)/settings/staff/_supply-catalog.ts` exporting `loadSupplyCatalogForStaff(staffId)` — single SQL with `count(*) filter (where s.active)` and `mode() within group (order by s.supply_amount_cents)` (research § R2). A plain-language summary sentence renders only when at least one exemption is in effect (five posture variants per spec US3). Front-desk hint replaces the summary when the target's role is `front_desk` and no exemptions are in effect. Mode toggle preserves draft ticks across `Some`/`Apply all`/`Exempt` transitions (Clarify Q4); save action wipes `supply_except` if saved mode ≠ `partial` (DB CHECK + app-level both enforce). Status badges in the panel header derive live from the current draft state (no save round-trip needed for preview).

3. **Settings → Staff visual redesign** — adapts `design-system/Staff Settings.html` + `design-system/staff-components.jsx`:
   - **Filter chips**: replace the existing show-inactive `<Switch>` with an `<RosterFilterChips>` client component (All · Active · Inactive with tabular per-status counts). Persists the active chip under `tn:settings:staff:filter` in `localStorage`; legacy `tn:settings:staff:show-inactive` key is ignored on read (no migration shim — first-time-after-upgrade visitors get the new default "Active"). Counts computed server-side from the roster snapshot and passed as a prop.
   - **Staff row**: redesign `components/lacquer/staff/staff-row.tsx` — leading status dot (success/muted), avatar + name + role-as-second-line, tinted PIN pill ("Set" success-tinted / "No PIN" warning-tinted), trailing "Added MMM YYYY" tabular date, faded opacity for inactive rows, left-side accent bar when selected, mobile (<900px) drops trailing date and renders a chevron.
   - **Sectioned edit panel**: restructure `components/lacquer/staff/edit-panel.client.tsx` into four section cards (Identity → Access → Pay & deductions → Save changes full-width primary → Danger zone block). Danger zone is a new `<DangerZone>` sub-component with a red-tinted background containing only Deactivate/Reactivate + Remove (no other destructive control may appear in the panel — explicit FR-028). Panel-profile header (avatar + name + role + "Added MMM YYYY" + status badges) replaces the current panel header.
   - **Add-staff wizard sheet**: redesign `components/lacquer/staff/add-staff-wizard.client.tsx` to use a 420px right-side sheet with three step pills (Details → Set PIN → Done), a live preview card mirroring the draft, and a sticky footer. The two existing Server Actions (`addStaff` + setPin within `setStaffPin`) are unchanged — visual chrome only. Cancel mid-wizard after staff creation leaves the partial record with "No PIN" pill (existing behavior preserved).
   - **Settings tab bar**: the shared tab bar at `components/lacquer/settings/tab-bar.tsx` and the `/settings → /settings/staff` redirect at `app/(studio)/settings/page.tsx` are **already shipped** (verified in source — `app/(studio)/settings/layout.tsx` mounts `<TabBar />`, `app/(studio)/settings/page.tsx` redirects). FR-025 and FR-026 are already satisfied; this plan does not edit the layout or root page.
   - **Mobile bottom sheet**: a new `<StaffMobileSheet>` client island wraps the EditPanel on `<900px` viewports — slides up from the bottom (300ms ease-out, instant for `prefers-reduced-motion`), occupies up to `92vh`, body scroll locked while open via the existing pattern used by the wizard sheet. A FAB renders bottom-right on mobile, opening the redesigned add-staff wizard.

**updateStaff Server Action extension**: accepts three new FormData fields — `card_fee_exempt` (checkbox "on"/missing), `supply_mode` (string), and `supply_except` (repeated FormData entries via `formData.getAll('supply_except')`). Validates via two new validators in `_validation.ts`: `validateSupplyMode(raw)` → `'apply'|'partial'|'exempt'` (else `invalid_supply_mode`); `validateSupplyExcept(raw, allowedIds)` → `string[]` (trims, dedupes via Set, drops unknowns silently per Clarify-defensive rule, caps at 64 entries; throws nothing). The action wipes `supply_except` to `[]` whenever the saved mode is `apply` or `exempt`, regardless of submitted ticks (mirror of the DB CHECK at the app layer). Audit payload extension via a new `app/(studio)/settings/staff/_audit-diff.ts` helper that mirrors the 021 `app/(studio)/services/_audit-diff.ts` pattern: produces `{ before, after, changes }` objects scoped to the four new diff keys (`card_fee_exempt`, `supply_mode`, `supply_except`) when any of them changed. The supply_except diff stores raw uuids — the audit viewer (a downstream surface; not built in this feature) resolves names live from the catalog.

**Permission gate extension**: `permissions.ts` gains a new `StaffAction` value `"update_pay_deductions"`. Per Clarify Q1 the action is **not** in `SELF_BLOCKED_ACTIONS` (self-edit allowed — non-destructive, payout-economics only). It IS gated by `canEditAnyField` (manager-on-owner remains blocked, same as every other panel field). The `updateStaff` action calls `assertMutationAllowed(ctx, 'update_pay_deductions')` only when any of the three new fields differ from the target's persisted values (no permission check for no-op submits).

**Constitution gates**: all five principles pass (I — every visual value resolves to a token from `styles/tokens.css`, the new components use shadcn primitives `Switch`/`ToggleGroup`/`Sheet`/`Checkbox`/`Popover` already vendored, icons stay Lucide 1.5px stroke; II — all mutations Server Actions, RLS unchanged, role gate inside `updateStaff` and in `permissions.ts` mirroring 006/008/021; III — every staff update that mutates any of the three new fields writes an audit row with `before`/`after`/`changes` diff in the same request (SC-004), no money moves this phase; IV — Vitest for the two new validators + the audit-diff key extension + the `formatSummary()` summary-sentence helper, Playwright `tests/e2e/staff-payout-exemptions.spec.ts` covers US1–US3 (P1) with audit-row assertions landing before the UI implementation per the scope-of-Principle-IV rule for audit logic; V — scope matches the spec exactly, no checkout wiring (still Phase 3 of the deductions roadmap), no studio-level default-card-fee editor (still Phase 2 of 021), no styling change to other Settings sub-pages, no other prototype redesigns).

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19, Next.js 16 (App Router + RSC + Server Actions). Existing target — no version change.

**Primary Dependencies**: `next`, `react`, `react-dom`, `@supabase/ssr`, `@supabase/supabase-js`, `lucide-react`, `clsx`, `sonner`, shadcn/ui primitives in `components/ui/*` (specifically `Switch`, `ToggleGroup` (already vendored — used by Services), `Sheet` (mobile bottom sheet + wizard sheet), `Checkbox` (per-type picker rows), `Popover` (status-badge hover hints if needed), `Button`, `Tabs` (already used by `<TabBar>`)), Lacquer tokens in `styles/tokens.css`. **No new runtime dependencies.** The mobile bottom sheet uses the existing shadcn `Sheet` primitive with `side="bottom"` (already supported, see `components/ui/sheet.tsx`); the per-type picker uses native checkboxes in a `Sheet`-styled list; the segmented Supply-mode control uses shadcn `ToggleGroup` with `type="single"`.

**Storage**: Supabase Postgres. One new migration (`supabase/migrations/0018_staff_pay_deductions.sql`) adds three columns + one CHECK + two triggers (see Summary §1). **No new tables**, no new RLS roles (existing `staff` policies cover the three new columns automatically — they're additional column reads/writes within the same row that already passes RLS). The migration is transactional (Supabase CLI wraps each file in a single transaction); rollback is a single drop of the three columns + two triggers.

**Testing**: Vitest for the four new pure helpers — (a) `validateSupplyMode(raw)`: covers `apply`/`partial`/`exempt` accept, anything else throws `invalid_supply_mode`; (b) `validateSupplyExcept(raw, allowedIds)`: covers dedup, unknown-id drop, 64-entry cap, empty array, non-array input; (c) the `_audit-diff.ts` extension's `STAFF_DIFF_KEYS` now contains the three new keys + the existing four, and `buildChanges()` returns the right diff shape for each combination; (d) `formatSummary({ firstName, cardExempt, supplyMode, exemptedTypeNames })`: the five posture variants from spec US3 each render exactly the documented copy. Playwright `tests/e2e/staff-payout-exemptions.spec.ts` exercises US1 (card-fee toggle persists + audit row), US2 (supply-mode + per-type picker persists + audit row + archived-still-exempted UX from Clarify Q3), US3 (summary sentence renders per-posture). The existing `tests/e2e/staff.spec.ts` is updated where the filter switch was previously asserted (replaced by chips), the staff row text/dot/PIN-pill assertions match the redesigned row, and the edit-panel section structure (Identity → Access → Pay & deductions → Save changes → Danger zone) is asserted in one structural test that the existing US3–US7 e2e specs lean on.

**Target Platform**: Vercel (Next.js 16 Fluid Compute by default); browsers used by Tang Nails staff — modern Chrome/Safari on macOS, iPadOS, Windows laptops. Studio tablets (1024×720 primary) and phones (375×667 floor) are both supported. The mobile bottom sheet activates below 900px viewport width via CSS `@media` (research § R5 — no JS media-query hook, avoids hydration mismatch); the wizard sheet stays right-aligned on desktop and full-width on mobile.

**Project Type**: Web application (single Next.js project at repo root — `app/`, `components/`, `lib/`, `styles/`, `tests/`, `supabase/migrations/`). Same shape as 006/008/021/022.

**Performance Goals**:

- **Edit-panel render**: panel paint within 100ms of row click (server already renders the panel inline; no client fetch). Pay & deductions section's `loadSupplyCatalogForStaff()` is a single SQL with one `LEFT JOIN` aggregate — measured against the production-sample catalog size (≤30 types, ≤100 services) it returns in <10ms.
- **Save round-trip**: `updateStaff` budget unchanged from 006 (one `UPDATE` + one `recordAudit` insert). The three new fields add one row-trigger-eval each (the array trigger executes once per non-empty `supply_except`). Realistic upper bound: 64 element checks against a 30-row catalog = 1.5K B-tree lookups, sub-millisecond.
- **Roster paint**: unchanged from 006. The new filter-chip counts are computed in the same RSC render that builds the roster array — O(N) where N ≤ 20 staff for the production salon.
- **Mobile bottom sheet open**: 300ms slide-up (instant for `prefers-reduced-motion` per Clarify Q2). Wizard sheet entry: same 300ms / instant under reduced-motion.

**Constraints**:

- Every visual value resolves to a Lacquer token (Constitution I). No raw hex, no off-scale spacing, no font weight outside 400/500/600, no emoji in chrome. The status dot uses `--success` / `--muted-foreground`; the PIN pill uses `--success` / `--success-foreground` (Set) and `--warning` / `--warning-foreground` (No PIN); the danger zone uses `--destructive` / `--destructive-foreground` tints; chips and badges all token-sourced. All new selectors land in `styles/settings.css` per the established convention.
- All writes flow through Server Actions; the kiosk JWT has no policy on the three new `staff` columns (it can only insert `walk_ins` per 015 — the existing RLS catches any attempt) (Constitution II).
- Every staff update that mutates any of the three new fields writes an `audit_log` row with `before`/`after`/`changes` diff in the same request (SC-004), reusing 006's `staff.updated` action verb (no new verb needed — the diff payload extension is content-only, no schema change on `audit_log`) (Constitution III).
- Authorization mirrors 006: only `owner` or `manager` may mutate; self-edit of the three new fields is allowed (Clarify Q1) but self-edit of role/active stays blocked (existing `SELF_BLOCKED_ACTIONS`).
- Migration applied via the existing GitHub Actions (`db-migrate-preview.yml` on PR; `db-migrate-prod.yml` on push to `main`). **No manual `supabase db push`** (Constitution v1.0.3 "Schema drift forbidden").
- Animation budget unchanged: 300ms sheets (mobile bottom + wizard right), 150ms hover/press (chip selection highlight, picker checkbox tick), 200ms popover (status-badge tooltip if used). All animations honor `prefers-reduced-motion: reduce` (instant transition).
- The `supply_except` array length cap is 64 — well above realistic catalog size (≤30 today). The validator enforces it; the DB has no hard CHECK on length (the cap is a defensive app-layer guard against pathological FormData submission, not a domain rule).
- The trigger `staff_assert_supply_except_valid_trg` runs `BEFORE INSERT OR UPDATE on staff` and is `for each row` — it performs `unnest(NEW.supply_except)` and joins against `supply_types(id)`; mismatches raise `EXCEPTION foreign_key_violation` so the row is rejected. The `after delete on supply_types` trigger is `for each row` and updates `staff set supply_except = array_remove(supply_except, OLD.id) where OLD.id = any(supply_except)` — cheap (indexed via the staff PK; the GIN-vs-no-index tradeoff is moot at our scale).

**Scale/Scope**: Single salon. Expected staff roster size ≤20 active + ≤20 inactive (production sample today: ~6 active). Expected supply-types catalog size ≤30 types (production sample today: ~6). ≤10 concurrent operator devices. Scope of this feature:

- 1 new migration (`0018_staff_pay_deductions.sql`) — 3 new columns + 1 CHECK + 2 triggers.
- 1 modified Server Action file — `app/(studio)/settings/staff/actions.ts` (extends `updateStaff` to accept 3 new FormData fields; new `update_pay_deductions` action label routed to `assertMutationAllowed`).
- 1 modified validator file — `app/(studio)/settings/staff/_validation.ts` (adds `validateSupplyMode` + `validateSupplyExcept` + 2 new `ValidationErrorCode` values: `invalid_supply_mode`, `invalid_supply_except_shape`).
- 1 modified permissions file — `app/(studio)/settings/staff/permissions.ts` (adds `"update_pay_deductions"` to `StaffAction` union — NOT in `SELF_BLOCKED_ACTIONS`).
- 1 modified types file — `app/(studio)/settings/staff/_types.ts` (extends `RosterStaff` with the three new optional fields used by the panel — `card_fee_exempt: boolean`, `supply_mode: 'apply' | 'partial' | 'exempt'`, `supply_except: string[]`).
- 1 new validator-and-summary helper — `app/(studio)/settings/staff/_summary.ts` (pure helper: `formatSummary({ firstName, cardExempt, supplyMode, exemptedTypeNames }) → string | null` — implements the five posture variants from US3 + the front-desk hint).
- 1 new audit-diff helper — `app/(studio)/settings/staff/_audit-diff.ts` (mirrors 021's `app/(studio)/services/_audit-diff.ts`: exports `STAFF_DIFF_KEYS` array of seven keys — the existing four `display_name`/`role`/`color_token`/`active` plus three new — and `buildChanges(before, after)` returning the documented diff shape).
- 1 new supply-catalog helper — `app/(studio)/settings/staff/_supply-catalog.ts` (server-only: `loadSupplyCatalogForStaff(staffId): Promise<{ types: { id, name, archived, service_count, sample_amount_cents }[] }>` — single SQL with `count(*) filter` + `mode() within group`).
- 1 modified page — `app/(studio)/settings/staff/page.tsx` (extends the SELECT to project the three new columns; computes filter-chip counts for the prop; passes the supply catalog into the panel via `loadSupplyCatalogForStaff(selectedTarget.id)` when a target is selected).
- 1 modified UI client (EditPanel) — `components/lacquer/staff/edit-panel.client.tsx` (restructure into four section cards + danger zone block; mount `<PayDeductionsSection>`; wire the live status badges to the draft state; the existing fields and existing handlers are otherwise preserved).
- 1 modified UI client (StaffRow) — `components/lacquer/staff/staff-row.tsx` (status dot + tinted PIN pill + tabular added-date + faded opacity for inactive + left accent bar when selected + mobile chevron).
- 1 modified UI client (StaffTable) — `components/lacquer/staff/staff-table.client.tsx` (replaces the show-inactive `<Switch>` with `<RosterFilterChips>`; consumes the per-status counts prop; persists chip selection in localStorage; the existing search input is preserved).
- 1 modified UI client (PageHeader) — `components/lacquer/staff/page-header.tsx` (no structural change but the title/cta layout adjusts to accommodate the chip bar; minimal edit).
- 1 modified UI client (AddStaffWizard) — `components/lacquer/staff/add-staff-wizard.client.tsx` (redesign to wizard-pill layout per spec US7 — three step pills, live preview card, sticky footer; the underlying `addStaff` + `setStaffPin` actions are unchanged).
- 1 modified empty-state — `components/lacquer/staff/empty-state.tsx` (context-aware copy per filter chip: "No active staff." / "No inactive staff." / "No staff in this salon yet." with an inline link offering to switch filters).
- 6 new UI files in `components/lacquer/staff/`:
  - `pay-deductions-section.client.tsx` — the Pay & deductions section card (toggle row + segmented + per-type picker + summary + front-desk hint).
  - `roster-filter-chips.client.tsx` — the All/Active/Inactive chip group with tabular counts + localStorage persistence.
  - `status-badges.tsx` — derived header badges (Active/Inactive + Card-fee exempt / Supply-exempt / Partial supply exemption). Pure rendering — input is the live draft state.
  - `status-dot.tsx` — leading status dot for the StaffRow.
  - `danger-zone.client.tsx` — the danger-zone block stacking Deactivate/Reactivate + Remove + the existing confirm dialogs.
  - `staff-mobile-sheet.client.tsx` — mobile-only bottom-sheet wrapper around the EditPanel (consumes the panel render-tree and re-mounts it inside a `Sheet side="bottom"` when viewport <900px).
- 1 modified CSS file — `styles/settings.css` (append `.staff-row-redesigned*`, `.staff-status-dot*`, `.staff-pin-pill*`, `.staff-filter-chips*`, `.staff-panel-section*`, `.pay-deductions-section*`, `.danger-zone*`, `.staff-mobile-sheet*`, `.staff-fab*`, `.add-staff-wizard-pills*` selectors — every value resolves to a token).
- 7–10 new Vitest specs (`tests/unit/staff/validation-supply-mode.test.ts`, `tests/unit/staff/validation-supply-except.test.ts`, `tests/unit/staff/audit-diff.test.ts`, `tests/unit/staff/summary.test.ts`, plus extensions to existing `permissions.test.ts` for the new `update_pay_deductions` action).
- 1 new Playwright spec (`tests/e2e/staff-payout-exemptions.spec.ts` covering US1, US2 — including Q3 archived-still-exempted UX, US3 summary sentence). Existing `tests/e2e/staff.spec.ts` updated for the redesigned row + chips + section structure.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | ✅ Pass | Every visual value resolves to a token in `styles/tokens.css`. The redesigned roster row, filter chips, sectioned edit panel, danger zone, Pay & deductions section, mobile bottom sheet, and wizard pills all adapt the matching surfaces in `design-system/Staff Settings.html` + `design-system/staff-components.jsx`. Components stay shadcn primitives (`Switch`, `ToggleGroup`, `Sheet`, `Checkbox`, `Popover`, `Button`) composed in `components/lacquer/staff/*` — no second library. Icons stay Lucide (`Check`, `Power`, `PowerOff`, `Trash2`, `KeyRound`, `ChevronRight`, `Box`, `AlertCircle`) sized 12/14/16/20, 1.5px stroke. Status dot color resolves to `--success` / `--muted-foreground`; PIN pill to `--success`+`--success-foreground` and `--warning`+`--warning-foreground`; danger zone tint to `--destructive` family. Inactive-row opacity = `0.6` (a token-level alpha used elsewhere — not a custom value). Animations: 300ms ease-out sheets, 150ms hover/press, all honoring `prefers-reduced-motion: reduce` per Clarify Q2. Side-by-side compare against `design-system/Staff Settings.html` is the last step before final gate. |
| **II. Server-Authoritative Architecture** | ✅ Pass | Reads on `/settings/staff` continue via `createSupabaseServerClient()` in the Server Component. Mutations: `updateStaff` (extended), unchanged `addStaff` / `setStaffPin` / `deactivateStaff` / `reactivateStaff` / `removeStaff`. Authorization gate inside `updateStaff` via `assertMutationAllowed(ctx, 'update_pay_deductions')` — owner or manager only, manager-on-owner still blocked. Per Clarify Q1 self-edit of the three new fields is allowed (non-destructive, payout-economics only) and is NOT in `SELF_BLOCKED_ACTIONS`. RLS unchanged — the new `staff` columns are read/written under the same row policies that already cover the existing columns. Kiosk JWT has no policy on the three new columns (its grant is scoped to `walk_ins` per 015). The PayDeductionsSection client island holds draft state only; it never writes to the DB. The mobile sheet and wizard pills are visual chrome — actions are the same Server Actions. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | ✅ Pass — partial scope | No money moves in this feature (capture-only; checkout/payout wiring stays Phase 3 per spec Assumptions). The audit obligation: (a) every `updateStaff` call that mutates any of `card_fee_exempt`/`supply_mode`/`supply_except` writes a single `staff.updated` audit row whose payload's `before`/`after`/`changes` extend the existing 006 shape with the three new keys; (b) the `_audit-diff.ts` helper mirrors 021's `_audit-diff.ts` byte-for-byte in structure — same `DIFF_KEYS` array, same `buildChanges()` signature, same null-safety; (c) `supply_except` diff entries store raw uuids (not name snapshots) per spec FR-014; the audit viewer (downstream) resolves names live from the catalog. SC-004 ("100% of exemption transitions are reflected in the audit log within the same request as the save") is met by reusing 006's `await recordAudit(...)` before `revalidatePath + redirect`. No new audit-log action verbs (still `staff.updated`); no audit-log schema change. Per Clarify Q1 self-edits are allowed and ARE audited — operator id is the actor, target id is the affected staff (which equals operator id for self-edits). |
| **IV. Test-First for Critical Paths** | ✅ Pass — partial scope | Per Principle IV, TDD-with-failing-tests is mandatory for money/auth/refund/cash-drawer/tip-allocation/audit logic. This feature touches **audit logic** (extending the staff.updated diff payload). The audit assertions in `tests/e2e/staff-payout-exemptions.spec.ts` land BEFORE the implementation that satisfies them — Phase 2 of `tasks.md` will sequence the spec scaffold + audit assertions ahead of the `updateStaff` extension + the audit-diff helper. Vitest unit tests for the four new pure helpers + the `permissions.ts` extension are also test-first for the audit-diff helper specifically (the others are non-critical-path UI helpers but still get tests for SC-007 traceability). All tests run in CI on every PR. |
| **V. Scope Discipline & Cost Restraint** | ✅ Pass | Scope matches the spec exactly. Explicit out-of-scope items stay deferred: (1) checkout / receipt / payout wiring for the new exemptions — Phase 3 of deductions roadmap; (2) studio-level default-card-fee editor — still Phase 2 of 021 (the subtitle resolves the live value but the source helper still holds a hardcoded constant); (3) styling of other Settings sub-pages (General / Notifications / Billing) — those pages' content is unchanged, only the shared tab bar links them; (4) other prototype redesigns (payroll, EOD) — explicit Out of scope. No new infrastructure, no new paid services, no new runtime dependencies — three columns + two triggers on the existing `staff` table, well inside the ~$25–45/mo envelope. |

**Gate result: PASS — proceed to Phase 0.** No violations to justify; Complexity Tracking table is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/023-staff-payout-exemptions/
├── plan.md                              # This file
├── spec.md                              # Already written (/speckit-specify + /speckit-clarify)
├── research.md                          # Phase 0 — decisions + rationale
├── data-model.md                        # Phase 1 — schema delta, types, validators, transitions, migration outline
├── quickstart.md                        # Phase 1 — how to run, verify, and visually compare
├── checklists/
│   └── requirements.md                  # Spec-quality checklist (already written)
└── contracts/
    ├── README.md                        # Index across the four contracts
    ├── db-migration.contract.md         # 0018 columns + CHECK + 2 triggers + RLS reuse
    ├── server-actions.contract.md       # updateStaff FormData extension + error codes + audit row shape
    ├── audit-payload.contract.md        # staff.updated diff key extension + supply_except raw-uuid rule
    └── ui.contract.md                   # PayDeductionsSection state machine + RosterFilterChips persistence + mobile sheet + wizard pills
```

### Source Code (repository root)

The repo is a single Next.js 16 App Router project at the root. This feature adds and edits the following:

```text
supabase/
└── migrations/
    └── 0018_staff_pay_deductions.sql           # NEW — add 3 columns to staff + CHECK + 2 triggers (BEFORE INSERT/UPDATE on staff + AFTER DELETE on supply_types)

lib/
└── auth/
    └── audit.ts                                # UNCHANGED — staff.updated already exists from 006; no new action verb needed (payload extension is content-only)

app/
└── (studio)/
    └── settings/
        ├── layout.tsx                          # UNCHANGED — already mounts <TabBar /> per the existing shipped settings shell
        ├── page.tsx                            # UNCHANGED — already redirects to /settings/staff
        └── staff/
            ├── page.tsx                        # EDIT — extend SELECT to project 3 new columns; compute per-status counts; load supply catalog when target is selected
            ├── actions.ts                      # EDIT — extend updateStaff to accept card_fee_exempt + supply_mode + supply_except; wipe array when mode ≠ partial; route through 'update_pay_deductions' action
            ├── _validation.ts                  # EDIT — add validateSupplyMode + validateSupplyExcept + 2 new ValidationErrorCode values
            ├── permissions.ts                  # EDIT — add 'update_pay_deductions' to StaffAction union (NOT in SELF_BLOCKED_ACTIONS per Clarify Q1)
            ├── _types.ts                       # EDIT — extend RosterStaff with the 3 new fields
            ├── _summary.ts                     # NEW — formatSummary({ firstName, cardExempt, supplyMode, exemptedTypeNames }) → string | null (five posture variants + front-desk hint)
            ├── _audit-diff.ts                  # NEW — STAFF_DIFF_KEYS + buildChanges() mirroring 021's services/_audit-diff.ts
            ├── _supply-catalog.ts              # NEW — loadSupplyCatalogForStaff(staffId): server-side single-SQL aggregate (count(*) FILTER + mode() WITHIN GROUP)
            ├── _filter.ts                      # KEEP — unchanged
            ├── _sort.ts                        # KEEP — unchanged
            └── toasts.ts                       # KEEP — unchanged (the existing 'updated' toast covers Pay & deductions saves — no new toast key needed; the body of the existing toast is generic)

components/
└── lacquer/
    ├── settings/
    │   └── tab-bar.tsx                         # UNCHANGED — already shipped
    └── staff/
        ├── edit-panel.client.tsx               # EDIT — restructure into 4 section cards + danger zone; mount <PayDeductionsSection>; wire live status badges
        ├── pay-deductions-section.client.tsx   # NEW — toggle + segmented + per-type picker + summary + front-desk hint
        ├── status-badges.tsx                   # NEW — derived header badges (Active/Inactive + exemption posture)
        ├── status-dot.tsx                      # NEW — leading status dot for StaffRow
        ├── danger-zone.client.tsx              # NEW — Deactivate/Reactivate + Remove block (consumes existing confirm dialogs)
        ├── staff-mobile-sheet.client.tsx       # NEW — mobile-only bottom-sheet wrapper around <EditPanel>
        ├── roster-filter-chips.client.tsx      # NEW — All/Active/Inactive chips with tabular counts + localStorage persistence
        ├── staff-row.tsx                       # EDIT — status dot + tinted PIN pill + tabular date + faded inactive + left accent bar + mobile chevron
        ├── staff-table.client.tsx              # EDIT — replace <Switch> with <RosterFilterChips>; consume counts prop; existing search preserved
        ├── add-staff-wizard.client.tsx         # EDIT — redesign to wizard-pill layout (3 step pills + live preview card + sticky footer); existing actions unchanged
        ├── add-staff-button.client.tsx         # EDIT — minor edit if needed for FAB integration on mobile (otherwise KEEP)
        ├── page-header.tsx                     # EDIT — accommodate chip-bar layout (small adjustment, may be unchanged depending on final layout)
        ├── empty-state.tsx                     # EDIT — context-aware copy per active filter chip + inline switch-filter link
        ├── change-pin-modal.client.tsx         # KEEP — unchanged
        ├── color-picker.tsx                    # KEEP — unchanged
        ├── confirm-dialog.tsx                  # KEEP — unchanged (DangerZone consumes it)
        ├── initials.ts                         # KEEP — unchanged
        └── staff-toaster.client.tsx            # KEEP — unchanged

styles/
└── settings.css                                # EDIT — append selectors for the redesigned row, chips, sectioned panel, danger zone, Pay & deductions, mobile bottom sheet, wizard pills, FAB

tests/
├── unit/
│   ├── staff/
│   │   ├── validation-supply-mode.test.ts      # NEW — three accepts + everything else throws invalid_supply_mode
│   │   ├── validation-supply-except.test.ts    # NEW — dedup, unknown-id drop, 64-entry cap, empty, non-array input
│   │   ├── audit-diff.test.ts                  # NEW — STAFF_DIFF_KEYS = 7 keys; buildChanges shape for each combination
│   │   ├── summary.test.ts                     # NEW — five posture variants + front-desk hint
│   │   └── permissions.test.ts                 # EDIT — assert update_pay_deductions allowed for self, blocked for manager-on-owner
│   └── (existing staff tests untouched)
└── e2e/
    ├── staff-payout-exemptions.spec.ts         # NEW — US1 (card-fee), US2 (supply-mode + per-type picker + archived-still-exempted Q3), US3 (summary)
    └── staff.spec.ts                           # EDIT — replace show-inactive switch assertions with filter chip assertions; update row text/dot/PIN-pill structure assertions; assert sectioned edit panel + danger zone block

CLAUDE.md                                       # EDIT (auto by Phase 1 step 3) — update SPECKIT block to point at this plan
```

**Structure Decision**: Single Next.js project (Option 1 — DEFAULT for this repo, established in 001 and reused by every feature since 006). This feature **extends** the existing `app/(studio)/settings/staff/*` and `components/lacquer/staff/*` trees — same `_validation.ts` / `_types.ts` / `_load`-pattern (read helper) / `_audit-diff.ts` (new, mirrors 021), same Server-Action prelude, same URL-toast bridge, same `assertMutationAllowed` + `recordAudit` rhythm. Three new helpers join the existing six: `_summary.ts` (pure), `_audit-diff.ts` (pure, mirrors 021's services/_audit-diff.ts), `_supply-catalog.ts` (server-only — equivalent in role to 021's `_load.ts` but scoped to the per-staff supply-catalog aggregate). Six new UI files compose into the redesigned panel and roster; the existing 13 UI files in `components/lacquer/staff/` are edited or kept as-is. The Settings layout and root page (the tab bar + redirect) are **already shipped** — verified at `app/(studio)/settings/layout.tsx` and `app/(studio)/settings/page.tsx` — so FR-025 and FR-026 are satisfied with zero edits to those files.

## Complexity Tracking

No constitution violations to justify. Table intentionally omitted.
