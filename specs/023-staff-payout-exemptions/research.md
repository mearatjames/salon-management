# Phase 0 — Research: Per-staff payout exemptions + Settings → Staff redesign

**Feature**: `023-staff-payout-exemptions` · **Date**: 2026-05-17

This phase resolves every NEEDS-CLARIFICATION-shaped technical unknown the plan touches. Each section follows a Decision / Rationale / Alternatives considered shape so the plan is reproducible and the choices are auditable.

---

## R1 — FK-like integrity on `uuid[]` array columns in Postgres

**Decision**: Enforce element-existence via **two row-level triggers** on `staff` and `supply_types` — Postgres does not support foreign-key constraints on array elements (this is a long-standing FOREIGN KEY/REFERENCES limitation; see [postgres-bug 14478](https://www.postgresql.org/message-id/flat/CAGPqQf3Cg7-1cFePLuQNd7B0PCXa6t6sQ4Pt%2BJzm1c2tF6V4dQ%40mail.gmail.com) for canonical discussion).

**Trigger 1 — `staff_assert_supply_except_valid_trg`** (BEFORE INSERT OR UPDATE on `staff` FOR EACH ROW):

```sql
create or replace function public.staff_assert_supply_except_valid()
returns trigger language plpgsql as $$
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

create trigger staff_assert_supply_except_valid_trg
  before insert or update on public.staff
  for each row execute function public.staff_assert_supply_except_valid();
```

**Trigger 2 — `supply_types_prune_from_staff_trg`** (AFTER DELETE on `supply_types` FOR EACH ROW):

```sql
create or replace function public.supply_types_prune_from_staff()
returns trigger language plpgsql as $$
begin
  update public.staff
  set supply_except = array_remove(supply_except, old.id)
  where old.id = any(supply_except);
  return old;
end;
$$;

create trigger supply_types_prune_from_staff_trg
  after delete on public.supply_types
  for each row execute function public.supply_types_prune_from_staff();
```

**Rationale**:
- Trigger 1 is the safety boundary for inserts/updates — the app's `validateSupplyExcept(raw, allowedIds)` already drops unknown ids silently (defensive against stale tabs), but the trigger is the trust boundary that catches anything the app validator misses (rogue Server Action caller, raw SQL, etc.).
- Trigger 2 is belt-and-suspenders — 022 ships archive-not-delete, so this trigger only ever fires in disaster recovery (someone manually `DELETE`s a `supply_types` row to clean up bad data). If/when fired, the deletion cascades through every `staff.supply_except` array element and removes dead ids in a single transaction. This satisfies spec FR-003.
- Both triggers are pure PL/pgSQL — no extensions, no external dependencies. Runtime cost is negligible at our scale (≤30 catalog rows × ≤40 staff rows × cap-of-64-element arrays).

**Alternatives considered**:
- **Junction table** (`staff_supply_exceptions(staff_id, supply_type_id)` with composite PK and proper FK). Standard relational pattern; supports referential integrity natively. Rejected because the lookup pattern is "for one staff, get all their exempted ids" — exactly what `staff.supply_except uuid[]` answers in a single column read, with no JOIN. The spec FR-007 query (`loadSupplyCatalogForStaff`) and the panel render both want the array shape; a junction table would require either an aggregate JSON build or a second query. The brief explicitly chose the array column shape.
- **Skip referential integrity** — rely on the app validator alone. Rejected because the spec FR-003 explicitly requires the DB-level invariant ("enforced as a referential-integrity invariant in the database"), Constitution III invariants apply even when the app code is bypassed, and the trigger cost is negligible.
- **JSONB column with shape validation** — `supply_except jsonb default '[]'` with a CHECK that every element is a uuid. Rejected because (a) array_remove and any() don't work on JSONB without casting, (b) Postgres' uuid[] type is more compact and indexable than jsonb, (c) the GIN-vs-no-index decision is moot at our scale.

---

## R2 — Per-type usage hint server-side aggregate (`loadSupplyCatalogForStaff`)

**Decision**: A single SQL query that joins `supply_types` LEFT JOIN `services`, aggregates per-type with `count(*) filter (where s.active = true)` for the service count and `mode() within group (order by s.supply_amount_cents)` for the most-common amount.

```sql
select
  t.id,
  t.name,
  t.archived,
  count(s.id) filter (where s.active) as service_count,
  mode() within group (order by s.supply_amount_cents) filter (where s.active)
    as sample_amount_cents
from public.supply_types t
left join public.services s on s.supply_type_id = t.id
where t.archived = false
   or t.id = any ((select supply_except from public.staff where id = $1))
group by t.id, t.name, t.archived
order by t.name;
```

**Rationale**:
- `mode() within group (order by ...)` is the ordered-set aggregate Postgres provides for "most-common value". When multiple values tie, `mode()` returns the smallest — which exactly matches FR-007's tiebreaker rule ("ties broken by the smallest").
- `count(*) filter (where s.active)` excludes archived services from the count without a separate WHERE clause (avoids dropping rows that have zero active services — we want to show "Unused — no services reference this type yet." for those, not omit them).
- The `WHERE t.archived = false OR t.id = any(...)` clause is the "archived-still-exempted" rule from Clarify Q3 — archived types stay in the result set if and only if the tech currently exempts them.
- Single query (one round-trip) keeps the panel-render budget within the 100ms target. The query is parameterized by the selected staff id so it can be cached/prepared per render.
- The query is **passed the staff id**, not the staff's `supply_except` array — keeps the SQL self-contained and lets the helper be called independently of the panel-render state.

**Alternatives considered**:
- **Two queries** (one for the catalog, one for the per-type usage stats). Rejected because two round-trips against Supabase from the panel render path doubles the latency budget for no upside; the single-query form is no more complex to maintain.
- **Compute the usage in JS** by joining `services` and `supply_types` in the app layer. Rejected because the panel render is a Server Component — pushing the aggregate to SQL keeps the JS layer thin and avoids transferring the full services list across the SQL wire.
- **`percentile_disc(0.5) within group (order by supply_amount_cents)`** as a median instead of `mode()`. Rejected because the spec says "most-common" — mode is the right aggregate; median is wrong (a $5 amount used on 4 services + a $10 amount used on 1 service should report $5, not $7.50).

---

## R3 — Audit-diff helper pattern (mirror 021's `_audit-diff.ts`)

**Decision**: A new `app/(studio)/settings/staff/_audit-diff.ts` that mirrors the structure of `app/(studio)/services/_audit-diff.ts` (extended in 022): exports a `STAFF_DIFF_KEYS` readonly array of the seven snapshotable fields, a `StaffSnapshot` type aliasing the row shape, and a `buildChanges(before, after): StaffChanges` function returning `{ before: Partial<StaffSnapshot>; after: Partial<StaffSnapshot>; changes: (keyof StaffSnapshot)[] }`. The `changes` array contains only the keys whose values differ between `before` and `after`; `before` and `after` are scoped projections containing only those keys.

`STAFF_DIFF_KEYS` (in array order, which determines diff field order in the audit row):

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
```

Array-valued comparison (for `supply_except`): two arrays are equal iff they have the same elements regardless of order (uses `Set` comparison after sort — `[...a].sort().toString() === [...b].sort().toString()` is the canonical pattern, robust to uuid normalization since uuids are stable strings).

`buildChanges` returns:

```ts
type StaffChanges = {
  before: Partial<StaffSnapshot>;
  after: Partial<StaffSnapshot>;
  changes: readonly (keyof StaffSnapshot)[];
};
```

When no key differs, returns `{ before: {}, after: {}, changes: [] }`. The audit-row payload is constructed by `updateStaff` as `{ ...buildChanges(before, after) }` and persisted under `audit_log.payload` (already a JSONB column from 002).

**Rationale**:
- The 021 services audit-diff helper is the established pattern in the codebase — its diff-key-ordered comparison + scoped before/after projection survives renames, JSON-key removals, and audit-viewer rendering quirks. Mirroring it byte-for-byte keeps the audit-viewer's existing rendering pipeline working for staff with zero new code paths.
- The array-equality comparison handles the corner case where the app submits `["a","b"]` but the DB returned `["b","a"]` — same content, no diff, no audit row spam. The validator already dedupes via `Set` so element order is the only variance.
- `supply_except` is stored as raw uuids in the diff payload (no name snapshot) per spec FR-014 — the audit viewer resolves names live from the catalog at render time. This is the same posture the services diff takes for `supply_type_id` (uuid stored, name resolved live).

**Alternatives considered**:
- **Full-row snapshot**: store the entire `staff` row in `before`/`after`. Rejected because it bloats the audit-log payload with unchanging fields (created_at, removed_at, pin_hash, user_id) and makes diff-rendering more expensive. The scoped projection is the established 021 pattern.
- **Per-field separate audit rows**: one `staff.updated` row per changed field. Rejected because (a) it inflates the audit log row count, (b) the existing audit-viewer expects one row per save with a `changes` array, (c) tracking "which save these came from" requires correlation ids we don't have.
- **`changes` as a `Record<key, { before, after }>` object** instead of separate `before`/`after` projections + `changes` array. Rejected because the established 021 shape is `{ before, after, changes }` and the audit viewer reads that shape; changing it now would require an audit-viewer change for no win.

---

## R4 — Filter-chip preference: `localStorage` SSR-safe hydration

**Decision**: Store the active chip under `tn:settings:staff:filter` in **`localStorage`** (not `sessionStorage`). The roster is **always rendered with the SSR default (Active)** so initial paint is deterministic; a `useEffect` in the chip-bar client island reads `localStorage` after mount and updates the UI state if the persisted value differs. URL search params (`?filter=`) are NOT used to drive the chip state (filter is a UI preference, not a shareable view state — see § Alternatives).

```tsx
// roster-filter-chips.client.tsx (sketch)
"use client";

const STORAGE_KEY = "tn:settings:staff:filter";

type Filter = "all" | "active" | "inactive";

export function RosterFilterChips({ counts }: Props) {
  const [filter, setFilter] = useState<Filter>("active"); // SSR default
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "all" || stored === "inactive") setFilter(stored);
  }, []);
  const handleSelect = (next: Filter) => {
    setFilter(next);
    localStorage.setItem(STORAGE_KEY, next);
  };
  // ...
}
```

**Rationale**:
- `localStorage` survives tab close and browser restart — operators don't have to re-select their preferred filter daily. This matches spec FR-018 ("persist across page loads").
- The "SSR default then hydrate" pattern is the React 19 / Next 16 idiomatic way to handle `localStorage`-backed UI state — `localStorage` is unavailable on the server, so the SSR render must use a deterministic default. The post-mount `useEffect` is the universal escape hatch.
- The legacy `tn:settings:staff:show-inactive` key is ignored on read (FR-019). No migration code — first-time-after-upgrade visitors with the legacy key see the new default (Active), which is the most-common selection anyway.
- The roster server query returns ALL staff (active + inactive); the chip filter is applied client-side. This is correct at our scale (≤40 total staff rows) and avoids round-tripping for filter changes. The per-status counts come from the server-side roster snapshot.

**Alternatives considered**:
- **`sessionStorage`**: rejected because the spec's Q3-style draft answer prefers persistent ("sessionStorage would lose the preference on tab close, which is more friction than help"). Confirmed in Assumptions.
- **Cookie**: rejected because cookies cross the network on every request (~30 bytes overhead per page load for a UI-only preference is wasteful), and the cookie would need to be readable client-side (defeating httpOnly hardening).
- **URL search params (`?filter=active`)**: rejected because the chip is a per-operator preference, not a shareable filter — putting it in the URL means every operator sees the URL-author's filter on link share, which is the wrong default.
- **Server-side per-user preference**: rejected per spec Key Entities — "Not persisted server-side and not shared across devices". Per-device is the right granularity; an operator on a tablet may want a different default than on the back-office desktop.

---

## R5 — Mobile breakpoint detection: pure CSS `@media`, no JS hook

**Decision**: Use **pure CSS `@media (max-width: 899px)`** to switch between the two-pane desktop layout and the mobile full-width + bottom-sheet layout. No `useMediaQuery` hook, no JS-driven breakpoint detection. The bottom sheet, FAB, and chevron-on-row all render in the markup unconditionally — CSS hides them on desktop (`display: none`) and shows them on mobile.

```css
/* styles/settings.css */
.staff-mobile-sheet,
.staff-fab,
.staff-row-chevron {
  display: none;
}

