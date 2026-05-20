# Phase 0 Research: Transactions Page

**Feature**: 045-transactions-page · **Date**: 2026-05-19

All decisions below are resolved — there are no open `NEEDS CLARIFICATION`
items. The three scope questions (status handling, access, CSV export) were
settled with the maintainer during `/speckit-specify`.

---

## R1 — Arbitrary-window transaction query

**Decision**: Add a new server-only module `lib/transactions/queries.ts` with
`queryTransactions(supabase, tz, window)` and `queryPeriodCount(supabase,
window)`. Do **not** extend `lib/dashboard/queries.ts`.

**Rationale**: `lib/dashboard/queries.ts` exposes `querySummaryRows` and
`queryTodayFeed`, but every one of its windows is produced by
`todayWindow / weekWindow / monthWindow`, all of which return `[localMidnight,
now]` — a window that always *ends at the current instant*. The Transactions
page needs **full, possibly-historical** periods (e.g. all of last month, or a
week three weeks ago), i.e. an explicit `[start, end)` that does not end at
`now`. It also needs a richer projection (per-line tech, category, qty, unit
price, each payment, the closing staff member) than the dashboard's flat
`TransactionRow`. A separate module keeps the dashboard read model stable and
gives this feature a clean, independently-testable query surface.

**Alternatives considered**: (a) Generalising the dashboard query functions to
take an explicit window — rejected: it widens a stable, well-tested module for
one consumer and the projections genuinely differ. (b) A Postgres RPC —
rejected: unnecessary; the same two-query `tickets` + `.in()` children pattern
the dashboard already uses is sufficient at single-salon volume (Principle V).

---

## R2 — Period and stepping math

**Decision**: Extend `lib/time/period-windows.ts` with three offset-aware,
full-period window functions — `dayWindowAt(tz, now, offset)`,
`weekWindowAt(tz, now, offset)`, `monthWindowAt(tz, now, offset)` — each
returning `[Date, Date)` for the period `offset` steps back from the current
one (`offset = 0` current, `-1` previous, …). A thin `lib/transactions/window.ts`
dispatches on the granularity, clamps forward stepping at `offset = 0`, and
builds the human labels ("This week", "Last week", "Week of May 5", and the
range string).

**Rationale**: The constitution (§ Security & Data Integrity Constraints)
mandates that **all** timezone math lives behind the single `lib/time/*`
helper. Computing "local midnight of the day/week/month N periods ago in the
salon timezone" is timezone math, so it belongs in `period-windows.ts`, which
already owns the DST-correct primitives (`localStartOfDayUtc`,
`localStartOfWeekUtc`, `localStartOfMonthUtc`). The existing public
`*Window` functions stay untouched. Label construction is feature presentation,
not tz math, so it sits in `lib/transactions/window.ts`.

**Week definition**: Monday-start, matching the existing `localStartOfWeekUtc`
and the dashboard's `weekWindow`. **Month**: calendar month. A full period's
`end` is the start of the next period (future days simply have no rows).

**Alternatives considered**: Doing the offset arithmetic inside
`lib/transactions/window.ts` with its own `Intl` calls — rejected: it would be
a second timezone surface, which the constitution forbids.

---

## R3 — Client / server split

**Decision**: The active period is encoded in URL search params —
`/transactions?period=today|week|month&offset=<0|-1|-2|…>`. `page.tsx` is a
`force-dynamic` Server Component that reads `searchParams`, resolves the window,
and queries that period's transactions. The period toggle and the ‹ › arrows
are server-rendered `<Link>`s that change the search params, triggering a fresh
RSC fetch. **Search, payment-method filtering, and tech filtering** operate
entirely client-side, in memory, over the already-loaded period payload; they
do **not** touch the URL or the network. The receipt drawer is client-side.

**Rationale**: The dashboard pre-loads all three period summaries into a client
Context because each summary is one small object. The Transactions page cannot
pre-load every `period × offset` combination, so period changes must re-query
the server — and `<Link>`-driven search params are the idiomatic App Router way
to do that. It also makes the period view bookmarkable and back-button-correct,
and matches the repo's `force-dynamic` "re-query on every navigation" freshness
model (`dashboard/page.tsx`, `end-of-day/page.tsx`). Search/method/tech, by
contrast, must feel instant and recompute the KPI strip live (prototype
behaviour), so they stay client-side over the loaded set. Shipping the full
per-period detail (line items + payments) up front is cheap at single-salon
volume and is required anyway, because search matches service names.

