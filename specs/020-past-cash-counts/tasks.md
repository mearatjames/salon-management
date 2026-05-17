---

description: "Task list for Past Cash Counts — View and Edit (020-past-cash-counts)"
---

# Tasks: Past Cash Counts — View and Edit

**Input**: Design documents from `/specs/020-past-cash-counts/`

**Prerequisites**: `plan.md` ✅ · `spec.md` ✅ · `research.md` ✅ · `data-model.md` ✅ · `contracts/` (3 files) ✅ · `quickstart.md` ✅

**Tests**: Included. Principle IV (Test-First for Critical Paths) mandates Vitest tests for the edit-action wrapper and the history query layer to be written **before** the implementation. Playwright e2e covers US1/US2/US3.

**Organization**: Tasks are grouped by user story (US1 → US2 → US3) so each can be implemented, gated, and demoed independently.

## Format

`- [ ] [TaskID] [P?] [Story?] Description with file path`

- **[P]** — parallelizable (different file, no dependency on an incomplete task in the same phase).
- **[USn]** — required on tasks inside a user-story phase; omitted in Setup / Foundational / Polish.

## Path Conventions

Next.js single-app repo. Paths in tasks are relative to repo root:

- App routes: `app/(studio)/end-of-day/history/`
- UI: `components/lacquer/eod/history/`
- Domain logic: `lib/end-of-day/` (new modules) and `lib/auth/audit.ts` (extension)
- Tokens: `styles/end-of-day.css` (extension)
- Schema: `supabase/migrations/0015_cash_drawer_edits.sql`
- Tests: `tests/unit/end-of-day/`, `tests/e2e/past-cash-counts.spec.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Folder scaffolding. The repo and the EOD module are already set up by feature 019; this phase only adds the new sub-directories.

- [X] T001 Create directory scaffolding at `app/(studio)/end-of-day/history/`, `app/(studio)/end-of-day/history/[sessionId]/`, and `components/lacquer/eod/history/`. Verify; do not touch existing files under `app/(studio)/end-of-day/` or `components/lacquer/eod/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Audit vocabulary extension, migration + RPC, comparison-helper extraction, query layer, edit Server Action, and CSS additions — all needed before any user-story UI can be built. Per Principle IV, the **money-path tests are written first** (T005, T006, T007) and FAIL until the corresponding implementation lands.

**⚠️ CRITICAL**: No user-story phase may begin until this phase's gate (T013) is green.