@media (max-width: 899px) {
  .settings-staff-grid {
    grid-template-columns: 1fr;
  }
  .settings-staff-panel {
    display: none; /* the inline aside is hidden; the sheet renders instead */
  }
  .staff-mobile-sheet,
  .staff-fab,
  .staff-row-chevron {
    display: revert;
  }
  .staff-row-added-date {
    display: none;
  }
}
```

**Rationale**:
- Avoids hydration mismatch — JS-driven viewport detection is the #1 source of React 19 hydration warnings for media-queried UI. Pure CSS is the universally-correct path.
- The mobile bottom sheet markup is rendered server-side but `display: none`-hidden on desktop; clicking a row dispatches a CSS-driven `data-attribute` toggle (already used by the existing shadcn `Sheet`). The sheet itself only mounts its body content when open (per shadcn `Sheet` impl), so the cost of always-rendering is bounded to the sheet shell (~empty `<div>`).
- 900px breakpoint matches the prototype's `[data-vp]` rule (see `design-system/staff-components.jsx` lines 60–80 for the prototype's mobile breakpoint).
- `display: revert` returns the element to its default `display` — for `<div>` that's `block`, for `<button>` that's `inline-block`. Avoids the bug where setting `display: block` flattens an inline `<button>`.

**Alternatives considered**:
- **`useMediaQuery` hook**: rejected for hydration-mismatch risk. Would need either `suppressHydrationWarning` (a code smell) or a two-pass render (slower first paint).
- **`<MediaQuery>` wrapper component**: rejected — same hydration concern, plus extra component tree depth.
- **Container queries (`@container`)**: rejected because the panel grid is a top-level layout, not a self-sized container, and container queries don't add value over `@media` at this scale.

---

## R6 — Body scroll lock for mobile bottom sheet

**Decision**: Reuse the **existing shadcn `Sheet` primitive's built-in body scroll lock** — `components/ui/sheet.tsx` already imports Radix's `Dialog` primitive which handles scroll locking via `body { overflow: hidden }` while the dialog is open. The Wizard sheet (021/022) already uses this. The mobile bottom sheet wraps `<Sheet side="bottom">`.

**Rationale**:
- No new dependency. Radix already manages the scroll lock, scrim, focus trap, and Escape-to-close — all of which the spec requires.
- The wizard sheet from 021 (which 023 redesigns but does not replace its underlying mechanism) uses the same primitive — consistency reduces test surface.

**Alternatives considered**:
- **Manual `document.body.style.overflow = 'hidden'`**: rejected because it doesn't restore correctly on unmount in the presence of other concurrent modals (e.g., the change-PIN modal layered above the bottom sheet) and Radix already handles all the edge cases.
- **`use-body-scroll-lock`** library or similar: rejected for "no new runtime dependency" constraint.

---

## R7 — `prefers-reduced-motion`: CSS `@media` honor for all sheets

**Decision**: Add a single `@media (prefers-reduced-motion: reduce)` block in `styles/settings.css` that sets `transition-duration: 0ms !important; animation-duration: 0ms !important;` for the mobile bottom sheet and wizard sheet entry/exit animations. No JS detection; no React effect. The shadcn `Sheet` primitive uses CSS transitions, so a CSS override suffices.

```css
@media (prefers-reduced-motion: reduce) {
  .staff-mobile-sheet[data-state="open"],
  .staff-mobile-sheet[data-state="closed"],
  .add-staff-wizard-sheet[data-state="open"],
  .add-staff-wizard-sheet[data-state="closed"] {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }
}
```

**Rationale**:
- WCAG 2.3.3 (Animation from Interactions) requires that user-triggered motion ≥300ms be disablable; the OS-level `prefers-reduced-motion: reduce` signal is the universally-supported switch.
- Clarify Q2 confirmed this is the desired posture — instant transition (no slide).
- Tab-bar and chip-bar interactions stay instant in both modes (no animation in either case; nothing to scope under the media query).
- `!important` is necessary because shadcn's `Sheet` uses inline transition properties; the CSS override has to win.

**Alternatives considered**:
- **React effect that reads `window.matchMedia('(prefers-reduced-motion: reduce)')`** and toggles a class: rejected — duplicates what the CSS media query already does, with extra runtime cost and hydration risk.
- **Reduced-but-not-instant fade** (replace 300ms slide with 100ms opacity fade): rejected per Clarify Q2.

---

## R8 — Add-staff wizard sheet: redesign existing component, not replace

**Decision**: **Modify `components/lacquer/staff/add-staff-wizard.client.tsx` in place** to use the wizard-pills layout (three step pills, live preview card on the right, sticky footer). Keep the existing `addStaff` and `setStaffPin` Server Actions unchanged — they already handle the two-step state machine correctly. The redesign is visual chrome only.

**Rationale**:
- The existing wizard already has the correct state machine and action calls — what changes is the markup, CSS, and the per-step transition (pill highlighting + sticky-footer button label change). Rewriting would re-introduce the existing bugfix history (the existing file has 637 lines and reflects ~3 iteration cycles since 006).
- The two-step server-action pattern (create then set PIN) is the trust boundary; preserving it ensures no audit-log regression.
- Visual chrome only matches the spec US7's "purely a visual chrome upgrade" phrasing.

**Alternatives considered**:
- **Replace the file** with a new wizard component: rejected — would re-introduce the established bugs the existing file already fixed (Esc-cancel mid-step preserving the partial create state per spec US7 #6 was specifically tested by an e2e from 006). Modifying in place keeps test coverage continuous.

---

## R9 — Settings tab bar + redirect: already shipped

**Decision**: **No edits to `app/(studio)/settings/layout.tsx` or `app/(studio)/settings/page.tsx`**. Both are already shipped — verified by inspection:

- `app/(studio)/settings/layout.tsx` (lines 1–32 shown in plan) mounts `<TabBar />` from `@/components/lacquer/settings/tab-bar` for every Settings sub-page.
- `app/(studio)/settings/page.tsx` (3 lines shown in plan) calls `redirect("/settings/staff")` as a default.

**Rationale**:
- Spec FR-025 ("Settings layout MUST mount a tab bar … shared across all four sub-pages") and FR-026 ("visit to `/settings` without a sub-route MUST redirect to `/settings/staff`") are both already satisfied by the existing code.
- The tab bar's active-route highlighting is presumed working from the existing implementation (component file exists; no e2e regression has been reported against it). Verification step in quickstart.md will spot-check it.
- This is a net **scope reduction** vs. the spec's apparent ask — saves implementation time and avoids touching files that don't need touching.

**Alternatives considered**:
- **Re-implement the tab bar to match a newer prototype**: rejected — no spec language requires a new tab bar design; the existing one is in production and works. Constitution V (Scope Discipline) forbids speculative redesign.

---

## R10 — Live status badges in panel header (draft-state derivation)

**Decision**: The panel-profile header's status badges (`Active/Inactive`, `Card-fee exempt`, `Supply-exempt`, `Partial supply exemption`) are derived **client-side from the current draft state** (not the persisted target snapshot). The `<EditPanel>` already manages a `Draft` reducer state; the new `<StatusBadges>` component is a pure rendering function of the draft. This means the operator sees the badge change the instant they toggle a control, before saving. After save, the page re-renders with the new persisted snapshot and the badges remain in the same position with the same visible state (no flicker, no "save then briefly revert").

**Rationale**:
- Spec FR-016 explicitly says "The badges MUST update live as the operator toggles the controls in the Pay & deductions section (before save) so the operator can preview the posture." Deriving from draft state is the only way to satisfy this.
- The draft state already exists in the panel (managed by `useState` per the existing 006/008 pattern); the badges are an additional consumer, not a new state owner.
- No additional save-time logic is required — the page re-render after `revalidatePath` brings the new snapshot in via props, which re-initializes the draft state, which re-renders the badges with the now-persisted values.

**Alternatives considered**:
- **Re-fetch on every toggle**: rejected — unnecessary network round-trip for a pure UI derivation.
- **Only update badges on save**: rejected — fails FR-016 explicit "update live" requirement; the live preview is the spec's primary intent (so operators don't have to guess what "save" will produce).

---

## R11 — Self-edit gate semantics (`'update_pay_deductions'` action)

**Decision**: Add a new `StaffAction` literal `"update_pay_deductions"` to the union in `permissions.ts`. This action is **NOT** in `SELF_BLOCKED_ACTIONS` (per Clarify Q1 self-edit is allowed). It IS gated by the existing `canEditAnyField` matrix (i.e., manager-on-owner remains blocked from editing any field, including the new ones — same as today's `update_color`).

`updateStaff` invokes `assertMutationAllowed(ctx, 'update_pay_deductions')` only if **any** of the three new fields differs from the target's persisted value. If all three are unchanged from the saved baseline, no permission check fires for this action label (the existing per-field checks for `display_name`, `role`, etc. still fire as today). This avoids spurious permission errors when an operator saves a panel whose Pay & deductions section is untouched.

**Rationale**:
- Spec FR-013 explicitly allows self-edit of the three new fields. Clarify Q1 confirmed.
- The existing `SELF_BLOCKED_ACTIONS` set (per `permissions.ts`) blocks `update_role`, `update_active`, `deactivate`, `remove` — all destructive or authority-shifting. The three new fields are payout-economics, not authority — they belong with `update_color`/`update_name` (also self-editable today).
- Gating on `canEditAnyField` (manager-on-owner blocked) matches the existing pattern for every other field — there's no spec language that distinguishes Pay & deductions from any other field on the manager-on-owner axis.

**Alternatives considered**:
- **Three separate actions** (`update_card_fee_exempt`, `update_supply_mode`, `update_supply_except`): rejected as over-granular — the permission matrix evaluates the same for all three (allowed for self, blocked for manager-on-owner). One label simplifies the audit-log payload (still `staff.updated`, same as today).
- **No new action label; reuse `update_color`**: rejected — semantically wrong and breaks the principle that each Action label names one logical operation.

---

## R12 — Migration order safety for `supply_types_prune_from_staff_trg`

**Decision**: The trigger `supply_types_prune_from_staff_trg` (AFTER DELETE on `supply_types`) is created **inside the 0018 migration**, AFTER `staff.supply_except` exists. If 0017 (022's migration) is rolled back without 0018 first being rolled back, the trigger function will reference a non-existent column — but Postgres throws lazily on trigger fire, not on rollback, so this is safe (the rollback succeeds; the trigger just never fires because the only `supply_types` deletes happen via the app code which doesn't run on a rolled-back schema).

Migration files are sequentially applied per the existing `db-migrate-{preview,prod}.yml` workflows — 0017 always lands before 0018; 0018 always lands before 0019. The Constitution v1.0.3 "Schema drift forbidden" rule guarantees this ordering.

**Rationale**:
- Triggers depend on the schema state at fire-time, not at creation-time, in Postgres. The trigger function's body references `OLD.id` (always present on a DELETE) and `staff.supply_except` (created by 0018) — both will exist if 0018 has been applied.
- The migration ordering guarantee from the existing GitHub Actions removes the failure mode where 0018 runs before 0017.

**Alternatives considered**:
- **Defensive CHECK in 0018 that the `staff.supply_except` column exists** before creating the trigger: rejected — Postgres' `create or replace function` against a missing column is itself an error, so the migration would fail noisily. No silent failure path.
- **Create the trigger in a future migration `0019_...`** after both 0017 and 0018 are stable: rejected — couples 023's correctness to a future migration; the trigger is conceptually part of 023's contract.

---

## Resolution summary

| Plan section / open point | Resolved in | Outcome |
|---|---|---|
| FK on uuid[] enforcement | R1 | Two triggers (BEFORE INSERT/UPDATE on staff + AFTER DELETE on supply_types) |
| Per-type usage hint SQL | R2 | Single query with `mode() within group` + `count(*) filter` |
| Audit-diff helper pattern | R3 | Mirror 021's services/_audit-diff.ts byte-for-byte in structure |
| Filter-chip persistence | R4 | localStorage + SSR-default-then-hydrate; legacy key ignored |
| Mobile breakpoint detection | R5 | Pure CSS @media (max-width: 899px); no JS hook |
| Body scroll lock for sheets | R6 | Radix Dialog primitive's built-in lock (via shadcn Sheet) |
| prefers-reduced-motion | R7 | Single CSS @media block scoping sheet transition-duration to 0ms |
| Add-staff wizard upgrade path | R8 | Modify existing component in place; existing actions unchanged |
| Tab bar + redirect already shipped | R9 | No edits to settings/layout.tsx or settings/page.tsx |
| Live header badges | R10 | Derive from draft state in `<StatusBadges>` (pure render) |
| Self-edit gate for new fields | R11 | One new action label `update_pay_deductions`; NOT in SELF_BLOCKED_ACTIONS |
| Trigger creation safety | R12 | Trigger lives in 0018; migration ordering guarantees correctness |

All NEEDS-CLARIFICATION-shaped unknowns are resolved. No outstanding research items.
