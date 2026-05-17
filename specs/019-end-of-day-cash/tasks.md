---

description: "Task list for End of Day Cash Count (019-end-of-day-cash)"
---

# Tasks: End of Day Cash Count

**Input**: Design documents from `/specs/019-end-of-day-cash/`

**Prerequisites**: `plan.md` ✅ · `spec.md` ✅ · `research.md` ✅ · `data-model.md` ✅ · `contracts/` (3 files) ✅ · `quickstart.md` ✅

**Tests**: Included. Principle IV (Test-First for Critical Paths) mandates Vitest tests for the close-action and aggregation helper to be written **before** the implementation. Playwright e2e covers US1/US2/US3.

**Organization**: Tasks are grouped by user story (US1 → US2 → US3) so each can be implemented, gated, and demoed independently.

## Format

`- [ ] [TaskID] [P?] [Story?] Description with file path`

- **[P]** — parallelizable (different file, no dependency on an incomplete task in the same phase).
- **[USn]** — required on tasks inside a user-story phase; omitted in Setup / Foundational / Polish.

## Path Conventions

Next.js single-app repo. Paths in tasks are relative to repo root:
- App routes: `app/(studio)/end-of-day/`
- UI: `components/lacquer/eod/`
- Domain logic: `lib/end-of-day/`
- Tokens: `styles/end-of-day.css`
- Schema: `supabase/migrations/0014_end_of_day_cash.sql`
- Tests: `tests/unit/end-of-day/`, `tests/e2e/end-of-day-cash.spec.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: One-shot scaffolding. The repo is already set up; this phase only creates the new folders.

- [X] T001 Create empty directory scaffolding at `app/(studio)/end-of-day/`, `components/lacquer/eod/`, `lib/end-of-day/`, and `tests/unit/end-of-day/` (these already partially exist — verify and add what's missing without touching existing files).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, audit vocabulary, query layer, server action, and CSS — all needed before any user-story UI can be built. Per Principle IV, the **money-path tests are written first** (T006, T007) and FAIL until the corresponding implementation lands.

**⚠️ CRITICAL**: No user-story phase may begin until this phase's gate (T012) is green.

- [X] T002 [P] Append `"cash_drawer.closed"` to the `AuditAction` union in `lib/auth/audit.ts`; extend `deriveEntityType` with the `cash_drawer.` prefix dispatch; extend the return-type union to include `"cash_drawer"`. Add a Vitest case in `tests/unit/auth/audit.test.ts` (or the closest existing audit test file) covering `deriveEntityType("cash_drawer.closed") === "cash_drawer"`.
- [X] T003 [P] Write the schema + RPC migration at `supabase/migrations/0014_end_of_day_cash.sql`. Includes: `cash_drawer_sessions` table (per `data-model.md`), `select to authenticated using (true)` RLS policy, the partial unique index `cash_drawer_sessions_one_open_idx`, the `cash_drawer_sessions_business_day_idx`, and the `pos_close_cash_drawer` RPC body matching the contract in `contracts/rpc-pos-close-cash-drawer.md`. End with `revoke all from public; grant execute to service_role`.
- [X] T004 Apply the migration locally: `npx supabase migration up` (or `npx supabase db reset` if you want a clean slate). Verify by running `npx supabase db diff --schema public` and confirming no drift. Depends on T003.
- [X] T005 Regenerate Supabase TypeScript types into `lib/db/types.ts` so the new table and RPC are typed: `npx supabase gen types typescript --local > lib/db/types.ts`. Depends on T004.
- [X] T006 [P] Write `tests/unit/end-of-day/aggregate.test.ts` FIRST (will fail until T009). Cases: empty day → `{ expectedCents: 0, rows: [] }`; cash sales only → expected = sum of `amount_cents`, rows time-ordered; mixed sales + synthetic refund rows (`kind='refund'`) → expected = sales − refunds, refund rows have negative `amount_cents` and `kind === "refund"`; service-summary formatting (1 svc → name; 2 svcs → `a + b`; 3+ → `a +N`).
- [X] T007 [P] Write `tests/unit/end-of-day/close-action.test.ts` FIRST (will fail until T011). Cases per `contracts/server-action.md`: `FORBIDDEN` for `front_desk` and `technician` roles (does not call the RPC); maps `cash_drawer_already_closed` → `code: "ALREADY_CLOSED"`; maps `cash_drawer_expected_changed` → `code: "EXPECTED_CHANGED"`; maps `cash_drawer_note_required` → `code: "NOTE_REQUIRED"`; happy-path success calls `revalidatePath('/end-of-day')` exactly once and returns `{ ok: true, sessionId }`; passes the correct arg shape (`p_counted_cents`, `p_expected_cents`, `p_notes`, `p_operator`, `p_device_user_id`, `p_business_day`) to `supabase.rpc('pos_close_cash_drawer', …)`.
- [X] T008 [P] Add the vendored stylesheet at `styles/end-of-day.css`. Copy the `.eod-*` CSS block from `design-system/prototypes/transaction/End of Day Cash.html` (lines 8–258); every value MUST resolve to a token from `styles/tokens.css` (no raw hex). Audit by greping `#` to confirm zero hardcoded colors.
- [X] T009 Implement `lib/end-of-day/aggregate.ts` — pure helpers consumed by both the query layer and the unit tests. Exports: `type CashRow` (`{ id, processedAt, kind: 'payment' | 'refund', client, services: string, techs: TechBadge[], amountCents, tipCents }`), `function expectedCentsFromRows(rows: readonly CashRow[]): number`, `function formatServicesSummary(serviceNames: readonly string[]): string`. Makes T006 pass.
- [X] T010 Implement `lib/end-of-day/cash-count.ts` — server-only query layer. Exports `async function loadCashCount(supabase, tz, now): Promise<CashCountSnapshot>` where `CashCountSnapshot = { sessionState: 'open' | 'closed', businessDay: string, expectedCents: number, rows: CashRow[], closedSession?: { id, closedAt, expectedCents, countedCents, varianceCents, notes, closedByStaffId } }`. Reads `payments` filtered by `method='cash' AND status='succeeded' AND processed_at IN todayWindow(tz, now)` and joins (one round-trip via Supabase `select(...)`) ticket → ticket_items → services and appointment → client + staff. Also reads `cash_drawer_sessions` for today's row, if present. Depends on T009 + T005.
- [X] T011 Implement `app/(studio)/end-of-day/actions.ts` — `closeCashDrawerAction` Server Action per `contracts/server-action.md`. Uses `requireStudioSession()`, role-gates owner|manager, computes the salon-local business day via `getSalonTimezone()` + a new `salonDateString(tz, date): string` helper added to `lib/time/format.ts` (returns `YYYY-MM-DD` in the salon's local zone; covered by a Vitest case in `tests/unit/time/format.test.ts`), calls the service-role client's `rpc('pos_close_cash_drawer', { p_counted_cents, p_expected_cents, p_notes, p_operator, p_device_user_id, p_business_day })`, maps Postgres `error.message` to the documented codes, and calls `revalidatePath('/end-of-day')` on success. Makes T007 pass. Depends on T002 + T005.
- [X] T012 Foundational gate (scoped — no e2e exists yet for this feature): `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test`. All four MUST pass.

**Checkpoint**: Schema applied, types regenerated, server action working, money-path unit tests green. User-story UI work can begin.

---

## Phase 3: User Story 1 — Count and close, exact match (Priority: P1) 🎯 MVP

**Goal**: Owner or manager opens `/end-of-day`, sees today's cash list with the expected total, types the exact counted amount, taps **Close Out Day**, and sees the closed confirmation. No variance, no note required.

**Independent Test**: Sign in as `owner@tang.local` (or a seeded manager); seed at least one paid cash ticket today; visit `/end-of-day`; type the expected total on the numpad; verify Comparison shows "Exact match" in green and Close Out Day enables; tap it; verify the done screen renders with the expected/counted/difference card and a fresh close timestamp; reload to confirm the closed state persists.

### Tests for US1 (write first; will fail until the matching implementation tasks ship)

- [X] T013 [P] [US1] Create `tests/e2e/end-of-day-cash.spec.ts` with a `describe("US1: count + close exact match", …)` block per `quickstart.md` "Manual smoke test". Use the existing `tests/e2e/_db.ts` cursor pattern for audit-log assertions (`newAuditCursor()` then `getAuditLogRowsSince()`) — the spec should assert exactly one `cash_drawer.closed` audit row with the expected payload shape. Test will FAIL until T014–T020 land.

### Implementation for US1

- [X] T014 [P] [US1] Build `components/lacquer/eod/cash-row.tsx` — pure presentational. Props: `{ kind: 'payment' | 'refund', time: string, client: string, services: string, techs: TechBadge[], amountCents: number, tipCents: number }`. Renders the `.eod-tx-row` grid (time / body / amount column). For `kind='refund'`, amount renders as `−$X.XX` in `var(--destructive)` color and the meta line shows a `Refund` chip in place of (or alongside) the service summary.
- [X] T015 [P] [US1] Build `components/lacquer/eod/cash-list.tsx` — server-renderable. Props: `{ rows: CashRow[], expectedCents: number }`. Renders `.eod-left` shell (panel head with count chip; scrollable `.eod-tx-scroll` over `<CashRow />` children; sticky footer `.eod-list-foot` with "Expected cash total" eyebrow + sub-row + amount in `tnum`). Wire the "Cash today" panel-title + chip count. When `rows.length === 0` render an `<EmptyFeedState />` (reuse `components/lacquer/empty-feed-state.tsx`) with copy "No cash today."
- [X] T016 [P] [US1] Build `components/lacquer/eod/numpad-buttons.tsx` — pure 3×4 grid. Renders `1` … `9`, `.`, `0`, backspace icon. Props: `{ onPress: (key: NumpadKey) => void; disabled?: boolean }` where `NumpadKey = '0'|'1'|…|'9'|'.'|'back'`. Backspace uses Lucide `Delete` icon (1.5px stroke, size 16); no emoji. Inherits all `.eod-nk` styling.
- [X] T017 [P] [US1] Build `components/lacquer/eod/done-screen.tsx` — pure presentational. Props: `{ expectedCents: number, countedCents: number, varianceCents: number, notes: string | null, closedAt: Date }`. Renders the `.eod-done` block (icon tinted by variance state, headline "Day closed out", "Logged at HH:MM" sub, breakdown card with Expected / Counted / Difference rows). For v1 the "Start new count" button is **omitted** (no reopen flow in v1 per spec edge case).
- [X] T018 [US1] Build `components/lacquer/eod/cash-count.client.tsx` — `"use client"` island. Owns the numpad buffer state (`useState<string>("")` + a `fresh` flag) and the comparison-derived state. Renders eyebrow + amount display (the `.eod-display` div with `$` sym + tnum value) + `<NumpadButtons />` + `<Comparison />` + the Close Out Day CTA. On submit, calls `closeCashDrawerAction({ countedCents, expectedCents, notes: "" })` and on `{ ok: true }` calls `router.refresh()`. Reducer rules from `research.md` R7: digit-append, `fresh`-replaces-on-first-digit, `.` no-op if already present, two-decimal cap. **The numpad MUST NOT trigger any server round-trip per keystroke** — all comparison-state derivation stays local to this island; that's the architectural decision that satisfies SC-002 (150 ms keystroke responsiveness). Depends on T011 + T016.
- [X] T019 [US1] Build `app/(studio)/end-of-day/page.tsx` — RSC. Steps: `import "@/styles/end-of-day.css"` (page-level scoping pattern from `app/(studio)/dashboard/page.tsx`); `const viewer = await requireStudioSession()`; if `viewer.staff.role` not in `{ owner, manager }` → `redirect('/dashboard')` (silent; the page should not be discoverable in the sidebar for these roles in the first place — the redirect is the security boundary, not the UX); `const supabase = await createSupabaseServerClient()`; `const tz = await getSalonTimezone(supabase)`; `const snapshot = await loadCashCount(supabase, tz, new Date())`. Render the studio header pill (`Open` if `snapshot.sessionState === 'open'`, `Closed` otherwise) + `.eod-body` flex (cash-list | 1px divider | (cash-count.client OR done-screen depending on session state)). Add `export const dynamic = 'force-dynamic'` to match the dashboard. Depends on T010 + T015 + T017 + T018.
- [X] T020 [US1] Verify `supabase/seed.sql` includes at least one paid cash ticket whose `processed_at` is "today" so the manual smoke test and e2e have data. If none exist for the current business day, add a small seed block (idempotent — guard with `ON CONFLICT DO NOTHING` and a deterministic UUID). Then `npx supabase db reset` to apply.
- [X] T021 [US1] US1 phase gate: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test && npx playwright test tests/e2e/end-of-day-cash.spec.ts -g "US1"`. All MUST pass before US2 begins.

**Checkpoint**: MVP shippable. The cash count + match-case close works end-to-end and is covered by an e2e against seeded Supabase.

---

## Phase 4: User Story 2 — Variance + explanation + close (Priority: P1)

**Goal**: Operator types a counted amount that doesn't equal expected. Comparison shows Over (amber) or Short (red), a note field appears, **Close Out Day** stays disabled until a non-empty note is typed. Submit persists `counted_cents`, `variance_cents`, and `notes`; confirmation shows the note in italics. Also: when the server rejects the close because the underlying expected changed between page-load and submit, a transient banner asks the operator to recount.

**Independent Test**: With expected total $164.50, type $162.50 → border red, "Short −$2.00", Close Out Day disabled. Type any note → button enables. Submit → confirmation card shows the variance with red `Short` row and the note rendered in italics under the breakdown. Separately: open in two browser tabs, complete a cash sale in tab B, press Close Out Day in tab A → banner "A new cash payment was recorded. Please recount the drawer."

### Tests for US2

- [X] T022 [P] [US2] Extend `tests/e2e/end-of-day-cash.spec.ts` with `describe("US2: variance + note required + close", …)`. Three flows: short, over, and stale-rejection-with-recount-banner. The stale flow seeds an extra cash payment between page load and submit via the existing `_db.ts` test-helper; assert the banner text matches the spec exactly. Asserts on the audit row payload's `variance_cents` and `notes` fields.

### Implementation for US2

- [X] T023 [US2] Extend `components/lacquer/eod/cash-count.client.tsx` with: (a) the `.eod-display.match|short|over` border state mapped to `dispCls` derived from the diff; (b) the `<Comparison />` sub-component (or inline) per `EndOfDay.jsx:74` rendering Expected / Counted / Difference rows with state-tinted borders and the Lucide `Check` icon for the "Exact match" row; (c) the discrepancy `<textarea className="eod-note">` rendered only when `hasDiff` is true, with the `"Required to close out"` destructive hint; (d) `canSubmit` derived as `hasCounted && (!hasDiff || notes.trim().length > 0)`; (e) wire `notes` into the action call.
- [X] T024 [US2] Extend `components/lacquer/eod/done-screen.tsx` to render the `.eod-done-note` italic block under the breakdown when `notes !== null`. Tint the `.eod-done-icon` and the `Difference` row's `tnum` per `match | short | over` state. Header pill switches from `Open` (success-tinted) to `Closed` (muted) — owned by `page.tsx`, not the done-screen.
- [X] T025 [US2] In `app/(studio)/end-of-day/page.tsx` (or a tiny sibling client wrapper if needed), render the transient EXPECTED_CHANGED banner above the cash-count island. Pattern: pass a `lastError` prop to the client island; the island, on receiving `{ ok: false, code: "EXPECTED_CHANGED" }` from the action, sets local state that displays a `<div role="status">` banner: "A new cash payment was recorded. Please recount the drawer." Then call `router.refresh()` so the page re-renders with the fresh expected total; clear the banner state on the next non-error keystroke.
- [X] T026 [US2] US2 phase gate: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test && npx playwright test tests/e2e/end-of-day-cash.spec.ts -g "US2"`.

**Checkpoint**: US1 + US2 both pass. The page covers the entire close-out happy path and the variance path.

---

## Phase 5: User Story 3 — Numpad correction (Priority: P2)

**Goal**: Operator can undo digit input cleanly. Backspace removes one digit; Clear resets the entry; tapping `.` twice is a no-op; tapping a third decimal digit is a no-op.

**Independent Test**: Type `1`, `2`, `3` → display `123`; backspace → `12`; Clear → display returns to placeholder `0`; type `1`, `6`, `4`, `.`, `5`, `0` → display `164.50` and Comparison updates; tap `.` again → no change; tap `9` → no change.

### Tests for US3

- [X] T027 [P] [US3] Write `tests/unit/end-of-day/numpad.test.tsx` (Vitest + React Testing Library). Cases: each digit appends; `.` once then `.` again is no-op; after `.` two digits accepted then third digit no-op; backspace pops last char; Clear resets buffer to `""` and `fresh = true`; after Clear, first digit replaces (does not append). Will FAIL until T028 lands the strict rules (US1 already wires basic input but US3 hardens it).

### Implementation for US3

- [X] T028 [US3] In `components/lacquer/eod/cash-count.client.tsx`, finalize the numpad reducer (extract to a pure `numpadReduce(state, key)` helper colocated with the component) covering: decimal-once rule, two-decimal cap, backspace-pops-last, Clear-resets-buffer-and-fresh-flag, fresh-replace-first-digit. Also surface the **Clear** link in the eyebrow row (visible only when `counted !== ""`). Makes T027 pass.
- [X] T029 [US3] Extend `tests/e2e/end-of-day-cash.spec.ts` with `describe("US3: numpad correction", …)`. One flow exercising the full mistype → backspace → clear → retype → submit path against a seeded expected.
- [X] T030 [US3] US3 phase gate: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test && npx playwright test tests/e2e/end-of-day-cash.spec.ts -g "US3"`.

**Checkpoint**: All three user stories pass in isolation and together.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final-mile verification before claiming the feature done.

- [X] T031 Side-by-side design audit. Open `design-system/prototypes/transaction/End of Day Cash.html` in a browser (the `design-system/preview/` folder also contains rendered previews — use whichever matches) and `npm run dev → /end-of-day` side by side. Confirm every spacing, radius, color, type weight, and the empty / match / short / over / done states all match the prototype. Fix any drift in `styles/end-of-day.css` or the component files; never weaken a token to match the prototype — fix the consumer.
- [X] T032 Confirm `supabase/seed.sql` is idempotent: run `npx supabase db reset` twice and verify the second run produces identical row counts in `payments`, `tickets`, `staff`, and `cash_drawer_sessions` (the third should be 0 both times — no cash_drawer_sessions seeded). Re-run the US1 e2e against the second reset to confirm replay works.
- [X] T033 Final gate set (FULL, no scoping): `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five MUST be green before push. Per CLAUDE.md, this is the contract that the PR will not bounce on CI.
- [X] T034 Walk the `quickstart.md` manual smoke test against `npm run dev`: happy path, variance path, stale-data path. Capture any UX rough edges in the PR description.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no deps — start immediately.
- **Foundational (Phase 2)**: depends on Setup. T004 → T005 chain (migration → types). T006 + T007 are written first (TDD); T009 / T011 satisfy them.
- **User Stories (Phase 3+)**: depend on Foundational gate (T012) green.
- **Polish (Phase 6)**: depends on all wanted US phases green.

### User-story dependencies

- **US1 (P1)**: depends only on Foundational. MVP — ships alone.
- **US2 (P1)**: depends on US1 (extends `cash-count.client.tsx` and `done-screen.tsx`). Could run in parallel with US3 only by a second developer if they're careful to coordinate the `cash-count.client.tsx` edits.
- **US3 (P2)**: depends on US1 (extends `cash-count.client.tsx`). Hardens the numpad after the happy path works.

### Within each phase — what's truly parallel

- **Foundational [P] set**: T002 (audit.ts) ∥ T003 (migration) ∥ T006 (aggregate test) ∥ T007 (close-action test) ∥ T008 (CSS). Five different files, no inter-deps.
- **US1 [P] set**: T013 (e2e file, new) ∥ T014 (cash-row) ∥ T015 (cash-list) ∥ T016 (numpad-buttons) ∥ T017 (done-screen). Five different files; assemble into T018 → T019 sequentially.
- **US2**: mostly serial — T023, T024, T025 all touch existing files; only T022 is independent and parallelizable.
- **US3**: T027 (numpad test, new file) ∥ T028 (cash-count.client, edits) — two different files.

---

## Parallel Example — Phase 2 (Foundational)

Open four shells (or four agent dispatches) and run these in parallel after T001:

```text
shell-1: T002 — edit lib/auth/audit.ts (audit vocab + dispatch)
shell-2: T003 — write supabase/migrations/0014_end_of_day_cash.sql
shell-3: T006 — write tests/unit/end-of-day/aggregate.test.ts
shell-4: T007 — write tests/unit/end-of-day/close-action.test.ts
shell-5: T008 — write styles/end-of-day.css
```

Then sequence T004 → T005 (db reset + types regen) → T009 → T010 → T011 → T012.

## Parallel Example — Phase 3 (US1)

After T012 green, fan out:

```text
shell-1: T013 — tests/e2e/end-of-day-cash.spec.ts (US1 describe)
shell-2: T014 — components/lacquer/eod/cash-row.tsx
shell-3: T015 — components/lacquer/eod/cash-list.tsx
shell-4: T016 — components/lacquer/eod/numpad-buttons.tsx
shell-5: T017 — components/lacquer/eod/done-screen.tsx
```

Then sequence T018 (uses T016) → T019 (uses T015, T017, T018, T010) → T020 (seed) → T021 (US1 gate).

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 — scaffold folders.
2. Phase 2 — schema, types, tests-first, query layer, action, CSS. Gate green.
3. Phase 3 — UI + e2e. Gate green.
4. **STOP and demo**: a manager can close out a matching day. This alone is shippable.

### Incremental delivery

1. MVP cut at end of Phase 3 → demo.
2. Phase 4 (US2) → variance + note + stale-data banner → demo.
3. Phase 5 (US3) → numpad polish → demo.
4. Phase 6 → polish + final gate → PR + merge.

### Parallel-team strategy

Two devs after Phase 2 gate: one drives US1 → US3 on `cash-count.client.tsx`; the other writes the e2e specs and the supabase seed updates. Coordinate `cash-count.client.tsx` edits via single-author ownership through US1 → US3.

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase. Do NOT mark a task `[P]` if any prior incomplete task touches the same file.
- Money-path tests (T006, T007) are written **before** their implementation per Principle IV. Verify they fail first, then make them pass.
- Per CLAUDE.md "Scoping intermediate phase gates": per-phase gates (T012, T021, T026, T030) use `git diff` scoped prettier+eslint + full typecheck + full unit + e2e filtered by `-g "USn"`. The final gate (T033) runs everything full.
- Per CLAUDE.md "Skill-level optimizations": `speckit-implement` will auto-dispatch `speckit-design-auditor` after each phase that touched `components/` / `app/` / `styles/`. Do not duplicate that as a task; the auditor pass on T031 is the manual final read.
- The Supabase migration is auto-applied to preview and prod by the two GitHub Actions on PR open and merge to main (Constitution v1.0.3 § Schema drift forbidden) — never `supabase db push` against hosted projects by hand.
