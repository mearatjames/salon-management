# Staff Settings Redesign — Spec Kit Prompts

Draft prompts for the per-staff payout exemptions + Settings → Staff UI
redesign work. The two prompts are designed to ship as **two sequential
features** (recommended split) — 022 lays the catalog foundation, then
023 builds the staff surface on top.

- **022-supply-types-catalog** — new `supply_types` table, refactor
  021's `services.supply_label` → `supply_type_id` FK, SupplyTypePicker
  on the Services edit panel, EditPolicySheet "Supply types" section.
- **023-staff-pay-exemptions** — Settings → Staff UI redesign +
  per-staff `card_fee_exempt` / `supply_mode` / `supply_except` columns
  consuming the catalog from 022.

## Background

- **021-services-deductions** (PR #22, shipped) added the per-service
  deduction columns to `services`: `card_fee_mode`,
  `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`. It
  also introduced `lib/services/card-fee-default.ts` with the
  `DEFAULT_CARD_FEE_CENTS = 300` constant.
- 021 used **free-text labels** for supply identity. The newer Lacquer
  design prototype models supply types as a first-class entity with
  stable UUIDs so renames can't orphan downstream references (per-tech
  exemptions, EditPolicySheet usage rollups, future checkout math).
- The newer Staff Settings prototype (`design-system/Staff
  Settings.html` + `design-system/staff-components.jsx`) adds a Pay &
  deductions section per staff, sectioned edit panel, danger zone,
  filter chips, mobile bottom sheet, and add-staff wizard pills.
- The newer Services prototype lives in
  `design-system/prototypes/services/` (V1 only). Both
  `ServicesV1.jsx` and `EditPolicySheet.jsx` explicitly state
  "Per-tech exemptions live on the Staff Settings page" — confirming
  the surface ownership split.

## Entry point note

Both prompts target `/speckit-specify` (or `/ship` for the whole
pipeline). `/speckit-implement` only runs an existing
`specs/<feature>/tasks.md`; there is no spec/plan/tasks for these
features yet, so it has nothing to implement against. Paste each prompt
as the first message of a fresh session after running `/speckit-specify`
(or `/ship`).

---

## 022 — Supply Types Catalog (ships first)

```text
/speckit-specify Supply types catalog + Services refactor from supply_label to supply_type_id.

CONTEXT
021-services-deductions (PR #22) shipped services.supply_label as
free-text. The newer design prototype models supply types as a
first-class entity so renames flow through every consumer (services,
EditPolicySheet, future Staff Settings exemptions) and identical types
are guaranteed identical via stable ids. This feature ships the catalog
+ refactors 021's per-service supply column to reference it. NO
checkout-time wiring yet (still Phase 3); NO per-staff exemptions yet
(023 picks that up).

DESIGN SOURCE OF TRUTH
- design-system/prototypes/services/Services Page.html
- design-system/prototypes/services/ServicesV1.jsx — SupplyTypePicker
  inline in the Deductions section
- design-system/prototypes/services/EditPolicySheet.jsx — new "Supply
  types" section: rename, archive (disabled while in use), usage count,
  indented sub-rows for referencing services, "+ Add supply type" row
- design-system/prototypes/services/services-data.jsx — useSupplyTypes
  hook + helper shapes; backed by the DB table here, not the in-memory
  prototype store

MIGRATION 0017_supply_types_catalog.sql
- New table public.supply_types (id uuid pk default gen_random_uuid(),
  name text not null, archived boolean not null default false,
  created_at + updated_at). Partial unique index on lower(name) where
  archived = false (prevents duplicate active names; archived rows can
  collide).
- Add services.supply_type_id uuid references supply_types(id)
  on delete set null.
- Backfill: for every distinct active services.supply_label (where not
  null), insert a supply_types row with that name and set the matching
  services rows' supply_type_id. Case-insensitive dedupe.
- After backfill: drop services.supply_label OR keep it as a
  denormalized display cache? Recommend DROP — the catalog is the
  source of truth; reads JOIN. (Confirm in clarify.)
- Update 021's services_supply_pair_chk: now
  `(supply_amount_cents IS NULL AND supply_type_id IS NULL)
   OR (supply_amount_cents IS NOT NULL AND supply_type_id IS NOT NULL
       AND supply_amount_cents BETWEEN 1 AND 5000)`.

UI / ACTIONS
- New SupplyTypePicker component (components/lacquer/services/
  supply-type-picker.client.tsx): dropdown of active types with inline
  "+ Create new supply type…" row that creates and selects in one
  move. Replaces the free-text label input in service-form.client.tsx
  Deductions section.
- EditPolicySheet "Supply types" section: list, inline rename
  (optimistic with rollback), archive button (disabled when
  service_count > 0), usage count, expandable sub-rows showing each
  referencing service as a click-to-jump link.
- New Server Actions in a new file
  app/(studio)/services/_supply-types/actions.ts:
  - createSupplyType, renameSupplyType, archiveSupplyType,
    reactivateSupplyType
  All revalidatePath('/services') AND '/settings/staff' so the staff
  page (when it lands in 023) picks up renames immediately.

NOT IN SCOPE
- Per-staff exemptions — see 023.
- Phase 3 checkout wiring.

CONSTRAINTS (Tang Nails CLAUDE.md)
- Constitution v1.0.3 Principle I non-negotiable: every styled value
  traces to a Lacquer token. Run /speckit-design-auditor at every
  phase that touches components/ or app/.
- Migration filename 0017_supply_types_catalog.sql, auto-applied by
  db-migrate-preview and db-migrate-prod GitHub Actions — never
  `supabase db push` manually.
- Full pre-push gates pass in order: format:check, lint, typecheck,
  test, test:e2e. Intermediate phase gates use scoped versions per
  CLAUDE.md (`-g "USn"` for e2e; git-diff-scoped prettier/eslint).
```

