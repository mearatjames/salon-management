# Research: Dashboard — Real Supabase Data Wiring

**Feature**: 015-dashboard-data-wiring
**Date**: 2026-05-16
**Source**: derived from `spec.md` + clarifications session, the constitution v1.0.3, the existing `lib/dashboard/`, `lib/db/`, `app/(studio)/dashboard/`, `styles/dashboard.css`, and the schema in `supabase/migrations/0001`, `0003`, `0004`, `0006`, `0007`.

## Context

The spec's clarifications round resolved every NEEDS CLARIFICATION. This phase therefore captures *design decisions* the plan locks in, with the alternatives considered, so a future reviewer (or the design auditor, or `/speckit-tasks`) can trace why each lever sits where it does. Each entry follows the Decision / Rationale / Alternatives format.

---

## 1. Timezone helper library choice

**Decision**: Use `Intl.DateTimeFormat` (built-in) only. No external library.

**Rationale**:
- A Tang Nails-style single-salon app has one consumer of the timezone helper (`lib/time/period-windows.ts`) and a small API surface: `salonNow`, `todayWindow`, `weekWindow`, `monthWindow`, `formatSubtitle`, `formatTime`.
- Node 22 has full IANA timezone support via `Intl.DateTimeFormat` and handles DST transitions natively. The standard "two-step technique" — render the boundary instant's local parts, then ask `Intl` for the offset at that instant — handles spring-forward and fall-back correctly without ambiguity.
- The constitution's § Security & Data Integrity Constraints mandates a single `lib/time/*` helper as the only timezone surface; that mandate is satisfied by a small pure module, not a dependency.
- Principle V (Scope Discipline & Cost Restraint) explicitly disfavors adding dependencies when the standard library suffices.

**Alternatives considered**:
- **`date-fns-tz`** — familiar API, well-maintained, but ~50 KB of transitive dependencies for arithmetic that `Intl` covers. Adds a place to bump for security advisories that the dashboard derives no functional benefit from.
- **`@js-temporal/polyfill`** — forward-looking (matches the eventual standard), but the Temporal proposal is not yet ratified in V8/Node defaults; the polyfill is ~100 KB and would have to be tree-shaken carefully.
- **`dayjs` + `dayjs/plugin/timezone`** — smaller than date-fns, but still a dep where none is needed, and its TZ plugin still ultimately leans on `Intl`.

---

## 2. Query strategy: parallel typed reads vs. composite SQL

**Decision**: Four parallel typed Supabase reads via `Promise.all` from `loadDashboard()` in `lib/dashboard/queries.ts`:

1. `querySummaryRows(supabase, tz, 'today', now)` — Today aggregate rows
2. `querySummaryRows(supabase, tz, 'week', now)` — Week aggregate rows
3. `querySummaryRows(supabase, tz, 'month', now)` — Month aggregate rows
4. `queryTodayFeed(supabase, tz, now)` — full ordered list of today's paid tickets for the recent-transactions feed

Plus a tiny up-front read for `salon.timezone` (called once per render) so the four parallel reads can use the correct window math.

**Rationale**:
- A single-salon dataset is tiny: < 100 tickets/day, < 3000 tickets/month. With the two new partial indexes from the migration, each query is index-driven and finishes well under 50ms in typical conditions.
- Parallelism keeps the orchestrator inside the SC-005 budget (300ms p95) with comfortable headroom.
- Plain TypeScript reads (no RPC, no view) keep the layer trivial to test in isolation with a mocked supabase client (Principle IV — test-first for the critical read paths).
- Each helper does one thing, which makes the seed-fixture-driven e2e assertions precise (the e2e seeds N rows and asserts exactly what the query returns).

**Alternatives considered**:
- **Single composite SQL via a Postgres view** — would collapse the four reads into one round trip, but introduces a view that has to be migrated, kept in sync with type-regen, and tested separately. The latency win is in the noise for the dataset size; the maintenance cost is real.
- **Single RPC returning the whole dashboard JSON** — same round-trip win, but locks the layer in Postgres. Hurts test ergonomics (RPCs are awkward to mock at the row level) and couples display logic to schema migrations.

---

## 3. Index choice

**Decision**: Two partial indexes in migration `0008_dashboard_data_wiring.sql`:

- `tickets_status_closed_at_idx ON public.tickets (status, closed_at DESC) WHERE status = 'paid'`
- `payments_status_processed_at_idx ON public.payments (status, processed_at DESC) WHERE status = 'succeeded'`

**Rationale**:
- These indexes match the dashboard's hot WHERE clauses *exactly* — every aggregate query filters by `status` first and then bounds `closed_at` (tickets) or `processed_at` (payments) by the period window.
- Partiality keeps the indexes tiny: the dashboard never reads `open` or `discarded` tickets, and never reads `pending` or `failed` payments. A partial index physically excludes those rows, so on a single-salon dataset the indexes are a few KB total.
- The `DESC` ordering matches the recent-transactions feed's natural sort (`closed_at` desc), so the feed query is an index-only scan in the common case.

**Alternatives considered**:
- **Full (non-partial) indexes** — would also cover discarded tickets and failed payments, which the dashboard never queries. Wastes index space and slows writes (the cash-checkout RPC has to maintain index entries for rows the dashboard ignores).
- **Composite without the `WHERE` filter** — slightly larger and less selective; same write-amplification problem.
- **No indexes** — works at small scale but bites at year-end (Month aggregate over ~3000 rows) and on a slow Supabase region. The marginal cost of adding the indexes now is a one-line CREATE; the marginal cost of debugging a slow dashboard later is much higher.