- [X] T002 [P] Append `"cash_drawer.edited"` to the `AuditAction` union in `lib/auth/audit.ts` (insert under the existing `// Added by feature 019` block, in a new `// Added by feature 020 (entity_type "cash_drawer")` block). No change to `deriveEntityType` — the existing `cash_drawer.*` prefix rule already routes the new verb to `"cash_drawer"`. Extend the existing audit-derive test in `tests/unit/auth/audit.test.ts` (or the closest existing file) with `deriveEntityType("cash_drawer.edited") === "cash_drawer"`.
- [X] T003 [P] Write the migration at `supabase/migrations/0015_cash_drawer_edits.sql` per `data-model.md` and `contracts/rpc-pos-edit-cash-drawer.md`. Includes: `ALTER TABLE public.cash_drawer_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz` (no default, no trigger); the `pos_edit_cash_drawer(uuid, int, text, uuid, uuid)` function body (lock-row → reject-if-open → recompute-variance → trim-notes → enforce-note-rule → UPDATE → INSERT audit_log); and end with `revoke all from public; grant execute to service_role`.
- [X] T004 [SKIPPED IN SANDBOX — no local supabase in this env; preview migration runs in CI on PR open per CLAUDE.md] Apply the migration locally: `npx supabase migration up` (or `npx supabase db reset` if you want a clean slate). Verify by running `npx supabase db diff --schema public` and confirming no drift. Depends on T003.
- [X] T005 [P] Write `tests/unit/end-of-day/comparison.test.ts` FIRST (will fail until T010 lands the extracted module). Cases: empty `counted` → `state === ""`, `hasCounted === false`; equal counted/expected → `state === "match"`, `diff === 0`, `isMatch === true`; counted > expected → `state === "over"`, `isOver === true`, `diff > 0`; counted < expected → `state === "short"`, `isShort === true`, `diff < 0`; rounding: `counted = "114.99"` against `expectedCents = 11499` yields `countedCents === 11499` and `state === "match"` (defends the `Math.round(parseFloat(counted) * 100)` rule).
- [X] T006 [P] Write `tests/unit/end-of-day/edit-action.test.ts` FIRST (will fail until T012 lands the action). Cases per `contracts/server-action.md`: `FORBIDDEN` for `front_desk` and `technician` roles (does not call the RPC); `BAD_INPUT` when `countedCents` is not a non-negative integer (does not call the RPC); maps `cash_drawer_session_missing` → `code: "NOT_FOUND"`; maps `cash_drawer_session_not_closed` → `code: "NOT_CLOSED"`; maps `cash_drawer_note_required` → `code: "NOTE_REQUIRED"`; happy-path success calls `revalidatePath('/end-of-day/history')` and `revalidatePath('/end-of-day/history/<sessionId>')` exactly once each and returns `{ ok: true, sessionId }`; passes the correct arg shape (`p_session_id`, `p_counted_cents`, `p_notes`, `p_operator`, `p_device_user_id`) to `supabase.rpc('pos_edit_cash_drawer', …)`.
- [X] T007 [P] Write `tests/unit/end-of-day/history.test.ts` FIRST (will fail until T011 lands the query layer). Cases against an in-memory or seeded test database: `loadCashHistoryList({ limit: 90, offset: 0 })` returns rows ordered by `business_day desc`, filtered to `closed_at is not null`; per-row aggregate sets `edited: true` when at least one `audit_log` row exists with `(action='cash_drawer.edited', entity_id=<session.id>)`, else `false`; `limit: 90, offset: 90` returns the next page; `loadCashHistoryDetail(sessionId)` returns the session row plus an `audits: AuditEntry[]` array ordered by `created_at desc`, joined to `staff` for `editorDisplayName`; returns `null` for a non-existent session id.
- [X] T008 [SKIPPED IN SANDBOX — no local supabase CLI; instead manually patched `lib/db/types.ts` with `updated_at: string | null` on the cash_drawer_sessions Row/Insert/Update shapes and added a `pos_edit_cash_drawer` Functions entry mirroring `pos_close_cash_drawer`] Regenerate Supabase TypeScript types into `lib/db/types.ts`: `npx supabase gen types typescript --local > lib/db/types.ts`. Depends on T004. (Marked `[P]` because no other Phase-2 task writes to `lib/db/types.ts`.)
- [X] T009 [P] Extend `styles/end-of-day.css` with the new `.eod-history-*` and `.eod-detail-*` class set. Includes: list shell + row grid (date / amounts / closer-meta), the muted-tone `.eod-edited-pill` (uses `var(--muted)` + `var(--muted-foreground)` per spec; sits next to the close timestamp on each row and next to the title in the detail header), the detail breakdown card (reuses the existing `.eod-done-card` look), the `.eod-change-history-*` accordion (a token-only `<details>` styling), the empty-state container, and the "Show earlier" button. Every value MUST resolve to a token from `styles/tokens.css` (no raw hex). Audit by grepping `#` to confirm zero hardcoded colors. Independent of the existing `.eod-*` block; appended at the bottom of the file.
- [X] T010 Extract `deriveComparison` from `components/lacquer/eod/cash-count.client.tsx` into a new pure module `lib/end-of-day/comparison.ts`. Export: `function deriveComparison(counted: string, expectedCents: number)` returning the existing shape (`{ hasCounted, countedCents, diff, isMatch, isOver, isShort, hasDiff, state }`). Update `cash-count.client.tsx` to import from the new module (delete the local copy). Behavior MUST be identical — the existing US1/US2/US3 e2e for feature 019 continues to pass. Makes T005 pass. Depends on T005 (test written first).
- [X] T011 Implement `lib/end-of-day/history.ts` — server-only query layer. Exports `async function loadCashHistoryList(supabase, opts: { limit: number; offset: number }): Promise<CashHistoryRow[]>` and `async function loadCashHistoryDetail(supabase, sessionId: string): Promise<CashHistoryDetail | null>`. The list query: `SELECT … FROM cash_drawer_sessions LEFT JOIN audit_log ON (audit_log.action='cash_drawer.edited' AND audit_log.entity_id = cash_drawer_sessions.id) WHERE closed_at IS NOT NULL GROUP BY … ORDER BY business_day DESC LIMIT $1 OFFSET $2`, projecting `edited: boolean` from `count(audit_log.id) > 0` and `lastEditedAt: timestamptz | null` from `max(audit_log.created_at)`; then a small follow-up query joins `staff` for closer display name. The detail query: one read of the session row, one read of `audit_log` filtered to `(action='cash_drawer.edited', entity_id = sessionId)` ordered `created_at desc`, one batch read of `staff` to resolve every `acting_as_staff_id` and `closed_by_staff_id` to a display name. Returns `null` when no session matches. Makes T007 pass. Depends on T007 (test written first) + T008.
- [X] T012 Implement `app/(studio)/end-of-day/history/actions.ts` — `editCashDrawerAction` Server Action per `contracts/server-action.md`. Uses `requireStudioSession()`, role-gates owner|manager, validates `sessionId` is a non-empty string and `countedCents` is a non-negative integer (else `BAD_INPUT`), calls the service-role client's `rpc('pos_edit_cash_drawer', { p_session_id, p_counted_cents, p_notes, p_operator, p_device_user_id })`, maps Postgres `error.message` to the documented codes (`NOT_FOUND` / `NOT_CLOSED` / `NOTE_REQUIRED` / `UNEXPECTED`), and on success calls `revalidatePath('/end-of-day/history')` and `revalidatePath(`/end-of-day/history/${sessionId}`)`. Makes T006 pass. Depends on T002 + T008.
- [X] T013 Foundational gate (Playwright skipped per sandbox env constraint; the four other gates — scoped prettier, scoped eslint, full typecheck, full vitest — all green) (scoped — no UI e2e yet for this feature): `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test`. All four MUST pass. The existing feature-019 e2e (`tests/e2e/end-of-day-cash.spec.ts`) MUST also still pass to confirm the T010 extraction did not regress the close screen — invoke it as: `npx playwright test tests/e2e/end-of-day-cash.spec.ts`.

