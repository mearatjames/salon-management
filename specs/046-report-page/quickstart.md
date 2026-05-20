# Quickstart: Report Page

**Feature**: 046-report-page

## What this feature adds

A new owner/manager-only **Report** page at `/report` — per-technician earnings,
deductions (card processing fee + supply cost), commissionable amount, and card
tips, for a Day / Week / Semi-monthly period. Drill into one technician's
transactions; expand a transaction for its itemised deduction breakdown. Print
the current view or export the per-technician summary as CSV.

## Run it locally

```bash
# from the worktree root
npm install                 # first time only
supabase start              # shared local stack (no-ops if already up)
npm run dev                 # http://localhost:3000
```

1. Sign in as the seeded **owner** (`owner@tangnails.dev`).
2. Open **Report** from the sidebar's *Operations* group (it replaces the old
   disabled "Day Report" placeholder).
3. The page opens on **today**. The seed ships 5 paid tickets today across
   Maya / Jordan / Sam — every seed service is `card_fee_mode='default'`, so
   card-settled tickets show a $3-per-service card fee and cash tickets show
   none.
4. Click a technician on the left → their transaction detail. Click a
   transaction row with deductions → the itemised breakdown expands.
5. Switch **Week** / **Semi-monthly**; step ‹ › through periods. Step back to an
   empty period → the empty state.
6. **Print** → the printout drops the sidebar, top bar, and buttons.
   **Export CSV** → `Report-<range>.csv` downloads.
7. Sign in as a **technician** and visit `/report` directly → redirected to
   `/dashboard` (the route redirect is the security boundary).

## Verify

```bash
npm run format:check
npm run lint
npm run typecheck
npm test                    # Vitest — incl. report window / aggregate / tip-split / csv
npm run test:e2e            # Playwright — incl. report.spec.ts
```

Intermediate per-phase gates use the scoped commands (`npm run test:changed`,
`npm run test:e2e:changed`, prettier/eslint over `git diff`); the final gate
runs all five full. See CLAUDE.md § "Pre-push quality gates".

## Key files

- `app/(studio)/report/page.tsx` · `loading.tsx` — route + skeleton
- `lib/report/{queries,aggregate,window,csv,format}.ts` — server query + pure logic
- `lib/time/period-windows.ts` — gains `semiMonthlyWindowAt`
- `components/lacquer/report/*` — UI (see contracts §C6)
- `styles/report.css` — page styles, adapted from the prototype, fully tokenised
- `components/lacquer/sidebar/nav-items.ts` — `day-report` placeholder → live `report`

## Manual-test focus

- **Reconciliation** — the totals row equals the sum of the technician rows for
  every column (SC-002).
- **Exempt** — a technician with zero deductions shows the "No deductions"
  badge; their detail view omits the deduction columns; commissionable = gross.
- **Multi-tech transaction** — services attribute to the performing tech; the
  card tip splits proportionally with no cent drift.
- **Cash vs card** — a cash-only ticket incurs no card fee; a split cash+card
  ticket does.
</content>