---

## 023 — Staff Settings UI + Per-staff Pay Exemptions (ships after 022)

```text
/speckit-specify Per-staff payout exemptions + Settings → Staff UI redesign.

CONTEXT
Phase 2b of the deductions roadmap. Builds on:
- 021-services-deductions (PR #22, shipped): added card_fee_mode +
  card_fee_custom_cents + supply_amount_cents + supply_label to services.
  DEFAULT_CARD_FEE_CENTS=300 lives in lib/services/card-fee-default.ts.
- 022-supply-types-catalog (PREREQUISITE — must ship first): introduces
  public.supply_types (id uuid pk, name text unique-when-active, archived
  boolean, created_at, updated_at), refactors services.supply_label into
  services.supply_type_id (uuid fk → supply_types.id, nullable). The
  Services edit panel uses a SupplyTypePicker; the EditPolicySheet has a
  Supply types CRUD section. After 022, distinct supply identity is a
  stable uuid that survives renames.

This feature adds per-staff overrides for both card fee and supply
deductions, and redesigns Settings → Staff to match the latest Lacquer
prototype (sectioned edit panel, danger zone, filter chips, mobile sheet,
add-staff wizard pills). Same capture-and-display posture as 021 — values
persist but checkout-time application is still Phase 3 (out of scope).

DESIGN SOURCE OF TRUTH
- design-system/Staff Settings.html — page chrome, tabs, layout, styles
- design-system/staff-components.jsx — PayDeductionsSection (lines 467–691),
  EditPanel restructure, AddStaffSheet wizard pills, MobileSheet, StaffRow
  redesign with status dot + selection bar + tinted PIN chip
- design-system/prototypes/services/services-data.jsx — useSupplyTypes()
  contract (consumed here verbatim in shape; backing store is the catalog
  table from 022, not the in-memory prototype store)
- design-system/prototypes/services/ServicesV1.jsx +
  design-system/prototypes/services/EditPolicySheet.jsx — both state
  "Per-tech exemptions live on the Staff Settings page". This feature
  owns that surface; Services does NOT mirror it.

Audit every styled value against design-system/colors_and_type.css per
CLAUDE.md design-system rules (no raw hex, 4px spacing scale, Inter
weights 400/500/600, Lucide icons 1.5px stroke, prototype-defined radii).

UI REDESIGN — Settings → Staff
1. Settings tab bar (General · Staff · Notifications · Billing) above
   the staff grid, mounted in app/(studio)/settings/layout.tsx so all four
   sub-pages share it. Replaces any current per-page nav.
2. All / Active / Inactive filter chips with tabular per-status counts,
   replacing the Show-inactive Switch. Persist active chip under
   "tn:settings:staff:filter" (new key; document the dropped legacy key
   "tn:settings:staff:show-inactive" inline).
3. Staff row: leading status dot (success/muted), left selection bar
   when selected, success-tinted "Set" / warning-tinted "No PIN" pill,
   faded opacity for inactive rows, right-aligned "Added MMM YYYY"
   tabular date. Mobile (<900px) drops trailing metadata and shows a
   chevron.
4. Edit panel sectioned cards:
   - panel-profile header: avatar + name + "<Role> · Added MMM YYYY" +
     derived status badges (Active/Inactive + No deductions /
     Card-fee exempt / Supply-exempt / Partial supply exemption when
     applicable)
   - Identity section: display name, role select, avatar color picker
   - Access section: Active toggle row + PIN row
   - NEW Pay & deductions section (see below)
   - Save changes (full-width primary inside panel-section)
   - Danger zone: red-tinted block stacking Deactivate / Reactivate
     and Remove from roster (matches prototype's `.danger-zone` rules)
5. AddStaffSheet right-side 420px sheet with wizard step pills
   (Details → Set PIN → Done), live preview card, sticky footer
   (Cancel + "Next: set PIN"). Keep the existing 2-step addStaff /
   setStaffPin Server Actions — visual chrome only.
6. Mobile (<900px): roster takes full width, edit panel becomes a
   bottom sheet (300ms slide-up, body scroll-locked, max 92vh), FAB
   triggers Add staff. Match the prototype's @media + [data-vp] rules.

NEW FUNCTIONALITY — per-staff Pay & deductions
Migration 0018_staff_pay_deductions.sql (0016 = 021, 0017 = 022) adds to
public.staff:
- card_fee_exempt boolean not null default false
- supply_mode text not null default 'apply' (CHECK in 'apply','partial','exempt')
- supply_except uuid[] not null default '{}' (each element FK-shaped to
  supply_types.id — see ARRAY INTEGRITY below)

PayDeductionsSection (mirror staff-components.jsx lines 467–691):

a) Card processing fee row
   - Toggle off ⇒ card_fee_exempt = true; toggle on ⇒ false
   - Subtitle when applied: "Standard {formatDefaultCardFeeLabel()}
     deducted on card-paid services." Import the helper from
     @/lib/services/card-fee-default — never hardcode "$3".
   - Subtitle when exempt: "Exempt — card fee never deducted from payout."

b) Supply deductions row
   - 3-way segmented: Apply all / Some / Exempt
   - Subtitle copy per mode verbatim from prototype

c) Per-type picker (only when supply_mode = 'partial')
   - Lists ACTIVE supply_types rows (where archived = false) plus any
     supply_type whose id is currently in this staff's supply_except even
     if archived (so an archived type the operator already exempted stays
     visible and uncheckable-without-explanation — render with an
     "Archived" muted pill).
   - Per-row usage line: "N services · typically $X per ticket" where
     N = count of active services with that supply_type_id and $X =
     mode (most-common) supply_amount_cents across those services,
     ties broken by smallest. Computed server-side in a single SQL
     aggregate, passed to the panel as a prop. Empty-usage row shows
     "Unused — no services reference this type yet."
   - Empty list (no active supply types AND empty supply_except):
     "No supply types defined yet. Add some on the Services page first."
   - Empty selection hint (supply_mode='partial' AND supply_except=[]):
     "No supply types selected — all costs will be deducted normally
     until you tick at least one."
   - Type names are resolved live at render time from the catalog — so
     a rename on the Services page reflects here on next page load
     (revalidatePath('/settings/staff') is fired by the 022
     supply-type-rename action).

d) Plain-language summary sentence (the prototype's `summary` switch).
   Render only when at least one exemption is in effect. Five variants:
   both-full, card+partial, card-only, supply-full, partial-only.
   Use the operator's first name. When listing exempted types in prose,
   resolve uuids to current names from the catalog at render time.

e) Non-service-role hint (target.role === 'front_desk' AND no exemptions
   active): "Front desk staff don't take services, so these settings
   normally don't affect their payouts. Configure if they occasionally
   cover service tickets."

ARRAY INTEGRITY — supply_except
- supply_except is uuid[] not text[]. Stable ids survive renames AND
  re-creates of the catalog row (DB cascade is the trust boundary).
- DB CHECK: when supply_mode <> 'partial', array_length(supply_except, 1)
  IS NULL (empty). The Server Action also wipes the array on
  apply/exempt transitions; the CHECK is the backstop.
- Foreign-key integrity: Postgres can't directly FK-constrain an array
  element. We enforce it via a trigger
  staff_assert_supply_except_valid_trg that runs BEFORE INSERT OR UPDATE
  on staff: for each non-empty supply_except, verify every element
  exists in supply_types. If supply_types ever physically deletes a row
  (022 uses archive-not-delete, so this is defensive), an ON DELETE
  trigger on supply_types pulls dead ids out of every staff.supply_except
  that references them.
- Validation in app/(studio)/settings/staff/_validation.ts:
  - validateSupplyMode(raw) → 'apply'|'partial'|'exempt' or throws
    ValidationError('invalid_supply_mode')
  - validateSupplyExcept(raw, allowedIds) → string[] — trims, dedupes
    via Set, drops unknowns silently (defensive — stale tab case),
    caps array length to 64 (well above realistic catalog size)

DATA WIRING
- New helper: app/(studio)/settings/staff/_supply-catalog.ts (server-only)
  exports `loadSupplyCatalogForStaff(staffId): Promise<{
    types: { id: uuid; name: string; archived: boolean;
             service_count: number; sample_amount_cents: number | null
           }[];
  }>`. Single SQL: SELECT t.id, t.name, t.archived,
  COUNT(s.id) FILTER (WHERE s.active) AS service_count,
  mode() WITHIN GROUP (ORDER BY s.supply_amount_cents) FILTER (WHERE s.active)
    AS sample_amount_cents
  FROM supply_types t LEFT JOIN services s ON s.supply_type_id = t.id
  WHERE t.archived = false OR t.id = ANY ((SELECT supply_except FROM staff
    WHERE id = $1))
  GROUP BY t.id, t.name, t.archived ORDER BY t.name;
- updateStaff (app/(studio)/settings/staff/actions.ts) accepts:
  - card_fee_exempt (FormData "on"/missing)
  - supply_mode (string)
  - supply_except (repeated FormData entries — uuids)
  Permission gate: reuses canEditAnyField. Self-edit of own
  card_fee_exempt / supply_mode / supply_except IS allowed
  (non-destructive; doesn't touch role/active).
- Mode-transition rule: when validateSupplyMode resolves to 'apply' or
  'exempt', the action UPDATEs supply_except = '{}' regardless of what
  the form submitted.
- Diff-aware audit payload extension to staff.updated (per
  audit.contract.md): the changes/before/after objects gain
  card_fee_exempt, supply_mode, supply_except keys when they differ.
  Mirror 021's app/(studio)/services/_audit-diff.ts helper pattern.
  Important: supply_except diff stores RAW uuids (no name snapshot) —
  the audit viewer resolves names at render time via the catalog. If a
  type is later archived, the audit row still shows the current name +
  an "Archived" badge.

OPEN QUESTIONS FOR /speckit-clarify
1. Self-edit of own card_fee_exempt / supply_mode / supply_except — draft
   says allow (non-destructive). Confirm.
2. partial → apply / partial → exempt transition: draft wipes
   supply_except at save time via the action, DB CHECK enforces. Client
   keeps the array in draft state across mode toggles so a fat-finger
   doesn't lose the picks until save. Acceptable?
3. Filter chips: persist across page loads (sessionStorage), or reset
   to "Active" on each visit? Draft persists.
4. Mobile bottom-sheet motion: prototype uses 300ms slide-up ease-out.
   Honor prefers-reduced-motion (instant)?
5. "$3 standard" subtitle: live value from DEFAULT_CARD_FEE_CENTS, or
   hardcoded so a future Phase 2 default change doesn't quietly mutate
   shipped copy? Draft uses the live helper.
6. Archived-type-still-exempted UX: render the row in the picker with
   "Archived" badge and disabled checkbox (draft), or quietly drop it
   on next save?

NOT IN SCOPE (follow-ups in plan.md)
- Phase 3 from 021: applying card_fee_exempt + supply_mode + supply_except
  at checkout / receipt / payout time.
- Studio-level default-card-fee editor (Phase 2 from 021; still a
  hardcoded constant in lib/services/card-fee-default.ts).
- Other settings tabs (General / Notifications / Billing) — the bar
  renders the links but their pages stay as-is.
- Resyncing the rest of the design handoff (payroll, EODHistory).

CONSTRAINTS (Tang Nails CLAUDE.md)
- Constitution v1.0.3 Principle I non-negotiable: every styled value
  traces to a Lacquer token. Run /speckit-design-auditor at every phase
  that touches components/ or app/.
- Migration filename: supabase/migrations/0018_staff_pay_deductions.sql
  (0016 = 021, 0017 = 022). Auto-applied by db-migrate-preview and
  db-migrate-prod GitHub Actions — never `supabase db push` manually.
- Full pre-push gates pass in order: format:check, lint, typecheck,
  test, test:e2e. Intermediate phase gates use scoped versions per
  CLAUDE.md (`-g "USn"` for e2e; git-diff-scoped prettier/eslint).
- e2e specs (USn scoped, mirroring 006 + 021 conventions):
  - US1 (UI redesign): tabs render, filter chips update counts, staff
    row shows status dot + tinted PIN chip, inactive row faded.
  - US2 (Card fee exemption): toggle persists + writes audit row with
    card_fee_exempt diff.
  - US3 (Supply mode apply ↔ exempt): segmented control persists +
    supply_except auto-wiped + audit row + DB CHECK satisfied.
  - US4 (Supply partial): switch to Some, tick a uuid, supply_except
    persists, summary sentence renders. Rename the type via the
    Services page (uses 022 action) → reload the panel → exemption
    label updates without the operator re-picking (proves uuid model).
  - US5 (Edit panel sections + danger zone): visual structure
    assertion, danger zone renders correct variant (Deactivate vs
    Reactivate).
  - US6 (Mobile bottom sheet): viewport=375, row click opens sheet,
    FAB opens add wizard, swipe/escape closes.
  - US7 (Self-edit of own pay): operator toggles own card_fee_exempt
    without role/active becoming editable.
  - US8 (Archived type still exempted): archive a supply_type that's
    in someone's supply_except → panel shows row with "Archived"
    pill, exemption survives, save without changes is a no-op.
```
