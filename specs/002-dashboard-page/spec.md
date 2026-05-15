# Feature Specification: Dashboard (Front-Desk Landing)

**Feature Branch**: `002-dashboard-page`

**Created**: 2026-05-14

**Status**: Draft

**Input**: User description: "Now that we have the project scaffolded, I want to start building out the dashboard page. Go through our prototypes and find the dashboard page. I like the B · Stats-rich — dashboard-led option."

## Overview

The dashboard is the first surface someone sees after signing in to the Tang Nails studio app. It is the front-desk landing for the salon owner and staff — a calm, glanceable view of what's happening today plus a prominent path into the most common next action (taking a payment). The visual reference is **Variation B · Stats-rich — dashboard-led** in `design-system/prototypes/transaction/Landing.jsx` (lines 282–372), the full grid of stat cards plus the recent-transactions feed.

This v1 dashboard is read-only and built on the same mock data shape the prototype already uses. Wiring the cards to live Supabase data is explicitly out of scope and is sequenced for a later feature once the transaction/checkout tables are populated. The dashboard ships now so the studio shell, navigation, and front-desk landing route exist before deeper feature work begins.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - At-a-glance day summary on landing (Priority: P1)

When the salon owner or front-desk staff opens the studio app, they land on a dashboard that immediately shows the day's headline numbers — transactions, services rendered, gross revenue, tips, and the cash/card/gift-card payment mix — without any drill-down. They can switch the window between Today, This Week, and This Month with a single toggle.

**Why this priority**: This is the entire point of the surface. Owners check these numbers many times a day; everything else on the page is secondary. If only this works, the page already replaces the spreadsheet glance many salons rely on.

**Independent Test**: Open the dashboard route. Verify the page renders with the salon greeting, the date/shift line, the four stat cards (Transactions, Services, Revenue, Tips), the payment-mix card, and that switching the period toggle updates all five tiles together.

**Acceptance Scenarios**:

1. **Given** the staff member is signed in and lands on the dashboard with "Today" selected, **When** the page renders, **Then** they see five stat tiles populated from the prototype's sample transaction history — Transactions count, Services count, Revenue total in dollars, Tips total in dollars, and a Payment-mix card with three labelled rows (Card, Cash, Gift card) and a proportional bar.
2. **Given** the dashboard is showing Today's totals, **When** the user taps "Week" in the period toggle, **Then** all five stat tiles update in place to reflect the week multiplier and the toggle visually marks "Week" as active.
3. **Given** the user taps "Month" then "Today", **When** the toggle is pressed each time, **Then** the active state moves with the press and tile values update together without page reload.

---

### User Story 2 - Start a new transaction from the dashboard (Priority: P1)

A primary action button labelled **"New transaction"** is permanently visible on the dashboard. Tapping it begins the take-payment flow. The dashboard exposes this entry point so a front-desk staffer never has to hunt through navigation to charge a walk-in or appointment.

**Why this priority**: The dashboard's other job (besides showing numbers) is to be the launchpad for the next sale. Without this CTA, the dashboard is a report, not a workspace.

**Independent Test**: Open the dashboard. Confirm the "New transaction" button is visible in the page header area with a subtitle. Click it and confirm navigation to the checkout/new-transaction route (which may be a stub during this feature — the CTA must navigate, the destination need not be implemented here).

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded, **When** the user looks at the header area, **Then** a prominent **"New transaction"** button appears with a short subtitle (e.g., "Charge a sale") and is reachable by keyboard and pointer.
2. **Given** the dashboard is loaded, **When** the user clicks **"New transaction"**, **Then** the app navigates to the new-transaction entry point (`/(studio)/checkout` placeholder is acceptable until that feature lands).

---

### User Story 3 - Quick actions and supporting context (Priority: P2)

Below the stat grid, the dashboard surfaces a column of secondary actions and a "techs on shift" strip on one side, and the most recent transactions feed on the other. Together these answer "what just happened?" and "what else might I want to do?" without leaving the page.

