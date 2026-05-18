# Phase 0 — Research: Per-service deductions + two-pane services layout

**Feature**: `021-services-deductions` · **Date**: 2026-05-17

Decisions resolving the Technical Context's open questions and the spec's surface-level "how do we model this" calls. Each entry: **Decision · Rationale · Alternatives considered**. The spec was already clarified on the panel's Close affordance (omit it) and the cap on user-typed amounts (`$50`), so this file resolves the implementation-tier questions those clarifications opened.

The spec marked **no NEEDS CLARIFICATION** entries in Technical Context — every open call is an implementation choice between equally valid options, not a behavior gap.

---

## R1 · Card-fee mode storage shape

**Decision**: Store `card_fee_mode` as `text` with a column-level CHECK constraint allowing exactly three values: `'default'`, `'custom'`, `'exempt'`. Default to `'default'` so existing rows are backfilled at migration time without a separate `UPDATE`.

**Rationale**: A `text` column with a CHECK matches the existing convention for tri-state-ish controlled vocabularies in this repo (`staff.role`, `audit_log.action`). PostgreSQL enums are heavier to evolve (`alter type … add value …` requires a transaction-detaching DDL in some cluster configurations); a CHECK can be loosened or replaced in a follow-up migration without dropping a type. The three values are small, stable, and human-readable in audit_log payloads.

**Alternatives considered**:
- **Postgres ENUM** — rejected: harder to evolve (every Phase 2/3 value addition is a migration step that may need superuser); audit_log payloads still serialize to text either way.
- **Three booleans (`card_fee_is_default` / `_is_custom` / `_is_exempt`)** — rejected: would need an "exactly-one-true" CHECK and offers no win over a single tri-state column.
- **Smallint encoding (0/1/2)** — rejected: opaque in audit payloads and SQL inspection; the readability of `'exempt'` is worth the extra bytes.

---

## R2 · `card_fee_custom_cents` nullability & paired CHECK

**Decision**: `card_fee_custom_cents` is nullable. A single cross-column CHECK enforces the pairing: when `card_fee_mode = 'custom'` the column MUST be non-null AND in `[0, 5000]`; when `card_fee_mode != 'custom'` the column MUST be null. The Server Action sets it to `null` whenever the saved mode flips off `'custom'`.

**Rationale**: A null `card_fee_custom_cents` for `mode = 'default'` and `mode = 'exempt'` is the cleanest "this column doesn't apply" signal — the read path checks `mode` first and only consults the cents column when relevant. Forcing a 0 (or 300) value when mode is `'default'` would invite confusion ("is this $0 custom or $3 default?"). The Server Action's "clear on mode-flip" guarantees the column never carries stale state; the CHECK is the defense-in-depth backstop. Cap of `$50` is per Clarifications Q2 — same cap as supply; the Server Action validates and the CHECK enforces.

**Alternatives considered**:
- **Always-non-null with sentinel `-1` for "n/a"** — rejected: a negative cents value collides with the `>= 0` invariant readers expect.
- **Separate "card_fee_override_cents" + "card_fee_exempt" boolean** — rejected: doubles the column count without behavioral gain; mode-as-text is one column to query.
- **Drop the upper cap and rely solely on app validation** — rejected: the cap is a "fat-finger guard" (per spec Clarifications Q2), and the constitution's "DB CHECK is the trust boundary" guidance (R1 in 008) applies — the cap MUST be enforced at both layers.

---

## R3 · Supply pair shape (`supply_amount_cents` + `supply_label`)

**Decision**: Two nullable columns: `supply_amount_cents` (integer; when non-null, `1 <= value <= 5000`) and `supply_label` (text; when non-null, `1 <= length(trim(value)) <= 64`). One cross-column CHECK enforces "both null OR both non-null." The Server Action treats Supply-on as setting both, Supply-off as clearing both (atomic on the row UPDATE).

**Rationale**: The two columns capture orthogonal concepts (a number and a string) that have no meaning apart from each other — making them pair-nullable matches the data shape exactly. Putting them in a JSONB column would hide the values from PostgREST select lists and make the audit diff harder to express. The `1`-cent floor (per Clarifications Q2 and FR-016) reflects the "Supply-on with `$0` is a contradiction" rule from US3 — a true zero is the toggle-off state. The 64-char label limit (FR-020) is enforced by `check (length(trim(supply_label)) BETWEEN 1 AND 64)` AND by `validateSupplyLabel` in app validation — matching the same two-layer enforcement as the cap.