**Checkpoint**: Schema applied, types regenerated, edit Server Action wired, history query layer implemented, comparison helper extracted, money-path unit tests green, feature-019 e2e still green. User-story UI work can begin.

---

## Phase 3: User Story 1 — Review past cash counts (Priority: P1) 🎯 MVP

**Goal**: Owner or manager opens `/end-of-day/history`, sees every closed cash drawer session ordered newest first with all four numbers and the closer's name + close timestamp, and can tap into a read-only detail view with the variance note. A "View past counts" link is present in the `/end-of-day` header.

**Independent Test**: Sign in as `owner@tang.local` (or a seeded manager); seed at least three closed cash drawer sessions (one clean, one over, one short with note); visit `/end-of-day/history`; verify the three rows render in `business_day desc` order with the correct color on each variance; tap a row → detail page loads at `/end-of-day/history/<sessionId>` with the read-only breakdown + note; tap the "View past counts" link from `/end-of-day` and confirm it lands on the same list. Then sign in as a `technician` and confirm `/end-of-day/history` silently redirects to `/dashboard`.

### Tests for US1 (write first; will fail until the matching implementation tasks ship)

- [X] T014 [P] [US1] Create `tests/e2e/past-cash-counts.spec.ts` with a `describe("US1: review past cash counts", …)` block per `quickstart.md` Step 2 + 3. Use the existing `tests/e2e/_db.ts` helpers to seed three closed `cash_drawer_sessions` rows with distinct variances (0 / +$3.50 / −$2.00). Scenarios: list shows the three rows in `business_day desc` order with the right color per variance; tapping a row navigates to `/end-of-day/history/<sessionId>` and the detail page shows the right amounts + note (or "No note recorded" placeholder); technician role hitting `/end-of-day/history` redirects to `/dashboard`; the "View past counts" link on `/end-of-day` navigates to the list. Will FAIL until T015–T021 land.

