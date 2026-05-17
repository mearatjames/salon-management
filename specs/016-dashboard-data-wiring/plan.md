# Implementation Plan: Dashboard — Real Supabase Data Wiring

**Branch**: `016-dashboard-data-wiring` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-dashboard-data-wiring/spec.md`

## Summary

Replace the studio dashboard's in-repo mock dataset with live Supabase aggregates so every number on the page reflects the real ticket / payment / staff history of the salon. The visual contract from `002-dashboard-page` is preserved except for five explicit deltas (techs-on-shift tile removed, per-tile comparison strings removed, header subtitle's `· N techs on shift` clause removed, recent-transactions feed becomes scrollable and uncapped, recent-transactions client column removed) and one additive (a `Split` payment-pill variant for split-tender tickets). All visual values continue to trace to Lacquer tokens; the feature is fully read-only — no mutations, no realtime, no route caching.

**Technical approach**: introduce a thin per-feature SQL helper layer in `lib/dashboard/queries.ts` that runs four parallel typed Supabase queries (Today summary, Week summary, Month summary, today's full recent-transactions feed) plus a tiny settings read (`salon.timezone`). All period-window math lives in a new `lib/time/period-windows.ts` helper (the constitution-mandated single timezone surface), computing `[start, end]` UTC ranges from the salon's IANA timezone using `Intl.DateTimeFormat` parts — no external date library. The dashboard page is marked `export const dynamic = 'force-dynamic'` (FR-027) so every navigation re-queries Supabase. A new migration `supabase/migrations/0008_dashboard_data_wiring.sql` (a) idempotently seeds `public.settings` with the `salon.timezone` row (default `America/Los_Angeles`, matching the seeded `salon.address` from `0007`), (b) adds two supporting indexes — `tickets (status, closed_at)` and `payments (status, processed_at)` — that turn the aggregate queries into index-only scans for the post-login p95 target, and (c) extends `supabase/seed.sql` with a small fixture of paid tickets with non-zero `tip_cents` so the Tips tile is visually verifiable in local development before card tips ship. UI changes are surgical: `components/lacquer/techs-on-shift-tile.tsx` is deleted; `components/lacquer/recent-transactions-feed.tsx` loses the `client` column (six-col grid → five-col), the seven-row cap, and gains a scrollable list and an empty-state slot; `components/lacquer/period-summary.client.tsx` stops rendering `transactionsDelta`/`revenueDelta`; `components/lacquer/method-pill.tsx` (extracted from inline JSX in the existing feed) gains a `split` variant; `styles/dashboard.css` updates the `.tx-feed-row` grid and `.tx-meth-pill` rules. `lib/dashboard/mock-data.ts` and the `PERIOD_FACTOR` extrapolation in `lib/dashboard/aggregate.ts` are deleted. The dashboard page (`app/(studio)/dashboard/page.tsx`) wires the new query helpers in place of `buildDashboardData()`, adds a `loading.tsx` skeleton and inherits the studio shell's `error.tsx` for graceful error rendering.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 22 (Next.js 16 App Router; Server Components for the dashboard page and its data layer, one existing Client Component for the period toggle). No language version change vs the preceding features.

**Primary Dependencies**: Next.js 16, React 19, `@supabase/supabase-js` (via the existing typed clients in `lib/db/`), shadcn/ui primitives already in use, `lucide-react`, Tailwind CSS. No new runtime dependencies. Timezone-aware date math uses the built-in `Intl.DateTimeFormat` API — explicitly no `date-fns-tz`, no `@js-temporal/polyfill`, no `dayjs` — keeping the dependency surface flat (Principle V) and avoiding a polyfill on the server.

**Storage**: Supabase Postgres (hosted preview + prod). One new migration `0008_dashboard_data_wiring.sql`. Schema changes: zero — the migration only inserts the `salon.timezone` setting row and creates two read-supporting indexes on existing tables (`tickets`, `payments`). The migration is auto-applied by the existing `.github/workflows/db-migrate-{preview,prod}.yml` actions (Constitution § Schema drift forbidden). `supabase/seed.sql` gains a small block that, in dev only, creates ~5 paid tickets with non-zero `tip_cents` plus their `ticket_items` and `payments` rows — gated by an `where exists (select 1 from auth.users where email = 'owner@tangnails.dev')` guard so it never runs against prod (the prod env never has the dev seed user).

**Testing**: Vitest unit suite covers (a) `lib/time/period-windows.ts` — `todayWindow` / `weekWindow` / `monthWindow` across the salon TZ (America/Los_Angeles), DST spring-forward (PST→PDT 2026-03-08) and fall-back (PDT→PST 2026-11-01), Sunday→Monday week-rollover, month-boundary edge (last second of January in the salon TZ), and far-from-UTC timezones (Asia/Tokyo, Pacific/Auckland) to prove the helper isn't accidentally UTC-dependent; (b) `lib/dashboard/aggregate.ts` pure helpers — the existing `txAggregate` / `txTotals` are deleted along with the mock data, replaced by a small `summarizeRows()` pure function whose unit tests cover empty period, discount-row exclusion from Services count, failed-payment exclusion from Revenue/Mix, and split-tender bucketing into the `Split` pill marker; (c) `lib/dashboard/queries.ts` — against a mocked supabase service-role client, asserting each of the four queries selects the right columns, filters by the right `(status, closed_at)` bounds, and gracefully returns the empty-state shape when the result is empty. Playwright e2e suite adds one new spec `tests/e2e/dashboard.spec.ts` with three describe blocks: `US1: today's real numbers` (seed 5 paid tickets today across cash + card with one split tender, assert each tile, the Payment-mix segments, the subtitle's weekday/date/last-sale, the Tips $0.00 from the cash-only payments and >$0 from a seeded tip), `US2: period switching across calendar windows` (seed across today / this-week-not-today / this-month-not-week / last-month-control, toggle and assert tile values for each period, including the empty-period state for a freshly-seeded fixture with zero week activity), and `US3: scrollable today feed` (seed 15 paid tickets today, assert feed length 15 with `closed_at` desc, assert the feed container scrolls inside its slot via `boundingBox()` height assertion, assert the period toggle doesn't change the feed). All e2e tests follow the existing `tests/e2e/_db.ts` cursor pattern; the dashboard feature itself emits no audit rows (read-only), so audit cursor usage is limited to verifying the absence of writes.

**Target Platform**: Studio web shell on desktop browsers (Chromium/Safari/Firefox latest), shared salon devices (tablet/laptop class, landscape). The dashboard is the post-login landing surface — same profile as every other `(studio)` route. No mobile-specific work in this feature; the 002 spec's responsive rules are preserved.

**Project Type**: Web application — single Next.js app (no separate backend repo). Files live under `app/(studio)/dashboard/`, `components/lacquer/`, `lib/dashboard/`, `lib/time/` (new directory — the constitution-mandated timezone surface), `lib/db/`, `styles/`, `supabase/migrations/`, `supabase/seed.sql`, and `tests/`.

**Performance Goals**: Server-side dashboard render p95 < 300ms (SC-005) under typical single-salon load (< 100 tickets/day, < 3000 tickets/month). The four aggregate queries run in parallel via `Promise.all`; the two new indexes (`tickets (status, closed_at)` and `payments (status, processed_at)`) make each query index-only or index-driven. The 200ms period-switch SLA from SC-003 is trivially met because all three period summaries are computed on every server render and held in the `PeriodProvider`; the client toggle is a pure re-render with no roundtrip.

**Constraints**: Constitution Principle I — every visual value resolves to a token in `styles/tokens.css`; the five intentional visual deltas in the spec (FR-019, FR-020, FR-021, FR-022, FR-023) are deletions of pre-existing surfaces and the one additive (FR-014a, the `Split` pill variant) reuses the existing `.tx-meth-pill` chrome with a Lacquer neutral-color token; the spec's SC-007 explicitly approves these deltas. Principle II — the dashboard is read-only and renders in Server Components; the page calls `requireStudioSession()` (already real) before any data; no client-side Supabase access; the period toggle is the lone Client Component and reads from the server-prepared `PeriodProvider` context. Principle III — read-only; no audit emissions; no money mutations; no idempotency-key concerns. The aggregate queries explicitly filter `payments.status = 'succeeded'`, `tickets.status = 'paid'`, and `ticket_items.kind != 'discount'` per the spec's edge-case rules, so failed/pending/discarded/discount rows never contribute. Principle IV — Vitest + Playwright coverage as listed above; the timezone-window math (DST, Monday-week rollover, month boundary) is the highest-risk pure logic and gets the densest unit coverage; e2e seeds drive the user-visible acceptance scenarios. Principle V — no new runtime dependencies; no new infrastructure; no new framework; the only schema change is two indexes and one settings row; the spec's "Out of scope" section is normative (no realtime, no comparisons, no techs-on-shift, no `View all` route, no per-row drilldown, no tip aggregation beyond reading the field).

**Scale/Scope**: One new migration (zero schema changes; two CREATE INDEX statements; one INSERT ... ON CONFLICT DO NOTHING). One deleted module (`lib/dashboard/mock-data.ts`), one rewritten module (`lib/dashboard/aggregate.ts`), one new module (`lib/dashboard/queries.ts`), one new timezone helper directory (`lib/time/period-windows.ts` + `lib/time/format.ts`), one new settings reader (`lib/db/settings.ts`). One deleted component (`techs-on-shift-tile.tsx`). Three modified components (`recent-transactions-feed.tsx`, `period-summary.client.tsx`, the dashboard page itself). One new component (`empty-feed-state.tsx`). One extracted component (`method-pill.tsx` — peeled out of the inline span in the feed so the `split` variant has a single source of truth). CSS edits scoped to `.tx-feed-row` (six-col → five-col grid), `.tx-feed-list` (scrollable), `.tx-meth-pill.split` (new variant), and the deletion of the `.muted` "Techs on shift" label block in `page.tsx`. ~5 new test files (1 period-windows unit, 1 summarize-rows unit, 1 queries unit, 1 settings unit, 1 dashboard e2e). Estimated ~600–800 LOC net change including the migration and seed fixture. No new top-level directories beyond `lib/time/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.0.3.

| Principle | Status | How this plan satisfies it |
|-----------|--------|----------------------------|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | PASS | The dashboard's visual baseline is `specs/002-dashboard-page` and the corresponding implementation under `app/(studio)/dashboard/` + `components/lacquer/`. This plan preserves the Variation B Stats-rich layout, the `.tx-landing`, `.tx-stat-card`, `.tx-feed`, `.tx-method-bar`, `.tx-period`, `.tx-cta-primary`, `.tx-secondary-action` chrome, the existing six-column stat grid (four headline tiles + payment-mix spanning two), and the lower split. The five intentional deletions (techs-on-shift tile, comparison badges, subtitle clause, feed row-cap, feed client column) are explicitly approved by the spec's SC-007 — the design auditor is briefed via FR-019..FR-023 to read them as scope, not violations. The one additive (`Split` payment-pill variant in FR-014a) reuses `.tx-meth-pill`'s shape and adds a Lacquer-token neutral color (`--muted` family) — no new pill shape, no new typography, no new spacing. The feed row grid collapses from `grid-template-columns: <6 cols>` to `<5 cols>` with the column proportions preserved in their relative order; the deleted `client` column's width is redistributed proportionally between `svc` and `techs` per the token-driven 4px scale (no off-scale values). Icons remain Lucide at 1.5px stroke. No new typography. Side-by-side comparison against `design-system/prototypes/transaction/Landing.jsx` Variation B (lines 282–372) is the first verification step in `quickstart.md`. |
| **II. Server-Authoritative Architecture** | PASS | The dashboard page is a Server Component (`async function DashboardPage()` — already true today). All data fetches run on the server through the existing typed Supabase clients in `lib/db/server.ts`. The client surface is exactly one Client Component (`period-summary.client.tsx` + `period-toggle.tsx`'s `usePeriod()` hook) — unchanged from today. No client-side Supabase access. No mutations introduced. Authorization is the existing `requireStudioSession()` gate from 002 (FR-024 of this spec); RLS on `tickets`, `payments`, `ticket_items`, `staff`, `services`, `settings` is the existing `select-to-authenticated` policy (added by migrations 0001/0003/0004/0007). No new authorization surface. `export const dynamic = 'force-dynamic'` is the spec-level guarantee (FR-027) that every navigation re-queries — making the freshness contract server-authoritative. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | PASS | This feature is read-only — no audit emissions, no money writes, no idempotency keys. The aggregate queries respect the existing snapshot rule on `ticket_items.name_snapshot` (the feed reads the snapshot, not a live `services` join, so historical sales never re-label themselves if the catalog changes later). Money invariants are honored on the read side: Revenue uses `payments.amount_cents + tip_cents` only where `payments.status = 'succeeded'` and the parent ticket is `paid`; this never includes voids, refunds (when they land), or pending charges. Discount line items (`ticket_items.kind = 'discount'`) reduce ticket totals (their negative `unit_price_cents` is already folded into `tickets.total_cents` by `recomputeTicketTotals` from feature 013) but are explicitly excluded from the Services count and the service-summary string per the spec — the dashboard never double-counts a discount as a service rendered. The new seed-data fixture creates well-formed tickets through the same code path the cash-checkout feature uses (`pos_take_cash` RPC), so the money invariants in the database remain self-consistent in dev. |
| **IV. Test-First for Critical Paths** | PASS | The highest-risk pure logic is the timezone-window math — DST transitions, Monday-week rollover, month boundaries, far-from-UTC zones — which are exactly the kind of bugs that only surface in production at 11:59 PM. Vitest unit tests for `period-windows.ts` are written and shown to fail first (test cases pinned to specific dates: 2026-03-08 spring-forward, 2026-11-01 fall-back, 2026-02-28 → 2026-03-01 month rollover, Sunday 2026-05-17 23:59 → Monday 2026-05-18 00:00 week rollover in PST). The `summarizeRows()` pure aggregator gets red-first unit coverage for empty period, discount exclusion, failed-payment exclusion, split-tender detection. The `queries.ts` layer gets red-first coverage via a mocked supabase client. The Playwright e2e spec drives the user-visible acceptance scenarios with seeded fixtures; the seed fixture itself is a Vitest-tested helper. Read-only money paths still warrant test coverage because the spec's correctness claims (Revenue, Tips, Services count, Payment-mix) are *what owners trust the dashboard for* — they ARE the critical path even though no money moves. |
| **V. Scope Discipline & Cost Restraint** | PASS | The spec's "Out of scope" section is the normative guard. This plan does not introduce: a `clients` table or client capture (FR-023, deferred); period-over-period comparisons (FR-020, deferred); a real `techs on shift` concept (FR-019, deferred); a `/transactions` route for `View all` (inert per spec); Realtime subscription (FR-027, deferred); tip aggregation beyond `payments.tip_cents` (deferred); click-through drilldowns (deferred); refund handling on the read side (refunds aren't in the schema yet). No new runtime dependencies. No new infrastructure. The two new indexes cost essentially zero storage on a single-salon dataset and avoid a future `EXPLAIN ANALYZE` rabbit hole when row counts grow. The local-dev seed for tip data is dev-only (gated on `auth.users.email = 'owner@tangnails.dev'`), so it never runs in production. The spec's stated p95 target (300ms) is the SLA — no premature optimization beyond the two indexes (no caching layer, no materialized view, no read replica). |

**Initial gate: PASS.** Re-checked after Phase 1 design — see "Post-design Constitution Re-check" below.

## Project Structure

### Documentation (this feature)

```text
specs/016-dashboard-data-wiring/
├── plan.md                # This file (/speckit-plan command output)
├── research.md            # Phase 0 — decisions: timezone helper (Intl-only), query strategy (parallel typed reads), index choice, force-dynamic mechanism, empty-state copy, loading skeleton shape, Split-pill color token
├── data-model.md          # Phase 1 — 0008 migration shape: settings seed + two indexes; the read-model types for DashboardSummary / TransactionRow as they map to live SQL; the seed-fixture data spec
├── contracts/
│   ├── queries.md         # Phase 1 — the four read-query signatures (function name, input, output shape, the SQL they emit in plain English) + the settings-reader signature
│   └── period-windows.md  # Phase 1 — the timezone-helper API surface: salonNow / todayWindow / weekWindow / monthWindow / formatSubtitle / formatTime — with input/output examples for each
├── quickstart.md          # Phase 1 — developer "build, run, verify" walkthrough including the local-dev seed steps and the design-auditor side-by-side
├── checklists/
│   └── requirements.md    # Spec quality checklist (from /speckit-specify)
└── spec.md                # /speckit-specify + /speckit-clarify output
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   └── 0008_dashboard_data_wiring.sql              # NEW — see data-model.md
│       # - INSERT INTO public.settings (key, value) VALUES
│       #     ('salon.timezone', to_jsonb('America/Los_Angeles'::text))
│       #   ON CONFLICT (key) DO NOTHING;
│       # - CREATE INDEX IF NOT EXISTS tickets_status_closed_at_idx
│       #     ON public.tickets (status, closed_at DESC)
│       #     WHERE status = 'paid';
│       # - CREATE INDEX IF NOT EXISTS payments_status_processed_at_idx
│       #     ON public.payments (status, processed_at DESC)
│       #     WHERE status = 'succeeded';
│       # The two indexes are partial (only the rows that matter for the
│       # dashboard's hot path) so they stay tiny on a single-salon dataset.
└── seed.sql                                        # MODIFY — append a dev-only block at the end that creates
                                                    # ~5 paid tickets today (varied techs, varied methods including
                                                    # one split-tender, varied non-zero tip_cents) so the Tips tile
                                                    # is visually verifiable end-to-end before card tips ship.
                                                    # Gated by:
                                                    #   do $$ begin
                                                    #     if exists (select 1 from auth.users where email = 'owner@tangnails.dev') then
                                                    #       <inserts here>
                                                    #     end if;
                                                    #   end $$;
                                                    # so the block never executes against prod (prod has no dev user).

app/(studio)/dashboard/
├── page.tsx                                        # MODIFY — three concerns:
│                                                   #   1) Replace `buildDashboardData()` with `await loadDashboard()` from
│                                                   #      `lib/dashboard/queries.ts`. `loadDashboard()` calls Promise.all on
│                                                   #      [todaySummary, weekSummary, monthSummary, todayFeed, settings] and
│                                                   #      composes the DashboardData shape.
│                                                   #   2) Add `export const dynamic = 'force-dynamic'` at the top of the file
│                                                   #      (FR-027 — every navigation re-queries Supabase).
│                                                   #   3) Drop the JSX/CSS for the techs-on-shift section (FR-019 — the entire
│                                                   #      "Techs on shift" label block + `<TechsOnShiftTile />` mount) and the
│                                                   #      "Quick actions" label remains as the lower-left's only header.
└── loading.tsx                                     # NEW — minimal skeleton: renders the same six-column grid frame with
                                                    # neutral-token placeholders for each tile, plus an empty feed-shell.
                                                    # No animation beyond a 1500ms ease-in-out opacity pulse on the
                                                    # placeholder backgrounds (within the constitution's 150ms hover /
                                                    # 200ms popover / 300ms sheet bounds — a long-cycle ambient pulse
                                                    # is not a UI affordance). Uses the same .tx-landing chrome so the
                                                    # transition into the real render is jank-free.

components/lacquer/
├── techs-on-shift-tile.tsx                         # DELETE — FR-019.
├── period-summary.client.tsx                       # MODIFY — drop the `transactionsDelta` and `revenueDelta` derivations and
│                                                   #          stop passing `delta` to the Transactions and Revenue
│                                                   #          <StatCard />s (FR-020). No other change; the existing
│                                                   #          PERIOD_SUB labels, `avgServicesPerSale.toFixed(1)`, and grid
│                                                   #          layout stay. The `comparisons` prop on `PeriodProvider`
│                                                   #          becomes unused — its type and `usePeriod()` shape both stop
│                                                   #          carrying the field (caller in page.tsx stops passing it).
├── period-toggle.tsx                               # MODIFY — `PeriodProvider`'s context type drops `comparisons`. No
│                                                   #          behavior change for the toggle button itself.
├── recent-transactions-feed.tsx                    # MODIFY — three concerns:
│                                                   #   1) Drop the `<span className="client">` cell from each row (FR-023).
│                                                   #   2) Replace the inline `<span className="tx-meth-pill ${row.method}">`
│                                                   #      with `<MethodPill method={row.method} />` (so the new `split`
│                                                   #      variant lives in one place).
│                                                   #   3) When `rows.length === 0`, render `<EmptyFeedState />` in place
│                                                   #      of the `<div className="tx-feed-list">` rows; the header (title
│                                                   #      and inert `View all` button) stays visible (FR-013).
├── method-pill.tsx                                 # NEW — extracts the existing `.tx-meth-pill` chrome into one component.
│                                                   #   - props: { method: 'card' | 'cash' | 'gift' | 'split' }
│                                                   #   - renders `<span className={`tx-meth-pill ${method}`}>{LABEL[method]}</span>`
│                                                   #   - LABEL: { card: 'Card', cash: 'Cash', gift: 'Gift', split: 'Split' }
│                                                   #   - The `.tx-meth-pill.split` style ships in `styles/dashboard.css` —
│                                                   #     same shape/typography as the others, with a neutral-color fill
│                                                   #     from the Lacquer `--muted` token family so it reads as "not one
│                                                   #     of the three pure methods" without competing with brand color.
├── empty-feed-state.tsx                            # NEW — calm empty state for the recent-transactions feed.
│                                                   #   - props: none
│                                                   #   - renders a centered `<div>` with the calm copy `No sales yet today.`
│                                                   #     in the muted-foreground token, sized to match an empty
│                                                   #     `.tx-feed-list` slot so the feed container's overall height stays
│                                                   #     close to the populated case (avoids layout jitter on first sale).
└── stat-card.tsx                                   # MODIFY — the `delta` prop becomes optional and is no longer rendered
                                                    #          when `null` (it was already null-tolerated; this just
                                                    #          formalizes the contract so PeriodSummary stops needing to
                                                    #          pass it on Today). Type narrows from `delta: string | null`
                                                    #          to `delta?: string | null`.

lib/dashboard/
├── aggregate.ts                                    # REWRITE — replaces the mock-data-driven `buildDashboardData()` and the
│                                                   #           `PERIOD_FACTOR` extrapolation. Becomes a small pure
│                                                   #           `summarizeRows()` helper that takes an array of typed query
│                                                   #           result rows (paid tickets + their payments + their
│                                                   #           non-discount item qty) and returns a `DashboardSummary` for
│                                                   #           that period. Used by `queries.ts` once per period. The
│                                                   #           file is renamed conceptually from "build the page data" to
│                                                   #           "summarize a period's rows"; it no longer reaches into
│                                                   #           Supabase itself (queries.ts owns that).
├── mock-data.ts                                    # DELETE — replaced wholesale by live queries.
├── queries.ts                                      # NEW — owns every Supabase read for the dashboard:
│                                                   #   - loadDashboard(supabase, tz, salonNow) — orchestrator: Promise.all
│                                                   #     of the four per-period reads + the today-feed read, returns the
│                                                   #     DashboardData shape (greeting/summaries/recent/quickActions/staff).
│                                                   #   - querySummaryRows(supabase, tz, period, salonNow) — returns the
│                                                   #     paid-tickets-with-payments-and-non-discount-qty rows for a single
│                                                   #     period window; calls summarizeRows() to project to DashboardSummary.
│                                                   #   - queryTodayFeed(supabase, tz, salonNow) — returns the full ordered
│                                                   #     list of paid tickets today plus the joined `ticket_items` and
│                                                   #     `payments` needed for the row projection (service-summary string,
│                                                   #     tech avatars from `assigned_staff_id`, method pill via the
│                                                   #     payment-method set, dollar total). Always pinned to today
│                                                   #     regardless of period (FR-011).
│                                                   #   - queryLastSaleTime(supabase, tz, salonNow) — single max(processed_at)
│                                                   #     over today's succeeded payments. Returns null when no sale yet.
│                                                   #   - All five helpers are individually testable with a mocked supabase
│                                                   #     client; the orchestrator gets its own integration test against
│                                                   #     real local Supabase via the e2e seed.
└── format.ts                                       # UNCHANGED — currency/percent formatting helpers are reused as-is.

lib/time/
├── period-windows.ts                               # NEW — the constitution-mandated single timezone surface.
│                                                   #   Pure functions, no Supabase, no React, no Node-only APIs:
│                                                   #     salonNow(tz): Date — wall-clock "now" in the salon's local TZ,
│                                                   #       returned as a UTC Date (millis since epoch is global; the TZ
│                                                   #       is informational for the caller).
│                                                   #     todayWindow(tz, nowUtc): [startUtc, endUtc] — [local midnight, now].
│                                                   #     weekWindow(tz, nowUtc): [startUtc, endUtc] — [most recent local
│                                                   #       Monday 00:00, now]. Week starts Monday (FR-007).
│                                                   #     monthWindow(tz, nowUtc): [startUtc, endUtc] — [first-of-month
│                                                   #       local 00:00, now].
│                                                   #   Implementation uses `Intl.DateTimeFormat(tz, { … }).formatToParts(d)`
│                                                   #   to read year/month/day/hour for the target TZ, then constructs the
│                                                   #   UTC equivalent of the boundary instant by reversing the offset for
│                                                   #   that local datetime — handling DST by re-asking Intl for the boundary
│                                                   #   instant's offset (the standard "two-step" technique). No external
│                                                   #   library; pure ES2020+ on Node 22.
└── format.ts                                       # NEW — the two display formatters the dashboard needs:
                                                    #     formatSubtitle(d: Date, tz: string): string — "Saturday, May 16"
                                                    #     formatTime(d: Date, tz: string): string — "4:14 PM"
                                                    #   Both delegate to `Intl.DateTimeFormat` with locale 'en-US' and
                                                    #   the supplied IANA TZ. Pure functions, no app coupling.

lib/db/
├── settings.ts                                     # NEW — typed key-by-key reader for the public.settings KV table:
│                                                   #     getSetting<T = unknown>(supabase, key: string): Promise<T | null>
│                                                   #     getSalonTimezone(supabase): Promise<string>  // falls back to
│                                                   #                                                  // 'America/Los_Angeles'
│                                                   #                                                  // when the row is
│                                                   #                                                  // missing (FR-008).
│                                                   #   The fallback is the only constant in the file; the rest is generic.
│                                                   #   The function lives here rather than `lib/dashboard/queries.ts` so
│                                                   #   future surfaces (settings page, end-of-day report) can reuse it.
├── server.ts                                       # UNCHANGED — typed authenticated server client.
├── admin.ts                                        # UNCHANGED — typed service-role client (not used by this feature).
└── types.ts                                        # MODIFY (regen) — re-run `supabase gen types typescript` after the 0008
                                                    # migration lands so the new `settings.salon.timezone` row (and the
                                                    # presence of two new indexes, which don't affect the type) is reflected.
                                                    # The settings KV table already has its Row type from feature 013; the
                                                    # regen is bookkeeping.

styles/
└── dashboard.css                                   # MODIFY — three rule changes:
                                                    #   1) `.tx-feed-row` — change `grid-template-columns` from
                                                    #      `<6 cols (time | client | svc | techs | method | amt)>`
                                                    #      to `<5 cols (time | svc | techs | method | amt)>` with the
                                                    #      `client` column's width redistributed proportionally.
                                                    #   2) `.tx-feed-list` — add `overflow-y: auto` and `max-height: 100%`
                                                    #      so the feed scrolls inside its slot (FR-012). The `.tx-feed`
                                                    #      wrapper already enforces the slot's outer height via the
                                                    #      `.tx-landing-bottom-right` flex.
                                                    #   3) `.tx-meth-pill.split` — new variant rule, same border/radius/
                                                    #      padding/typography as the other variants, with the muted-color
                                                    #      token family for fill/border. Label color: `var(--foreground)`.

tests/
├── unit/
│   ├── time/period-windows.test.ts                 # NEW — DST + week-rollover + month-boundary + far-from-UTC fixtures.
│   ├── time/format.test.ts                         # NEW — formatSubtitle + formatTime against America/Los_Angeles and
│                                                   #         Asia/Tokyo (proves the helpers aren't UTC-only).
│   ├── dashboard/aggregate.test.ts                 # NEW — summarizeRows() across empty / discount-exclusion /
│                                                   #         failed-payment-exclusion / split-tender-detection.
│   ├── dashboard/queries.test.ts                   # NEW — against a mocked supabase client:
│                                                   #         querySummaryRows / queryTodayFeed / queryLastSaleTime
│                                                   #         columns + filters + empty-result shape.
│   └── db/settings.test.ts                         # NEW — getSetting/getSalonTimezone happy-path + missing-row fallback.
└── e2e/
    └── dashboard.spec.ts                           # NEW — three describe blocks tagged for the scoped-gate filter:
                                                    #         describe('US1: today\'s real numbers') — five paid tickets,
                                                    #         assert each tile, Payment-mix, subtitle, Tips $0 from
                                                    #         cash-only and >$0 from a seeded tip ticket.
                                                    #         describe('US2: period switching across calendar windows') —
                                                    #         seeded across today / this-week-not-today /
                                                    #         this-month-not-week / last-month-control; toggle and assert.
                                                    #         describe('US3: scrollable today feed') — seed 15 paid tickets
                                                    #         today; assert feed length 15 with closed_at desc; assert
                                                    #         feed container scrolls; assert toggle doesn't change feed.

CLAUDE.md                                           # MODIFY (one-line) — update the "Active feature plan" pointer at
                                                    # the bottom of the file from the previous feature to
                                                    # `specs/016-dashboard-data-wiring/plan.md`.
```

**Structure Decision**: Existing single-app structure (no monorepo) per `docs/system-design.md`. The feature adds one new top-level directory under `lib/` (`lib/time/`) — explicitly mandated by the constitution's § Security & Data Integrity Constraints (the "single `lib/time/*` helper against `SALON_TZ`" rule). Everything else slots into existing directories: `app/(studio)/dashboard/`, `components/lacquer/`, `lib/dashboard/`, `lib/db/`, `styles/`, `supabase/migrations/`, `supabase/seed.sql`, and `tests/`.

## Phase 0 — Research

The clarifications round resolved every spec-level NEEDS CLARIFICATION; Phase 0 here is therefore design-decision capture, not unknown-resolution. The `research.md` file documents each decision in the standard Decision / Rationale / Alternatives format. Topics:

1. **Timezone helper library choice** — Decision: `Intl.DateTimeFormat` only, no external library. Rationale: a Tang Nails-style single-salon app has one consumer and a small surface (today/week/month windows + two formatters); the standard library handles IANA TZ names and DST natively on Node 22; adding `date-fns-tz` would couple this feature to a small dep tree for arithmetic the `Intl` two-step technique already covers. Alternatives considered: `date-fns-tz` (familiar API, 50KB dep, overkill), `@js-temporal/polyfill` (forward-looking but the proposal isn't ratified; polyfill is large), `dayjs` (smaller than date-fns, still a dep where none is needed).
2. **Query strategy** — Decision: four parallel typed Supabase reads via `Promise.all` from `loadDashboard()`. Rationale: the small per-salon dataset (< 3000 tickets/month) means each read is index-driven and sub-50ms; parallelism keeps the orchestrator under the 300ms p95 target with headroom; the code path stays plain TypeScript without an RPC dance. Alternatives: a single composite SQL via a Postgres view (more complex, harder to test in isolation), a single RPC returning the entire dashboard JSON (locks the layer in Postgres, hurts test ergonomics).
3. **Index choice** — Decision: two partial indexes — `tickets (status, closed_at DESC) WHERE status = 'paid'` and `payments (status, processed_at DESC) WHERE status = 'succeeded'`. Rationale: these match the dashboard's hot WHERE clauses exactly; partiality keeps the indexes tiny because the dashboard never reads non-paid tickets or non-succeeded payments. Alternatives: full (non-partial) indexes (waste space on rows the dashboard never reads), composite multi-column without the partial filter (slightly larger and less selective), no indexes (works at small scale but bites at year-end and on slow Supabase regions).
4. **Force-dynamic mechanism** — Decision: `export const dynamic = 'force-dynamic'` at the top of `app/(studio)/dashboard/page.tsx`. Rationale: explicit and self-documenting; survives Next.js cache-behavior changes between minor versions; the route already reads cookies via `requireStudioSession()`, which would auto-trip dynamic anyway, but the explicit declaration is the spec-level contract from FR-027. Alternatives: rely on cookie-read auto-detection (implicit, brittle), `export const revalidate = 0` (equivalent in effect, less clearly named).
5. **Loading skeleton** — Decision: a minimal `loading.tsx` that renders the same six-column tile frame with neutral-token placeholders, a feed shell, and an ambient ~1500ms opacity pulse on the placeholders. Rationale: avoids layout jank at the moment of swap; the long ambient pulse is not a UI affordance (it never indicates progress) and so doesn't conflict with the constitution's 150ms hover / 200ms popover / 300ms sheet animation rules. Alternatives: full Suspense streaming per tile (more complex, no real benefit on a fast network), a single centered spinner (visually inconsistent with the rest of the studio shell).
6. **Empty-state copy** — Decision: `No sales yet today.` Rationale: calm, second-person-adjacent, sentence case, ends with a period — matches the design-system "Content fundamentals" tone. Alternatives: `No transactions yet.` (clinical), `Quiet so far!` (chirpy — violates "calm, specific"), no copy at all (leaves a visually empty slot, owners read it as a render bug).
7. **`Split` payment-pill color** — Decision: render with the muted-color family from Lacquer (`--muted` background, `--foreground` text, `--border` border) — neutral, recedes against the card/cash/gift brand colors so the split case reads as "intentionally not one of the three" rather than competing for attention. Rationale: single-salon dashboards see split tender only occasionally; the visual hierarchy should keep the three pure-method pills as the dominant cases. Alternatives: a brand-color pill (over-emphasizes a rare case), a striped/two-tone pill (introduces a new pill shape, violates Principle I).

**Output**: `research.md` with the seven decisions above. No NEEDS CLARIFICATION remains.

## Phase 1 — Design & Contracts

**Prerequisites:** `research.md` complete.

### Entities → data-model.md

1. **`public.settings` row added by the migration**:
   - `key` = `salon.timezone` (text PK)
   - `value` = jsonb-encoded string, IANA timezone identifier (default `"America/Los_Angeles"`)
   - Idempotent INSERT — `ON CONFLICT (key) DO NOTHING` so re-running the migration is safe.

2. **Indexes added by the migration**:
   - `tickets_status_closed_at_idx ON public.tickets (status, closed_at DESC) WHERE status = 'paid'`
   - `payments_status_processed_at_idx ON public.payments (status, processed_at DESC) WHERE status = 'succeeded'`

3. **Read-model types** (TypeScript types in `lib/dashboard/`):
   - `DashboardData` (returned from `loadDashboard()`) — shape preserved from current `aggregate.ts` so `page.tsx` and the existing components don't change their data contract:
     - `greeting: { eyebrow, title, subtitle }` — subtitle now derived live (FR-010, FR-021)
     - `summaries: Record<'today' | 'week' | 'month', DashboardSummary>` — each derived live (FR-001..FR-007)
     - `staff: readonly Technician[]` — joined from the staff roster for tech avatars in the feed
     - `recent: readonly TransactionRow[]` — derived from `queryTodayFeed()` (FR-011..FR-014a, FR-023)
     - `quickActions: readonly QuickAction[]` — unchanged (static)
     - The previous `comparisons` field is removed (FR-020)
   - `DashboardSummary` — fields preserved: `period`, `count`, `services`, `subtotal`, `tip`, `tax`, `total`, `byMethod: { card, cash, gift }`, `avgServicesPerSale`, `tipPctAvg`. `byMethod` carries the three pure methods only — the `Split` distinction is per-row in the feed (FR-014a), not per-method-in-aggregate (the Payment-mix card stays a three-row legend, FR-006).
   - `TransactionRow` — fields: `id`, `time`, `serviceLabel`, `techIds`, `method: 'card' | 'cash' | 'gift' | 'split'`, `total`. The previous `client` field is removed (FR-023).

4. **Seed-fixture data spec** (for `supabase/seed.sql`, dev-only):
   - 5 paid tickets dated `today` in salon TZ
   - Spread across all four payment-method outcomes: card (×2), cash (×1), gift (×1), split-tender (×1 — one cash + one card payment row on the same ticket)
   - `tip_cents` set to 15–25% of subtotal on the four single-method tickets; $0 on the split-tender one (so the empty-tip path stays visible)
   - 2–3 services per ticket with mixed `kind = 'service'` and one with a `kind = 'discount'` line to exercise the exclusion rule in the service-summary string
   - Techs randomly assigned from the existing staff roster
   - Gated by a guard on `auth.users.email = 'owner@tangnails.dev'` so the block never executes in prod.

### Interface contracts → contracts/

This feature is internal to the studio app — no external API, no public SDK, no CLI. The interface contracts the plan produces are *internal module contracts*, captured in two files:

1. **`contracts/queries.md`** — the five read-helper signatures, with input types, output types, the SQL each emits in plain English, and the failure modes (e.g. "returns the empty-summary shape when the period contains zero rows"). One entry per function: `loadDashboard`, `querySummaryRows`, `queryTodayFeed`, `queryLastSaleTime`, and the settings-reader `getSalonTimezone`.

2. **`contracts/period-windows.md`** — the timezone-helper API surface: `salonNow(tz)`, `todayWindow(tz, nowUtc)`, `weekWindow(tz, nowUtc)`, `monthWindow(tz, nowUtc)`, `formatSubtitle(d, tz)`, `formatTime(d, tz)`. Each entry pins down the exact behavior across DST boundaries, the Monday-week rollover, and the month boundary — these are the contracts the unit tests assert against.

### Quickstart → quickstart.md

The quickstart file walks a developer through: (a) running the migration locally (`supabase db reset`), (b) seeing the seeded paid tickets appear on the dashboard, (c) toggling Today/Week/Month and watching the tiles recalculate, (d) flipping `salon.timezone` via a manual SQL edit and confirming the day boundary shifts on the next render, (e) running the unit + e2e gate, and (f) doing the side-by-side comparison against `design-system/preview/transaction-landing.html` (the canonical Variation B look) to verify the five intentional deltas are present and nothing else has drifted.

### Agent context update

`CLAUDE.md`'s "Active feature plan" line at line 123 — already bracketed by the `<!-- SPECKIT START -->` / `<!-- SPECKIT END -->` marker pair — is updated to point to `specs/016-dashboard-data-wiring/plan.md`.

### Post-design Constitution Re-check

The same five-principle gate, re-asked after Phase 1's design pass:

- **I. Design System Fidelity** — still PASS. Phase 1 surfaced no new components beyond the two listed in Project Structure (`method-pill.tsx` extraction, `empty-feed-state.tsx`), and both reuse existing token-scoped chrome. The `loading.tsx` skeleton uses the same `.tx-landing` chrome as the live render, so the swap is visually continuous.
- **II. Server-Authoritative Architecture** — still PASS. The four query helpers + the settings reader all live on the server (RSC + `lib/`); the `period-toggle` client component continues to read server-prepared state. The `force-dynamic` declaration formalizes the freshness contract.
- **III. Auditability & Money Integrity** — still PASS. The read side respects every existing snapshot rule (`ticket_items.name_snapshot`, `payments.amount_cents`). The seed-fixture writes go through normal INSERT paths (not bypassing `pos_take_cash`'s invariants — the seed is illustrative dev data, not production money flow, and is guarded against prod execution).
- **IV. Test-First for Critical Paths** — still PASS. Phase 1's pure helpers (`period-windows.ts`, `summarizeRows()`) are the most-testable surfaces in the plan; each gets red-first unit coverage. The Playwright e2e drives the three user stories from spec.
- **V. Scope Discipline & Cost Restraint** — still PASS. Phase 1 added no new dependencies, no new infrastructure, and no scope beyond what the spec demands. The two indexes are the only schema additions and they exist solely to meet the spec's SC-005 latency target.

**Post-design gate: PASS.** Proceed to `/speckit-tasks`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations. All gates passed both pre- and post-design.
