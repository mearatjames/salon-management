# Quickstart: Dashboard (Front-Desk Landing)

**Feature**: 002-dashboard-page
**Date**: 2026-05-14

This is the run-and-verify walkthrough for the dashboard surface. Every step
maps to an acceptance scenario or success criterion in [spec.md](./spec.md).

## Prerequisites

- The repo is already scaffolded (feature 001 merged). `npm ci` has been run
  at least once. Node.js 24 LTS is active (`nvm use`).
- No additional services are required. The page reads from an in-repo mock
  module; Supabase, Square, and Auth are not exercised.

## Setup (one-time, only if you haven't already)

```bash
npm ci
```

No `.env.local` keys are needed for this feature.

## Run

```bash
npm run dev
```

Open `http://localhost:3000`. The root page issues a server redirect to
`/dashboard` (FR-001, SC-005). You should land on the dashboard immediately —
no manual navigation. → satisfies **US1 scenario 1**.

## Verify (manual)

Open `http://localhost:3000/dashboard` directly and check the following:

### Header band (FR-003)

- [ ] Eyebrow reads `Lacquer Studio · Front desk`.
- [ ] `<h1>` reads `Today at the salon`.
- [ ] Subtitle pattern: `Tuesday, May 12 · 8 techs on shift · Last sale 4:14 PM`.
- [ ] `Today / Week / Month` toggle with `Today` initially active.
- [ ] "New transaction" CTA visible to the right, with subtitle "Charge a sale".

### Stat grid (FR-004, FR-005, FR-006, FR-007)

With `Today` active, confirm the five tiles show non-zero values:

- [ ] **Transactions** — integer count + `today` sub-line + `+3 vs avg` delta.
- [ ] **Services** — integer count + `<N.N>/sale` sub-line.
- [ ] **Revenue** — `$<int>` + `incl. tax + tip` + `+12%` delta.
- [ ] **Tips** — `$<int>` + `<N>% avg` sub-line.
- [ ] **Payment mix** — proportional bar with three labelled segments + a
      three-row legend (`Card | Cash | Gift card`), each row carrying the
      dollar total.

Click `Week`:

- [ ] All five tiles update **together**, no partial refresh.
- [ ] The `+3 vs avg` and `+12%` deltas **disappear** (FR-006).
- [ ] No network request fires in DevTools (SC-003 budget — confirms server
      precomputation).

Click `Month`, then click `Today` again — values return to their original
state.

→ satisfies **US1 scenarios 2 & 3** + **SC-003**.

### Primary CTA (FR-008)

- [ ] Tab key reaches the "New transaction" button **before** any secondary
      action.
- [ ] Pressing Enter on the focused CTA, or clicking it, navigates to
      `/checkout` (placeholder route — empty page acceptable until the
      checkout feature lands).

→ satisfies **US2** + **SC-002**.

### Lower split (FR-009, FR-010, FR-011, FR-012)

- [ ] Four quick-action buttons stacked vertically with the labels and hints
      from the spec.
- [ ] "Techs on shift" tile shows every member of the roster (initials in a
      tone-colored circle + first name caption).
- [ ] "Recent transactions" feed shows exactly **7 rows**, newest first.
- [ ] At least one row's `serviceLabel` uses the `+N more` shortener (FR-012).
- [ ] Each row shows time, client (or `Walk-in`), service summary, tech
      avatars, a payment-method pill, and dollar total — all in one line.
- [ ] Long client names truncate with ellipsis instead of wrapping.

### Edge cases (FR-018, FR-019, SC-006)

- **Empty period** (smoke check): in DevTools, temporarily comment out the
  contents of `TX_HISTORY` in `lib/dashboard/mock-data.ts` (do not commit).
  Reload `/dashboard`.
  - [ ] All tiles read `0` / `$0`.
  - [ ] Payment-mix bar renders as a single neutral segment, legend rows
        show `$0`.
  - [ ] Restore the file.

- **720 px reflow**: shrink the browser to <720 px wide.
  - [ ] Stat grid wraps to **two columns**.
  - [ ] Lower split collapses to **one column**.
  - [ ] No horizontal scrollbar anywhere from 360 px to 1440 px.

→ satisfies **SC-006**.

### Design-system fidelity (FR-014, FR-015, SC-004)

- [ ] Inspect any element in DevTools: every `color`, `background`,
      `border-color`, `box-shadow`, `border-radius`, and `font-weight` resolves
      to a `var(--*)` from `styles/tokens.css`.
- [ ] No raw hex codes appear in `app/(studio)/dashboard/page.tsx`,
      `components/lacquer/*`, or `styles/dashboard.css`. Verify with:
      ```bash
      ! git diff --cached app/ components/lacquer/ styles/dashboard.css | grep -E "#[0-9a-fA-F]{3,8}\b"
      ```
- [ ] Every icon is from `lucide-react`, stroke 1.5 px, size ∈ {14, 16, 18,
      20, 24}.

→ satisfies **SC-004** (run the `speckit-design-auditor` for the final
verdict).

## Automated verification

Run all three quality gates locally before requesting review:

```bash
npm run typecheck            # 0 errors
npm run lint                 # 0 errors
npm test                     # Vitest: dashboard/aggregate + dashboard/format suites pass
npm run test:e2e             # Playwright: dashboard.spec.ts passes
```

The Playwright spec exercises the full acceptance script above (toggle, feed
order, CTA navigation, 720 px reflow, FR-018 empty-period via a stubbed
fixture). CI runs all four on every PR.

## Known placeholders (intentional)

| Placeholder                                | Removed by                                                |
|--------------------------------------------|-----------------------------------------------------------|
| `requireStudioSession()` returns a fixed demo viewer | Auth feature (`docs/system-design.md` steps 7–8)         |
| Week / Month numbers = `today × {6.4, 27}` | Supabase-wiring feature replaces multipliers with real date-bounded aggregates |
| `/checkout` and `/calendar` are stubs      | Checkout feature, Calendar feature                        |
| `app/(studio)/layout.tsx` "Switch staff" + "Reconnecting…" controls are visible-but-disabled | Auth feature + realtime feature wires them up |

These are documented in [research.md](./research.md) (R2, R9, R10) and in the
[Complexity Tracking](./plan.md#complexity-tracking) table of the plan.