---

## 4. Force-dynamic mechanism

**Decision**: Declare the dashboard route fully dynamic with `export const dynamic = 'force-dynamic'` at the top of `app/(studio)/dashboard/page.tsx`.

**Rationale**:
- FR-027 is explicit: every navigation re-queries Supabase; no route-level cache, no `revalidate` window, no stale-while-revalidate. The declaration is the spec-level contract, in code, at the file the contract applies to.
- Self-documenting — any future contributor reading the file sees the freshness contract immediately, no hunting through framework-version docs.
- Survives Next.js cache-behavior changes between minor versions (Next 16 has rolled defaults at least twice; pinning the intent at the route level is safer than relying on a derived default).
- The route already reads cookies via `requireStudioSession()`, which auto-trips dynamic rendering in current Next.js — but auto-detection is brittle (one well-meaning refactor that moves the cookie read into a wrapper can flip caching back on). The explicit declaration is belt + suspenders.

**Alternatives considered**:
- **Rely on cookie-read auto-detection** — implicit, brittle, depends on Next.js internals not changing.
- **`export const revalidate = 0`** — equivalent in effect, but less clearly named for "always fresh, no cache." `force-dynamic` is the named contract.
- **Per-request `noStore()` calls** — works inside Server Components but doesn't read as cleanly at the route boundary, and has to be repeated at every fetch site.

---

## 5. Loading skeleton shape

**Decision**: A minimal `app/(studio)/dashboard/loading.tsx` that renders the same six-column tile frame with neutral-token placeholder blocks for each tile, plus an empty feed shell. A long-cycle (~1500ms) opacity pulse animates the placeholder backgrounds.

**Rationale**:
- The skeleton uses the same `.tx-landing` chrome and grid layout as the live render, so the swap-in is visually continuous — no layout jank at the moment data arrives.
- Token-derived neutral colors (`--muted`, `--border`) — no raw values, no off-scale spacing (Principle I).
- The 1500ms opacity pulse is an *ambient* indicator, not a UI affordance. The constitution's animation rules (150ms hover, 200ms popover, 300ms sheet, ease-out-expo) govern reactive affordances; an ambient skeleton pulse doesn't compete with those — there is no event it's reporting progress for. This is consistent with how every other framework treats skeleton screens.
- A `loading.tsx` is the Next.js App Router convention; using it gets us the React 19 Suspense boundary "for free" without bespoke code.

**Alternatives considered**:
- **Full Suspense streaming per tile** — more complex, no real benefit on a fast LAN-class connection; introduces partial-render states the design auditor would have to evaluate separately.
- **Single centered spinner** — visually inconsistent with the rest of the studio shell (which has no spinner anywhere); reads as "the page is hung" rather than "the page is loading."
- **No skeleton at all (relies on the studio shell's render)** — the dashboard would appear to jump from blank to populated; bad first impression on the post-login landing.

---

## 6. Empty-state copy

**Decision**: `No sales yet today.` (sentence case, period terminator).

**Rationale**:
- Matches the design-system "Content fundamentals": calm, specific, second-person-adjacent, sentence case, ends with a period.
- "Today" is the right scope word — the feed is pinned to today (FR-011), so anchoring the copy to the time window prevents staff confusion ("did the feed break?").
- "Yet" implies the day is in progress — sales are coming, not a problem. This matches the front-desk's typical experience: the dashboard is opened first thing in the morning before anyone has cashed out.

**Alternatives considered**:
- **`No transactions yet.`** — clinical; "transactions" is the developer's word, not the salon owner's.
- **`Quiet so far!`** — chirpy; violates "calm, specific" (and the trailing exclamation point clashes with sentence-case discipline elsewhere on the page).
- **No copy at all (visually empty slot)** — leaves a renderless slot that owners will read as a bug; also creates a layout-height delta vs. the populated case, which the spec's edge-case section explicitly tries to prevent (FR-013).

---

## 7. `Split` payment-pill color choice

**Decision**: Render the `Split` pill with the muted-color family from Lacquer — `var(--muted)` background, `var(--foreground)` label, `var(--border)` outline. Same border-radius, padding, and typography as the existing `card` / `cash` / `gift` pills.

**Rationale**:
- Single-salon dashboards see split-tender only occasionally (it's a real flow per `docs/system-design.md` — `$20 cash + remainder card` — but not the majority). Visual hierarchy should keep the three pure-method pills as the dominant cases.
- A neutral fill reads as "intentionally not one of the three pure methods" without competing for attention, which is exactly the meaning the spec assigns to `Split` (a *meta* category, not a fourth equal method).
- All colors trace to existing Lacquer tokens — Principle I is satisfied without inventing a new color slot.
- The pill's geometry is unchanged, so the recent-transactions feed row's grid (FR-014a — "no row-layout change") holds.

**Alternatives considered**:
- **Brand-color pill** (e.g. `var(--primary)`) — over-emphasizes a rare case; pulls visual weight from the headline tiles where it belongs.
- **Striped / two-tone pill** (one color per method on the ticket) — introduces a new pill shape, violates Principle I's "no new chrome" stance, and would have to scale to N-method tickets (in theory, a refund creates a 3-method ticket).
- **Existing `gift` color reused** — would conflate split-tender with gift-card payments, which is exactly the confusion the feature is trying to avoid.

---

## Outcome

All Phase 0 decisions captured. No NEEDS CLARIFICATION remains anywhere in the spec or in this research file. Phase 1 (design + contracts) can proceed.