**Alternatives considered**: (a) All filtering via search params + server
round-trips — rejected: a network hop per keystroke is the wrong UX and
needless load. (b) All data (every transaction ever) shipped to the client and
*all* filtering client-side, like the prototype — rejected: the payload grows
unbounded as the salon's history accumulates.

---

## R4 — Transaction ID display format

**Decision**: Display `#` + the **last 6 hex characters** of the ticket UUID,
uppercased and monospaced — e.g. `#A3F029`. Implemented as a pure
`formatTxId(uuid)` in `lib/transactions/format.ts`. Search matches against this
displayed form (case-insensitive). The raw UUID stays in `data-tx-id` for tests
and is never shown to users.

**Rationale**: The spec calls for a human-readable transaction identifier; the
prototype's `tx-0114` codes are mock-data artifacts with no real-world
analogue. Tickets are keyed by UUID and there is no sequence column. The last 6
hex chars are short, stable, effectively unique within any one period a user
browses, and need no schema change (Principle V).

**Alternatives considered**: (a) Adding a `ticket_number` sequence column —
rejected: a migration for a cosmetic display ID violates scope discipline. (b)
Showing the full UUID — rejected: unreadable, defeats the "human-readable" goal.

---

## R5 — Client name

**Decision**: Every transaction displays **"Walk-in"** as its client.

