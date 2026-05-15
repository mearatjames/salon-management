# Contract: `/dashboard` route

**Feature**: 002-dashboard-page
**Owner**: `app/(studio)/dashboard/page.tsx`

## Route

- **Path**: `/dashboard`
- **Segment**: `app/(studio)/dashboard/page.tsx` (App Router, RSC)
- **Layout chain**: `app/layout.tsx` → `app/(studio)/layout.tsx` → page
- **Default landing**: `app/page.tsx` issues
  `redirect("/dashboard")` (Next 16 `next/navigation`). Sign-in flow's final
  hop also lands here (FR-001, SC-005).

## Request

- **Method**: HTTP `GET` (Next.js page).
- **Auth requirement** (FR-016): the page calls `requireStudioSession()` at
  the top of the Server Component. In v1 the stubbed implementation always
  succeeds; when the auth feature lands the call will throw a `redirect()` to
  `/select-staff` if the cookie is missing or expired. The page itself does
  not change.
- **Query / params**: none.

## Response (rendered HTML)

The page MUST render the following regions in document order. Class names
match the ported Variation-B stylesheet; any element whose class name has
changed is non-compliant.

1. **Header band** (`.tx-landing-top`)
   - Eyebrow `.muted` — exact text `"Lacquer Studio · Front desk"` (FR-003).
   - `<h1>` — exact text `"Today at the salon"` (FR-003).
   - Subtitle `.sub` — pattern `"<weekday>, <month> <day> · <N> techs on shift · Last sale <H:MM AM/PM>"` (FR-003).
   - `<PeriodToggle />` — three buttons `Today | Week | Month`; exactly one
     `.active` at any time (FR-004).
   - `<NewTransactionCTA />` — anchor or button rendered as `<a href="/checkout">`; text `"New transaction"` with sub-line `"Charge a sale"` (FR-008).

2. **Stat grid** (six-column CSS grid, gap 12 px)
   - 4 × `<StatCard />` spanning 1 column each:
     - `Transactions` — value = `summary.count`; sub = `"today" | "week" | "month"`; delta string only when `period === "today"` (FR-005, FR-006).
     - `Services` — value = `summary.services`; sub = `"<avgServicesPerSale>/sale"` (FR-005).
     - `Revenue` — value = `"$<summary.total>"`; sub = `"incl. tax + tip"`; delta string only when `period === "today"` (FR-005, FR-006).
     - `Tips` — value = `"$<summary.tip>"`; sub = `"<tipPctAvg>% avg"` (FR-005).
   - 1 × `<PaymentMixCard />` spanning 2 columns — a single 100%-wide proportional bar split into `card / cash / gift` segments + a three-row legend (FR-007). FR-018: when `summary.total === 0` the bar renders as one neutral segment.

3. **Lower split** (two-column CSS grid, `1fr 1.6fr`, gap 16 px)
   - Left column:
     - "Quick actions" header `.muted` (uppercase, 11 px).
     - `<SecondaryActions cols={1} />` — exactly 4 buttons in this order: `Today's calendar`, `Quick walk-in`, `Day report (X-out)`, `End-of-day cash` (FR-009). Each `<a>` navigates to its route from the data model's QuickAction table.
     - "Techs on shift" header `.muted`.
     - `<TechsOnShiftTile />` — wrap-flex container of every member of `staff`; each cell = 32 px circle (`<TechAvatar />`) + 10 px first-name caption (FR-010). Must wrap when roster > 8 (Edge case).
   - Right column:
     - `<RecentTransactionsFeed />` — exactly `min(7, TX_HISTORY.length)` rows in most-recent-first order, header containing `"Recent transactions"` and a "View all" link (FR-011, FR-012).

## Behavioral guarantees

| Behavior                                                              | Reference        |
|-----------------------------------------------------------------------|------------------|
| Toggling the period updates every tile in unison, with no partial refresh | FR-004, SC-003 |
| Toggle responds in <200 ms with no network call                       | SC-003           |
| Re-clicking the active period is a no-op                              | Edge case        |
| Zero-period renders `0` / `$0` and a neutral payment-mix bar          | FR-018           |
| Long client names truncate (CSS ellipsis), single-line                | Edge case        |
| At viewport ≤720 px: stat grid → 2 columns; lower split → 1 column    | FR-019, SC-006   |
| No horizontal scroll at 360 px – 1440 px                              | SC-006           |
| All numeric values use tabular numerals (`.tnum`)                     | FR-013           |
| Currency: `$<int>` with comma thousands, no decimals on totals        | FR-013           |
| Percent: `<int>% avg`                                                 | FR-013           |
| Only Lucide icons, 1.5 px stroke, sizes ∈ {14,16,18,20,24}            | FR-015           |

## Side effects

- **None** beyond rendering. No mutations, no Server Actions, no Supabase
  calls. Period toggling is in-memory state only — no `router.refresh()`, no
  data refetch.

## Errors

- A future `requireStudioSession()` failure will `redirect("/select-staff")`;
  the page does not render in that case. In v1 the stub never fails so this
  path is structural only.

## Stability commitment

- This route, its rendered region order, and the listed class names form the
  contract the design auditor and the e2e test pin against. Adding a new
  region or moving an existing one is a breaking change to this contract.