**Why this priority**: Useful but not load-bearing. Owners would still get value from just the stats and the CTA; quick actions and the feed deepen the surface but can be added incrementally.

**Independent Test**: Verify the lower half of the dashboard shows four labelled quick-action buttons (Today's calendar, Quick walk-in, Day report, End-of-day cash), a "Techs on shift" tile listing the roster avatars, and a Recent transactions list of the latest 6–7 transactions with time, client, service summary, tech avatars, payment method pill, and amount.

**Acceptance Scenarios**:

1. **Given** the dashboard is loaded, **When** the user scans the lower half of the page, **Then** four quick-action buttons appear in a single-column stack, each with a label and one-line hint, and a "Techs on shift" tile shows the roster as small avatars with first names.
2. **Given** the recent-transactions feed is visible, **When** the user views it, **Then** they see up to 7 rows ordered most-recent-first, each row showing time, client name (or "Walk-in"), a service summary string, tech avatars, a method pill (card/cash/gift), and a dollar total.
3. **Given** the user clicks any quick-action button, **When** the click is registered, **Then** the app navigates to the corresponding studio route (placeholder routes acceptable until those features ship).

---

### Edge Cases

- **Empty period**: If the selected period has zero transactions in the sample data, every numeric tile renders `0` (or `$0`) and the payment-mix bar shows an empty/neutral bar instead of dividing by zero.
- **Mobile / narrow viewport**: The dashboard is designed for a tablet/desktop salon counter. On viewports narrower than ~720 px, the layout must remain legible — stat tiles wrap to two columns, the lower split becomes a single column, and no horizontal scrolling is introduced.
- **Long client names**: Recent-transactions rows must truncate the client name with an ellipsis rather than wrap, so each row stays a single line.
- **Long tech rosters**: The "Techs on shift" tile must wrap avatars to multiple rows rather than overflow when the roster exceeds 8 staff.
- **Period switch during slow render**: Re-clicking the active period or rapidly toggling between periods must not double-render or leave a stale value in a tile.
- **Unauthenticated access**: Navigating to the dashboard route without a signed-in staff session must redirect to the existing login / select-staff flow rather than render with empty data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose a dashboard route inside the studio app shell that is the default landing screen after a staff member signs in and selects their identity.
- **FR-002**: The dashboard MUST render the **Stats-rich (Variation B)** layout — a header band, a six-column stat grid (four headline stats spanning one column each plus a payment-mix card spanning two), and a lower split with quick actions + techs-on-shift on the left and a recent-transactions feed on the right.
- **FR-003**: The dashboard MUST display a header containing: an uppercase eyebrow line ("Lacquer Studio · Front desk"), a page title ("Today at the salon"), and a contextual subtitle showing the day-of-week, date, technician count on shift, and time of the last sale.
- **FR-004**: The dashboard MUST display a period toggle in the header with three exclusive options: **Today**, **Week**, **Month**. Toggling MUST update every numeric tile on the page in unison.
- **FR-005**: The dashboard MUST display four headline stat cards with these labels and value shapes: Transactions (integer count), Services (integer count, plus a sub-line showing average services per sale), Revenue (dollars, sub-line "incl. tax + tip"), Tips (dollars, sub-line showing tip percent of subtotal).
- **FR-006**: Stat cards showing comparison context (e.g., "+3 vs avg", "+12%") MUST only render the comparison string when the **Today** period is active; the comparison string MUST be hidden for Week and Month.
- **FR-007**: The dashboard MUST display a Payment-mix card containing a single proportional bar split into three segments (Card, Cash, Gift card) and a three-row legend showing each method's label and dollar total. The bar MUST visually total 100% of the period's revenue.
- **FR-008**: The dashboard MUST display a primary **"New transaction"** call-to-action in the header area. Activating it MUST navigate to the new-transaction entry point in the studio app.
- **FR-009**: The dashboard MUST display four secondary quick-action buttons stacked vertically: **Today's calendar**, **Quick walk-in**, **Day report (X-out)**, **End-of-day cash**. Each MUST show a label and a single-line hint and navigate to the corresponding studio route on activation.
- **FR-010**: The dashboard MUST display a "Techs on shift" tile listing every staff member on the active shift as a compact avatar plus first name.
- **FR-011**: The dashboard MUST display a Recent transactions feed showing up to 7 most-recent transactions, each row containing time, client name (or "Walk-in"), a service summary string, tech avatars, a payment method pill, and a dollar total. The feed MUST include a "View all" link in its header.
- **FR-012**: For the service-summary string, when a transaction has 2 or fewer services it MUST list them comma-separated by name; when it has 3 or more it MUST list the first name followed by "+N more".
- **FR-013**: All numeric values (counts, currencies, percentages, times) MUST be rendered with tabular numerals, currency MUST use a dollar prefix with no decimals on totals (e.g., `$1,240`), and percentages MUST be rendered with no decimals (e.g., `18% avg`).
- **FR-014**: The dashboard MUST source all visual values — colors, spacing, radii, shadows, type weights — exclusively from the Lacquer design tokens (`styles/tokens.css`). No raw hex codes, off-scale spacing, or custom font weights are permitted.
- **FR-015**: The dashboard MUST use only Lucide icons at 1.5px stroke (sized 14, 16, 18, 20, or 24) — no emoji in chrome.
- **FR-016**: The dashboard MUST be reachable only by an authenticated studio session; unauthenticated requests MUST be redirected through the existing login / select-staff flow before the dashboard renders. *(v1 deferral: see Assumptions — the real redirect lands with the auth feature; v1 ships a server-side `requireStudioSession()` stub that returns a fixed demo viewer, so the call site exists but the redirect path is exercised only after the auth feature replaces the stub.)*
- **FR-017**: For this feature, the dashboard MUST source its numbers from a single in-repo mock dataset (the same shape as `design-system/prototypes/transaction/data.jsx`). Wiring to Supabase is explicitly out of scope and is deferred to a later feature.
- **FR-018**: When the selected period contains zero transactions, every numeric tile MUST render `0` or `$0` and the payment-mix bar MUST render as a single neutral segment with the legend rows showing `$0` — no division-by-zero artifacts.
- **FR-019**: At viewport widths below ~720 px the dashboard MUST reflow so the stat grid becomes two columns and the lower split becomes a single column; the page MUST NOT introduce horizontal scrolling on supported viewports.

### Key Entities *(include if feature involves data)*

- **DashboardPeriod**: The user-selected reporting window. One of `today`, `week`, `month`. Drives every numeric value on the page.
- **DashboardSummary**: The aggregated set of numbers displayed across the stat cards and payment-mix card for a given period — transaction count, services rendered, subtotal, tip total, tax, gross total, and a `byMethod` breakdown into card / cash / gift.
- **TransactionRow** (read-model for the feed): A single recent transaction's display projection — time string, client name (or "Walk-in"), an array of service IDs/labels for the summary, an array of tech IDs (for avatar stack), a payment method (`card | cash | gift`), and a total in dollars.
- **Technician** (read-only here): The staff roster used by the "Techs on shift" tile and the tech-avatar stack — identifier, full name, display initials, tone hue.
- **QuickAction**: The static set of four secondary CTAs (Today's calendar, Quick walk-in, Day report, End-of-day cash) with their target studio routes and short hint text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After signing in, a staff member can read today's transaction count, total revenue, total tips, and payment-method mix in **under 5 seconds** without scrolling on a 1024 × 768 tablet viewport.
- **SC-002**: From landing on the dashboard, a staff member can start the new-transaction flow in **one tap** (the primary CTA is visible without scrolling).
- **SC-003**: Toggling between Today, Week, and Month updates all five numeric tiles in **under 200 ms** and 100% of the toggle events update every tile on the page (no partial refreshes, no stale tiles).
- **SC-004**: 100% of the visual values used on the page (color, spacing, radius, shadow, typography) trace to a Lacquer design token; a side-by-side comparison with `design-system/prototypes/transaction/Landing.jsx` Variation B passes the design-system spot-check used by `speckit-design-auditor`.
- **SC-005**: The dashboard is **the** default landing surface after sign-in for 100% of staff sessions; no other studio route claims the post-login redirect.
- **SC-006**: At viewport widths from 360 px to 1440 px wide the page renders without horizontal scrolling and with all five stat tiles and the recent-transactions feed remaining legible (no truncated numbers, no overlapping content).

## Assumptions

- The visual specification is the **Variation B** function `LandingStats` in `design-system/prototypes/transaction/Landing.jsx` (lines 282–372). Variations A (Minimal) and C (Calendar-led) and the `PhoneLanding` mobile variation are explicitly **not** the target — they may be revisited later, but only B is in scope here.
- This feature ships **with mock data only**. The page reads from an in-repo dataset that mirrors `design-system/prototypes/transaction/data.jsx` (the same `TX_HISTORY`, `STAFF`, `SERVICES`, `txAggregate`, `txTotals` shape). A later feature will replace the mock dataset with Supabase queries against the real `tickets` / `payments` / `staff` / `services` tables defined in `docs/system-design.md` — the visual contract on this page does not need to change when that swap happens.
- The dashboard lives at `app/(studio)/dashboard/page.tsx` and becomes the studio-shell default. The existing root `app/page.tsx` will redirect signed-in staff into the dashboard; the login / select-staff flow is unchanged.
- The "New transaction" CTA navigates to the existing `app/(studio)/checkout/` placeholder. Until the checkout feature is implemented, that route can render a stub; this feature only owns the dashboard side of the link.
- The Week and Month period values are computed by applying the prototype's existing `PERIOD_FACTOR` multipliers (1×, 6.4×, 27×) to Today's aggregates for v1 — they are **plausible-looking placeholders**, not real historical roll-ups. When real data lands, those factors are replaced with actual date-bounded aggregates over the same dataset.
- The "Techs on shift" tile and the tech-avatar stack reuse the existing `STAFF` roster shape; staff are considered "on shift" for v1 if they appear in the roster — a real shift-scheduling join is deferred.
- All copy, spacing, radii, and color usage follow the rules in `CLAUDE.md` ("Design system rules (non-negotiable)") and the prototype's existing classes (e.g., `tx-landing`, `tx-stat-card`, `tx-feed`, `tx-method-bar`, `tx-period`, `tx-cta-primary`, `tx-secondary-action`). New classes are introduced only when the prototype does not already cover the layout.
- The dashboard is read-only in this feature: no editing, no creating transactions, no settings — only display, period toggling, and navigation away via the CTAs.
- Accessibility baseline: the period toggle is keyboard-operable, the primary CTA is reachable in the page tab order before secondary actions, every numeric tile has a visible text label, and color is not the only signal for payment-method pills (each pill has a text label too).
- **Auth gate deferred to a later feature**: FR-016's real redirect to login / select-staff is not built here. v1 implements a server-side `requireStudioSession()` helper that returns a fixed demo viewer. The auth feature (per `docs/system-design.md` build-order steps 7–8) replaces the helper body with the real Supabase + staff-PIN check + 12-hour cookie + middleware redirect — without changing the dashboard's call site or the spec's FR-016 contract surface.
- **Header date / last-sale strings are static for v1**: the subtitle is the canonical prototype string `Tuesday, May 12 · 8 techs on shift · Last sale 4:14 PM`. Live computation (real "today", real last-sale timestamp from `payments`) is wired by the Supabase-wiring feature when it replaces the mock dataset.