**Rationale**: There is no `public.clients` table in the v1 schema — migration
`0004` explicitly defers it ("`client_id` is intentionally NOT yet wrapped in a
FK because `public.clients` does not exist yet"). Cash-sale checkout creates
tickets with no `appointment_id`, so there is no path from a paid ticket to a
named client. The dashboard already faces this and dropped its client column
outright (`TransactionRow` — "no `client` field"). The Transactions page keeps
the column for layout parity with the prototype and forward-compatibility, but
it reads "Walk-in" for all rows in v1. Search-by-client still functions (it
matches "Walk-in"). This is a documented, scope-honest gap — when a clients
feature lands, only the projection in `queryTransactions` changes.

**Alternatives considered**: Hiding the client column entirely — rejected: it
diverges further from the approved prototype and would need re-adding later;
showing a constant honest value is cleaner.

---

## R6 — Line-item category

**Decision**: `queryTransactions` resolves each service line's category by
joining `ticket_items.ref_id` → `services.category`. For non-service lines
(`kind` of `discount` / `product`) or a service row that has since been
deleted, `category` projects to `null` and the drawer simply omits it.

**Rationale**: `services.category` exists (`text not null default 'Other'`,
migration `0003`), and `ticket_items.ref_id` is a FK to `services.id`. One
extra `services` query keyed by the distinct `ref_id`s of the window's items is
cheap and gives the receipt drawer the category the spec's FR-014 asks for.
`name_snapshot` is always shown regardless, so a deleted service still renders a
correct line.

**Alternatives considered**: Snapshotting category onto `ticket_items` at
checkout — rejected: a schema change outside this feature's scope. Omitting
category entirely — rejected: FR-014 lists it and the data is one join away.

---

## R7 — Role-gated sidebar item

**Decision**: Add an optional `roles?: readonly StudioRole[]` field to the
`NavItem` type in `components/lacquer/sidebar/nav-items.ts`. The new
"transactions" item sets `roles: ["owner", "manager"]`. `StudioSidebar`
(Server Component) already receives `staff.role`; thread it as a `role: string`
prop into `SidebarShell` (the client island), which filters out any item whose
`roles` is present and does not include the viewer's role. An item with no
`roles` field is visible to everyone (unchanged behaviour for all existing
items).

**Rationale**: `NAV_CONFIG` must remain a direct module import in the client
island because Lucide icon components are functions and cannot cross the
RSC→client boundary as props — so the *config* cannot be filtered on the
server. The viewer's `role`, however, is a plain string and serialises across
the boundary trivially. Filtering in the client island with a `role` prop is
the minimal, well-contained change. The page route's own redirect remains the
real security boundary (Principle II); the nav filter is purely UX.

In a degraded session the layout passes a placeholder `role: "technician"`, so
the Transactions item is hidden when the session can't be resolved — a safe
default.

**Touch-ups**: `validateNavConfig` needs no new invariant (`roles` is
optional). `tests/e2e/sidebar.spec.ts` runs as the owner, so its
`EXPECTED_NAV_IDS` list gains `"transactions"`.

**Alternatives considered**: (a) A server-side filtered nav config passed as
props — rejected: impossible to serialise the icon functions. (b) Rendering the
item for everyone and relying solely on the route redirect — rejected: the spec
(FR-004) explicitly requires the nav item to be hidden for non-privileged
roles.

---

## R8 — End-to-end test isolation

**Decision**: `tests/e2e/transactions.spec.ts` lives in the parallel `main`
Playwright project. It **self-seeds** a small set of historical paid tickets
in `beforeAll` (via the Supabase admin client, at salon-local instants, reusing
the `tests/e2e/_la-time.ts` helpers the dashboard spec established) and removes
them in `afterAll`. Assertions target those known seeded ticket IDs
(`data-tx-id`) and their rendered detail, plus role-gating and filter
behaviour — the spec never asserts an exact global aggregate count.

**Rationale**: CLAUDE.md requires any spec that "asserts a global count or
summary over a shared table" to run in a serial baseline project. The
Transactions page aggregates over `tickets`, which the parallel checkout specs
also write to, so an exact-count assertion would race. Writing the spec to
assert *presence and correctness of specific seeded rows* — not totals — keeps
it correct under parallelism and out of the slow baseline phase. Self-seeding
(rather than editing `supabase/seed.sql`) keeps the blast radius at zero: no
other spec's baseline assertions can shift.

**`_affected-map.mjs` additions**: map `app/(studio)/transactions/**`,
`components/lacquer/transactions/**`, `lib/transactions/**`,
`components/lacquer/sidebar/**`, and `components/lacquer/recent-transactions-feed.tsx`
→ `tests/e2e/transactions.spec.ts` so scoped phase gates pick it up.

**Alternatives considered**: Adding the spec to a baseline project — rejected:
unnecessary serial-phase cost once assertions avoid global counts. Seeding
history in `supabase/seed.sql` — rejected: changes week/month aggregates other
specs could depend on, and bloats the shared baseline.

---

## R9 — Method colors and KPI delta colors

**Decision**: Render the payment-method chip with the existing
`components/lacquer/method-pill.tsx` (`<MethodPill method={…} />`), which is
already tokenised and supports `card | cash | gift | split`. The KPI count
delta uses the `--success` token (already defined: `var(--green-500)`) when
positive and `--destructive` when negative.

**Rationale**: The handoff's `transactions-page.css` styles its `.tp-meth`
chips and `.delta.up` with raw `oklch(...)` literals, which Constitution
Principle I forbids ("Raw hex codes, off-scale spacing … are prohibited" — by
extension raw color literals). Both needs are already met by existing tokens
and a shared component, so `styles/transactions.css` carries **no** raw color
values — every `.tp-*` rule references a `var(--…)` token.

**Alternatives considered**: Porting the prototype's `.tp-meth` classes
verbatim — rejected: introduces raw `oklch` and duplicates `<MethodPill>`.

---

## R10 — No database migration

**Decision**: Ship **zero** schema changes — no migration file.

**Rationale**: With refund/void and CSV export both out of scope, the feature
is a pure read over `tickets` / `ticket_items` / `payments` / `staff` /
`services`, all of which exist with `select to authenticated using (true)` RLS.
At single-salon volume (a month is low-hundreds of tickets) the dashboard's
existing un-indexed `closed_at` range filter is already adequate, so no new
index is warranted either (Principle V — "prefer the simplest mechanism").
Avoiding a migration also removes the preview/prod `db-migrate` workflow round
trip entirely.

**Future note**: if the salon's history ever grows enough to make the month
query slow, the right follow-up is a single `tickets (status, closed_at desc)`
index — but that is explicitly *not* needed for v1 and is left unbuilt.