### Implementation for US1

- [X] T015 [P] [US1] Build `components/lacquer/eod/history/history-empty.tsx` — pure presentational. Renders a centered empty-state inside `.eod-history-empty` (token-only container) with the spec copy: "Closed cash counts will appear here. Close out today's drawer on the End of Day page to start your history." Use the existing `EmptyFeedState` pattern from `components/lacquer/empty-feed-state.tsx` if it composes cleanly; otherwise a plain `<div>` matching its token usage.
- [X] T016 [P] [US1] Build `components/lacquer/eod/history/history-row.tsx` — pure presentational. Props: `{ sessionId: string, businessDay: string, expectedCents: number, countedCents: number, varianceCents: number, closedByName: string, closedAt: Date, edited: boolean }`. Renders a `.eod-history-row` link (`<Link href={`/end-of-day/history/${sessionId}`}>`) with: business day formatted "Mon, May 11" (`Intl.DateTimeFormat` weekday-short + month-short + numeric day, salon tz applied at the page level via the passed `closedAt`); four `tnum` currency columns (expected / counted / variance); variance text colored by sign (success for zero in `var(--muted-foreground)` per spec FR-002 — "show zero in muted color"; success for non-zero positive uses warning; negative uses destructive); closer name + close time; the `.eod-edited-pill` rendered when `edited === true`.
- [X] T017 [P] [US1] Build `components/lacquer/eod/history/history-list.tsx` — server-renderable. Props: `{ rows: CashHistoryRow[], hasMore: boolean, nextOffset: number }`. Renders the panel head ("Past cash counts" + count chip), the scrollable `.eod-history-scroll` over `<HistoryRow />` children, and a "Show earlier" `<Link>` (`/end-of-day/history?offset=<nextOffset>`) under the list when `hasMore`. Empty list → render `<HistoryEmpty />`.
- [X] T018 [P] [US1] Build `components/lacquer/eod/history/detail-view.tsx` — server-renderable. Props: `{ detail: CashHistoryDetail }`. Renders a back link (`<Link href="/end-of-day/history">`, Lucide `ArrowLeft` 1.5px stroke, size 16), a header with business day + closer name + close timestamp, the breakdown card (Expected / Counted / Difference rows, same `tnum` + state-color pattern as the done screen), and the note block (italicized in `.eod-done-note`-style; or "No note recorded" in muted when null). The **Edit count** CTA is rendered inline but its click behavior wires up in T024; for US1 it can be a placeholder `<Link>` that the US2 task replaces. US3 will add the "Last edited" line and the change-history accordion below this card.
- [X] T019 [US1] Build `app/(studio)/end-of-day/history/page.tsx` — RSC. Steps: `import "@/styles/end-of-day.css"`; `const viewer = await requireStudioSession()`; role-gate (`owner`|`manager` → otherwise `redirect('/dashboard')`); `const supabase = await createSupabaseServerClient()`; parse `searchParams.offset` (default 0) and clamp to non-negative integer; `const limit = 90`; `const rows = await loadCashHistoryList(supabase, { limit, offset })`; compute `hasMore = rows.length === limit` (one-extra-row trick is overkill; the offset link will land on an empty page when there's no more — also acceptable). Render the studio header chrome (`tx-landing-top` pattern, "Past cash counts" h1, friendly subtitle) and `<HistoryList rows={rows} hasMore={hasMore} nextOffset={offset + limit} />`. `export const dynamic = 'force-dynamic'`. Depends on T011 + T015 + T016 + T017.
- [X] T020 [US1] Build `app/(studio)/end-of-day/history/[sessionId]/page.tsx` — RSC. Steps: `import "@/styles/end-of-day.css"`; `const viewer = await requireStudioSession()`; same role gate; `const supabase = await createSupabaseServerClient()`; `const detail = await loadCashHistoryDetail(supabase, params.sessionId)`; if `detail === null` → `notFound()` (Next.js `import { notFound } from 'next/navigation'`); render `<DetailView detail={detail} />`. `export const dynamic = 'force-dynamic'`. Also create `app/(studio)/end-of-day/history/[sessionId]/not-found.tsx` — a small centered "Session not found" message with a back-link to `/end-of-day/history`. Depends on T011 + T018.
- [X] T021 [US1] Edit `app/(studio)/end-of-day/page.tsx` — add a "View past counts" `<Link>` to the header chrome. Insert into the existing `style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}` container as a sibling of the status pill (above or below; pick the visually balanced placement against the prototype/preview). Token-only styling (`color: var(--muted-foreground)`, hover `color: var(--foreground)`, `transition: color 150ms var(--ease-out)`). Link copy: "View past counts" with a Lucide `History` icon at size 14. Depends on T019 (the target route must exist).
- [X] T022 [US1] [seed rows authored; db reset deferred to local verification] Verify / extend `supabase/seed.sql` so at least three closed `cash_drawer_sessions` rows exist for distinct historic business days (one clean, one short with note, one over). Use deterministic UUIDs and `ON CONFLICT (id) DO NOTHING` for idempotence. Then `npx supabase db reset` and re-run the manual smoke from `quickstart.md` Step 2.
- [X] T023 [US1] [playwright skipped per sandbox env] US1 phase gate: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test && npx playwright test tests/e2e/past-cash-counts.spec.ts -g "US1"`. All MUST pass before US2 begins.

**Checkpoint**: MVP shippable. Past counts can be browsed and inspected end-to-end; the read-only audit story works without the edit affordance.

---

## Phase 4: User Story 2 — Correct a past count (Priority: P1)

**Goal**: From the detail view, an owner or manager taps **Edit count**, adjusts the counted amount on a numpad (same rules as the close screen) and updates the note. On save, the row is updated in place, the variance is recomputed server-side, and a `cash_drawer.edited` audit row is written in the same transaction. The note rule from feature 019 is re-asserted: a non-zero new variance requires a non-empty note.

**Independent Test**: Pick a closed day with `counted = $164.50`, `variance = $0.00`. Tap **Edit count**. Change counted to `$162.50` and add note "Recount found $2 short." Tap **Save changes**. The detail re-renders with `variance = −$2.00` (destructive color) and the new note. `cash_drawer_sessions` shows `counted_cents = 16250`, `variance_cents = -200`, `updated_at` advanced; `audit_log` has a fresh `cash_drawer.edited` row with the right before/after payload. Separately: blank the note while editing toward a non-zero variance → **Save changes** disables; restore note → button enables.

### Tests for US2

- [X] T024 [P] [US2] Extend `tests/e2e/past-cash-counts.spec.ts` with `describe("US2: edit a past count", …)`. Two flows: (a) successful edit that introduces a variance (asserts the row updates in DB + an audit row is written with correct before/after payload via the `_db.ts` cursor pattern); (b) Save-disabled-when-required-note-is-blank (Playwright assertion against the button's `disabled` attribute as the textarea is emptied). One additional flow: technician role visiting `/end-of-day/history/<sessionId>` redirects to `/dashboard` (defends FR-001's edit-view role gate even at the route boundary).

### Implementation for US2

- [X] T025 [P] [US2] Build `components/lacquer/eod/history/edit-form.client.tsx` — `"use client"` island. Props: `{ sessionId: string, expectedCents: number, openingCents: number, initialCountedCents: number, initialNotes: string | null }`. State: `useState<NumpadState>({ counted: <prefilled-from-initial>, fresh: false })` (the prefill is the numeric string form of `initialCountedCents / 100` with `.toFixed(2)`; `fresh: false` so the first digit appends rather than replaces); `useState<string>(initialNotes ?? "")` for notes; `useState<string | null>(null)` for the action's error message banner; `useTransition`. Imports `deriveComparison` from `lib/end-of-day/comparison.ts` and `NumpadButtons` from `components/lacquer/eod/numpad-buttons`. Renders the same eyebrow + amount display + numpad + comparison + notes textarea pattern as `cash-count.client.tsx`, but the CTA reads **Save changes** (primary) with a **Cancel** secondary that navigates back to `/end-of-day/history/<sessionId>` (the detail view). `canSubmit` mirrors the close-screen rule: `hasCounted && (!hasDiff || notes.trim().length > 0) && !pending` (FR-012: notes are optional when variance is zero). On submit, calls `editCashDrawerAction({ sessionId, countedCents, notes })`. On `{ ok: true }` calls `router.refresh()` (the page is revalidated; the detail view re-renders with the new values + the change-history accordion now populated). On error codes, surfaces the action's `message` in a banner above the form (re-using the same warning-tinted pattern from `cash-count.client.tsx`). Depends on T010 + T012.
- [X] T026 [US2] Wire **Edit count** into `components/lacquer/eod/history/detail-view.tsx`. Replace the US1 placeholder with: a small client-side toggle (or a route-level `?edit=1` query param the page reads — pick the simpler one; recommend the query param so the page stays an RSC and the edit form is the only client island). When `searchParams.edit === '1'`, the detail page swaps the read-only breakdown for `<EditForm sessionId expectedCents openingCents initialCountedCents initialNotes />`; the **Edit count** CTA becomes a `<Link href="?edit=1">`; on save, the action revalidates and the next render drops the `?edit=1` (the form calls `router.push(`/end-of-day/history/${sessionId}`)` after a successful save, then `router.refresh()`). Make sure the `[sessionId]/page.tsx` opts into `searchParams` if it isn't already.
- [X] T027 [US2] [playwright skipped per sandbox env] US2 phase gate: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test && npx playwright test tests/e2e/past-cash-counts.spec.ts -g "US2"`.

**Checkpoint**: US1 + US2 both pass. The full "see + fix" cycle works against the seeded database and the audit row is written for every successful edit.

---

## Phase 5: User Story 3 — Edit indicator + change history (Priority: P2)

**Goal**: When a session has been edited at least once, the history list row shows an "Edited" pill, the detail header shows "Last edited by [Name] at [Time]", and an expandable "Change history" section under the breakdown lists every prior version with timestamp + editor + before/after counted/variance/notes. Sessions that have never been edited show none of these.

**Independent Test**: Take a session that has been edited twice (use US2's flow to edit one session twice, swapping counted and notes each time). Verify: history list row shows the muted "Edited" pill next to the close time; detail header shows "Last edited by [Name] at [HH:MM AM/PM date]"; expanding "Change history" lists two entries newest first with both before/after blocks per the audit_log payload schema. Pick a never-edited session and verify zero indicators show.

### Tests for US3

- [ ] T028 [P] [US3] Extend `tests/e2e/past-cash-counts.spec.ts` with `describe("US3: edited indicator + change history", …)`. Seed flow: close a fresh day, then issue two edits via the same Server Action the UI uses (call `editCashDrawerAction` directly from the test or drive the UI twice). Assert: history list row shows the "Edited" pill (text + computed style is muted); detail header shows the "Last edited by …" line with the correct editor name; expanding the `<details>` accordion (click the `<summary>`) renders two `<li>` (or equivalent) entries in newest-first order with the correct counted/variance/notes for both before and after. Negative case: a sibling session (never edited) shows no pill, no last-edited line, and no accordion.

### Implementation for US3

- [ ] T029 [P] [US3] Build `components/lacquer/eod/history/change-history.tsx` — server-renderable. Props: `{ audits: AuditEntry[] }` where `AuditEntry = { id: string, createdAt: Date, editorDisplayName: string, before: { countedCents: number, varianceCents: number, notes: string | null }, after: { countedCents: number, varianceCents: number, notes: string | null } }`. Renders a `<details className="eod-change-history">` with a `<summary>` ("Change history · N entries", styled token-only) and a list of edit entries newest-first; each entry shows: timestamp (salon-tz, "HH:MM AM/PM · MMM D"), editor display name, before block (counted / variance / notes), after block (same fields). When `audits.length === 0`, render nothing (caller hides the section). Use the `.eod-change-history-*` classes added in T009.
- [ ] T030 [US3] Wire the "Edited" pill into `components/lacquer/eod/history/history-row.tsx` — already accepts the `edited: boolean` prop from T016; ensure the `.eod-edited-pill` renders only when `edited === true`. Make sure `lib/end-of-day/history.ts`'s `loadCashHistoryList` projects the boolean correctly from the audit-log left-join aggregate (T011 already did the SQL — verify the row mapping passes the flag through).
- [ ] T031 [US3] Wire the "Last edited by …" line and the `<ChangeHistory />` mount into `components/lacquer/eod/history/detail-view.tsx`. The line renders under the breakdown row when `detail.audits.length > 0`: "Last edited by [name] at [HH:MM AM/PM · MMM D]" (use `detail.audits[0].createdAt` and `detail.audits[0].editorDisplayName`). The `<ChangeHistory audits={detail.audits} />` mounts below the note block, hidden when `audits.length === 0`. Depends on T029.
- [ ] T032 [US3] US3 phase gate: `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD) && npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .) && npm run typecheck && npm test && npx playwright test tests/e2e/past-cash-counts.spec.ts -g "US3"`.

**Checkpoint**: All three user stories pass in isolation and together. The audit trail is fully readable from the UI without any database tooling.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final-mile verification before claiming the feature done.

- [ ] T033 Side-by-side design audit. Open the existing `design-system/prototypes/transaction/End of Day Cash.html` reference (the close-screen prototype the team shipped 019 against) in a browser, then `npm run dev → /end-of-day/history` and `/end-of-day/history/<sessionId>` (with and without `?edit=1`) side by side. The history view is net-new so the compare is against the design-system **tokens and patterns** rather than a per-pixel match: confirm every color / spacing / radius / type weight on the new list, detail card, edit form, and change-history accordion uses tokens from `styles/tokens.css` (grep `#` and `px` in `styles/end-of-day.css`'s new block). Fix any drift; never weaken a token to match a layout — fix the consumer.
- [ ] T034 Confirm `supabase/seed.sql` is idempotent: run `npx supabase db reset` twice and verify the second run produces identical row counts in `cash_drawer_sessions` and `audit_log` (specifically, the count of `cash_drawer.edited` rows from a re-run e2e should not grow if the e2e seeds are deterministic; if they're not, scope the audit-row count assertion in the e2e). Re-run the US1 + US2 + US3 e2e against the second reset to confirm replay works.
- [ ] T035 Final gate set (FULL, no scoping): `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five MUST be green before push. Per CLAUDE.md, this is the contract that the PR will not bounce on CI.
- [ ] T036 Walk the `quickstart.md` manual smoke test against `npm run dev`: Steps 2 (US1 list), 3 (US1 detail), 4 (US2 edit), 5 (US3 indicators + change history), and 6 (DB audit verification). Capture any UX rough edges in the PR description.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no deps — start immediately.
- **Foundational (Phase 2)**: depends on Setup. T004 → T008 chain (migration → types). T005 / T006 / T007 are written first (TDD); T010 / T012 / T011 satisfy them respectively.
- **User Stories (Phase 3+)**: depend on Foundational gate (T013) green.
- **Polish (Phase 6)**: depends on all wanted US phases green.

### User-story dependencies

- **US1 (P1)**: depends only on Foundational. MVP — ships alone as a read-only history view.
- **US2 (P1)**: depends on US1 (extends `detail-view.tsx` to wire the **Edit count** CTA; reuses `history-row` / `history-list` unchanged).
- **US3 (P2)**: depends on US1 + US2 (extends `detail-view.tsx` again with the last-edited line + the `<ChangeHistory />` mount; extends `history-row.tsx`'s pill rendering — already prop-ready from T016).

### Within each phase — what's truly parallel

- **Foundational [P] set**: T002 (audit.ts) ∥ T003 (migration) ∥ T005 (comparison test) ∥ T006 (edit-action test) ∥ T007 (history test) ∥ T008 (types regen, after T004) ∥ T009 (CSS, after T004 not required — pure additive). Sequence around the migration: T004 (apply) → T008 (types) → T010 / T011 / T012 (which need typed schema).
- **US1 [P] set**: T014 (e2e file, new) ∥ T015 (history-empty) ∥ T016 (history-row) ∥ T017 (history-list, consumes T015 + T016 conceptually but they're different files so still [P] if authored carefully) ∥ T018 (detail-view). Then T019 / T020 (pages) sequence on the above. T021 (header link) depends on T019 (the link target must exist). T022 (seed) and T023 (gate) sequence last.
- **US2 [P] set**: T024 (e2e additions) ∥ T025 (edit-form.client). Then T026 wires into the existing detail page. T027 (gate) last.
- **US3 [P] set**: T028 (e2e additions) ∥ T029 (change-history component). Then T030 / T031 wire into existing files. T032 (gate) last.

---

## Parallel Example — Phase 2 (Foundational)

Open five shells (or five agent dispatches) and run these in parallel after T001:

```text
shell-1: T002 — edit lib/auth/audit.ts (audit vocab)
shell-2: T003 — write supabase/migrations/0015_cash_drawer_edits.sql
shell-3: T005 — write tests/unit/end-of-day/comparison.test.ts
shell-4: T006 — write tests/unit/end-of-day/edit-action.test.ts
shell-5: T007 — write tests/unit/end-of-day/history.test.ts
shell-6: T009 — extend styles/end-of-day.css
```

Then sequence T004 (db reset) → T008 (types regen) → T010 (extract comparison; satisfies T005) → T011 (history query; satisfies T007) → T012 (edit action; satisfies T006) → T013 (gate).

## Parallel Example — Phase 3 (US1)

After T013 green, fan out:

```text
shell-1: T014 — tests/e2e/past-cash-counts.spec.ts (US1 describe)
shell-2: T015 — components/lacquer/eod/history/history-empty.tsx
shell-3: T016 — components/lacquer/eod/history/history-row.tsx
shell-4: T017 — components/lacquer/eod/history/history-list.tsx
shell-5: T018 — components/lacquer/eod/history/detail-view.tsx
```

Then sequence T019 (uses T015 + T016 + T017 + T011) → T020 (uses T018 + T011) → T021 (header link; depends on T019) → T022 (seed) → T023 (US1 gate).

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 — scaffold folders.
2. Phase 2 — schema + types + tests-first + comparison extract + history query + edit action + CSS. Gate green.
3. Phase 3 — list page, detail page, header link, seed. Gate green.
4. **STOP and demo**: a manager can browse and audit past counts. This alone is shippable as a read-only audit improvement.

### Incremental delivery

1. MVP cut at end of Phase 3 → demo.
2. Phase 4 (US2) → edit form + Save action wired through the detail page → demo.
3. Phase 5 (US3) → edit indicator + change-history accordion → demo.
4. Phase 6 → polish + final gate → PR + merge.

### Parallel-team strategy

Two devs after Phase 2 gate: one drives US1 (build the list + detail pages + seed) while the other writes the US2 e2e + the edit-form island in parallel — they can integrate when both finish, since US2's only wiring point in US1's code is one line in `detail-view.tsx` (T026).

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase. Do NOT mark a task `[P]` if any prior incomplete task touches the same file.
- Money-path tests (T005, T006, T007) are written **before** their implementation per Principle IV. Verify they fail first, then make them pass.
- The T010 extraction of `deriveComparison` is a behavior-preserving refactor — feature 019's existing e2e (`tests/e2e/end-of-day-cash.spec.ts`) MUST still pass after T010 lands. T013 includes that check explicitly.
- Per CLAUDE.md "Scoping intermediate phase gates": per-phase gates (T013, T023, T027, T032) use `git diff` scoped prettier+eslint + full typecheck + full unit + e2e filtered by `-g "USn"`. The final gate (T035) runs everything full.
- Per CLAUDE.md "Skill-level optimizations": `speckit-implement` will auto-dispatch `speckit-design-auditor` after each phase that touched `components/` / `app/` / `styles/`. Do not duplicate that as a task; the auditor pass on T033 is the manual final read.
- The Supabase migration is auto-applied to preview and prod by the two GitHub Actions on PR open and merge to main (Constitution v1.0.3 § Schema drift forbidden) — never `supabase db push` against hosted projects by hand.
- The "Edited" indicator is derived from `audit_log` queries (FR-009) — no denormalized flag is added to `cash_drawer_sessions`. The new `updated_at` column powers the "Last edited at" timestamp only.