**Alternatives considered**:
- **One JSONB column `supply jsonb`** — rejected: opaque to PostgREST, harder to write a CHECK for, harder to render in audit diffs.
- **A separate `service_supply` table joined 1:1** — rejected: this is Phase 1 of a 3-phase plan; an extra table is overkill for two columns we always read together with the parent row.
- **Drop the upper cap on supply** — rejected: same fat-finger guard as the card-fee cap; both caps share the `$50` ceiling for the same reason (per spec Clarifications Q2). Supply is bounded `1..5000` (strictly positive); card fee is bounded `0..5000` (zero permitted because "intentionally $0 custom" is a valid mode-custom choice).

---

## R4 · Where the `$3` default lives

**Decision**: A single named constant in TypeScript at `lib/services/card-fee-default.ts` exporting `DEFAULT_CARD_FEE_CENTS = 300` and a `formatDefaultCardFee()` helper returning the rendered string (`"$3"`). All three read sites (the Segmented control's "Default · $3" label, the catalog row's "$3 card fee" chip, the Net-to-tech preview's calculation when `mode = 'default'`) import from this one constant. Phase 2 replaces the constant with `loadCardFeePolicy()` reading from the (future) policy table — no service row migration required.

**Rationale**: Per FR-011 the default amount MUST be sourced from a single named constant. A `lib/services/` shared module makes the constant accessible to both server (Server Action audit payload, list-row chip) and client (Segmented label, Net preview) without circular imports. Keeping it as a constant (not a `lazy(() => loadPolicy())`) avoids any race on Phase 2's transition — when Phase 2 ships, this single file's export becomes async (the import sites await it), and the column flip is mechanical.

**Alternatives considered**:
- **Constant inside `_deductions.ts`** — rejected: would couple a UI/business helper module to a value that should be visible to the migration's seed audit and to the future policy module.
- **Environment variable** — rejected: not a config concern (the salon doesn't set `$3` per deployment); a constant in code is the right granularity for v1.
- **Stored row in `settings` table** — rejected: the schema reservation for `settings` is owned by Phase 2's policy entity; pre-seeding a row now would imply a public read API that doesn't exist.

---

## R5 · Net-to-tech preview math placement

**Decision**: Implement `computeNetToTechCents(input)` as a **pure function** in `app/(studio)/services/_deductions.ts`. The function takes a typed input bag `{ price_cents, card_fee_mode, card_fee_custom_cents, supply_amount_cents }` and returns `{ net_cents, card_fee_cents, supply_cents }` so callers can render the breakdown lines from the same numbers. The function is called from two sites: the panel's `<DeductionsSection>` (client-side, on every keystroke) and the Vitest specs (covering each combinator).

**Rationale**: A pure function with a typed input bag is the smallest unit that tests both the preview math AND any future caller (Phase 3's checkout calculation will use the same shape). Locating it in `_deductions.ts` (a private feature-local module) keeps it adjacent to the validators that produce its inputs; promoting it to `lib/services/` is unnecessary in Phase 1 because no other surface consumes it yet (Phase 3 will hoist it then). The preview re-render is scoped to the `<DeductionsSection>` subtree so a price keystroke recomputes the four lines without reflowing the whole panel.

**Alternatives considered**:
- **Inline the math in `<DeductionsSection>`** — rejected: would duplicate the math in the Vitest specs and would make Phase 3's checkout extraction a multi-file change.
- **A Server Action returning the preview** — rejected: a network round-trip per keystroke would blow past the 100ms SC-004 budget; the math is trivial enough to live on the client.
- **A `useMemo` of an inline `for` loop** — rejected: the input bag is bounded and shallow; `useMemo` is unnecessary because React re-renders are already throttled by the input's controlled state.

---

## R6 · Where the audit diff picks up the four new columns

**Decision**: Extend the existing `SERVICE_DIFF_KEYS` tuple in `actions.ts` by four entries (`card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`) and extend the `ServiceDiffSnapshot` type to match. The existing `buildChanges(before, after)` helper naturally picks up the new keys — no new code path. The `before` and `after` snapshot objects in the `service.updated` payload gain the four fields. `service.added`'s echoed-fields list grows by four. **No new audit verb, no new payload shape.**

**Rationale**: The 008 audit contract already documents a stable shape (`{ changes, before, after, assignment_changes }`); extending the field set is a non-breaking change to consumers (the four new keys appear only on rows that touched a deduction column). A new verb (`service.deduction_updated`) would be misleading — deductions are a property of the service, not a separate entity, and an owner who changes a price AND a card-fee mode in the same save should see both in the same diff. Per FR-030 deduction fields appear in the diff **only when they changed in this save** — the existing key-by-key diff loop already provides this property.

**Alternatives considered**:
- **A separate `service.deductions_updated` verb** — rejected: doubles the audit volume for combined edits and forces consumers to join two rows to reconstruct a single save.
- **A nested `deductions: { ... }` object in the payload** — rejected: would break the existing `changes` shape (key-keyed flat diff) for no readability gain.
- **No audit extension; rely on the column-level `updated_at` trigger** — rejected: violates Constitution III's "who changed what" requirement — `updated_at` records only the change, not the diff.

---

## R7 · Discard-changes gate semantics in the two-pane layout

**Decision**: The existing `<DiscardChangesDialog>` from 008 is reused unchanged. The gate fires when the operator clicks a **different list row** OR clicks "Add service" while the current panel draft is dirty. The gate does NOT fire on save success (the panel re-baselines after a successful save), on archive (the panel stays on the just-archived row), or on browser navigation (Next.js's beforeunload is not hooked — same as 008). The panel's "deselect" gestures are: click another row → guard fires → switches; click "Add service" → guard fires → switches to add mode; navigate away → no guard (consistent with 008).

**Rationale**: The clarification (Q1) established that the panel has no Close affordance — the panel is always visible. The natural surface for the guard is therefore the row-switch interaction, not a Close button. Reusing the existing dialog (vs. introducing a panel-bottom inline confirm) keeps the visual vocabulary stable and matches the prototype's rhythm: the panel shows the draft; the dialog interrupts the selection switch. The "Add service" trigger of the same gate matches FR-005's "FR-004's discard-confirm gate MUST fire first" requirement.

**Alternatives considered**:
- **Inline "You have unsaved changes" banner at the panel top** — rejected: would force the operator to scroll up to see and would block the row-switch only via a soft visual cue, not a hard gate.
- **Auto-save on row-switch** — rejected: too risky for a catalog screen where one wrong save mid-edit could persist garbage; an explicit Discard / Cancel keeps the operator in control.
- **Per-row "dirty" badge on the list** — rejected: out of scope for this phase and would clutter the list rows that already carry chips.

---

## R8 · Chip render strategy on the catalog row

**Decision**: The catalog row's deduction chips render via a new server component `deduction-chips.tsx` that accepts the row's `card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`, and the resolved `DEFAULT_CARD_FEE_CENTS` constant. The component returns 0–2 `<span>` chips inside a `<div role="group">` with `gap: 6px`. The decision tree:
- `card_fee_mode = 'default'` AND no supply → render a single `card` chip "{$3} card fee".
- `card_fee_mode = 'custom'` AND no supply → render a single `card` chip "{$amount} card fee".
- `card_fee_mode = 'exempt'` AND no supply → render a single `exempt` muted chip "No fees".
- Supply present (regardless of card-fee mode) → render card chip first (if mode != exempt), supply chip second.
- `card_fee_mode = 'exempt'` AND supply present → render only the supply chip (no card-fee chip, no "No fees" chip).

**Rationale**: Server-rendering the chips keeps the catalog list a pure RSC — no client island per row, no hydration cost. The decision tree maps 1:1 to FR-015 / FR-022 / FR-023 / FR-024 so the contract is straightforward to test in Vitest (the helper that picks chip kinds is unit-testable separately from the JSX). The chip palette is fixed in CSS (`.deduction-chip--card`, `.deduction-chip--supply`, `.deduction-chip--exempt`) so the variants are picked via a `data-kind` attribute, not inline styles.

**Alternatives considered**:
- **Client-side chip rendering** — rejected: no interactivity is needed; server is cheaper.
- **A single chip with both fee and supply text** — rejected: violates the prototype's visual rhythm (two distinct tones at a glance) and would force operators to parse a comma-separated string.
- **A "deductions" tooltip showing the breakdown on hover** — rejected: chips already carry the breakdown inline; a tooltip is redundant.

---

## R9 · Migration backfill safety

**Decision**: The migration `0016_services_deductions.sql` adds the four columns with the following defaults: `card_fee_mode` non-null default `'default'`; `card_fee_custom_cents`, `supply_amount_cents`, `supply_label` all nullable with no default. Existing rows automatically get `card_fee_mode = 'default'` via the column default; the three nullable columns are null on existing rows. The CHECK constraints are added AFTER the columns (and after the default backfills the existing rows) so the constraints don't bounce mid-migration. No `UPDATE` statement is needed beyond the column default. Re-runnability is preserved via `add column if not exists`.

**Rationale**: Adding a non-null column with a default is a single-statement DDL in Postgres 12+; PostgREST returns rows with the new column populated immediately. Adding the CHECK constraints after the defaults backfill means the constraints never see a transient invalid row. The `if not exists` guards make the migration idempotent (matching the convention of 0003 and the rest of the migrations under `supabase/migrations/`). Per Constitution v1.0.3 "Schema drift forbidden", the migration is applied by the two existing GitHub Actions on PR and on push to `main`; we do not run `supabase db push` by hand.

**Alternatives considered**:
- **Add columns nullable, write a separate UPDATE backfill, then ALTER ADD CONSTRAINT** — rejected: more SQL for the same result; the column default is exactly the backfill we need.
- **Run the migration in two steps (column add → CHECK add) across two PRs** — rejected: this is a single feature; splitting it doubles the schema-drift window.
- **Use a SQL function to perform the column add + backfill inside a transaction** — rejected: DDL transactions exist for free in Postgres for the `add column` case; no function needed.

---

## R10 · Panel state machine in the two-pane layout

**Decision**: The new `<EditPanel>` consumes the same `mode: 'closed' | 'add' | 'edit'`, `baseline: ServiceDraftBaseline | null`, `categories: string[]`, `operatorRole: StudioRole` props the existing `<Drawer>` consumed in 008. The `'closed'` mode renders the empty-state inspector ("Pick a service to edit, or add a new one"). The `'add'` mode renders the form with a fresh draft. The `'edit'` mode renders the form pre-filled from `baseline`. The page Server Component's mode resolver is unchanged from 008 — `?selected=<id>` wins over `?adding=1`. The deselect gestures (click a different row, click "Add service") use Next.js's client-side `router.push()` to update the URL and trigger the page's mode resolver.

**Rationale**: Reusing the prop shape means the page-side wiring stays identical — only the component name + the layout shell change. The state machine itself maps directly to the spec's acceptance scenarios in US1. The empty-state rendering uses the same `Info` Lucide icon + the same Lacquer `--muted` background that the prototype shows; the copy ("Select a service on the left to edit, or add a new one.") matches FR-003 verbatim. No new query-param keys are introduced.

**Alternatives considered**:
- **Local React state for the panel mode (no URL backing)** — rejected: would break deep-linking (`/services?selected=<id>` no longer pre-opens the panel) and would not survive a Server Component re-render.
- **A panel-local "mode" state distinct from the URL** — rejected: dual state with one source of truth (URL) avoids the staleness bugs of two-way sync.

---

## R11 · Deletion of `drawer.client.tsx`

**Decision**: Delete `components/lacquer/services/drawer.client.tsx` in this feature's PR. No transitional alias, no two-mode flag, no archival copy. The replacement (`edit-panel.client.tsx`) is a strict superset of behaviors — every 008 acceptance scenario the drawer satisfied is exercised by the panel in 021's Playwright spec.

**Rationale**: Per `CLAUDE.md` "Avoid backwards-compatibility hacks like renaming unused _vars, re-exporting types … If you are certain that something is unused, you can delete it completely." After the page edit removes the only import of `drawer.client.tsx`, the file is dead code. Keeping it as a reference copy would invite drift; deletion is the correct disposition.

**Alternatives considered**:
- **Move it to `components/lacquer/services/_archive/`** — rejected: archives in source trees rot; if we need the old drawer back later, git history is the durable archive.
- **Keep both and add a feature flag** — rejected: this surface has one route; a flag would not buy any rollback safety that a revert wouldn't.

---

## Open questions

None. All Technical Context items are resolved by R1–R11 above. Phase 1 design proceeds.
