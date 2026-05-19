# E2E Pruning Audit

> Audit for [issue #45](https://github.com/mearatjames/salon-management/issues/45).
> **This is a findings doc, not a deletion proposal.** Actual removals
> happen in follow-up PRs scoped per surface (see "Suggested PR
> sequence" at the bottom).

## Top-line summary

| Metric | Value |
| --- | --- |
| Tests audited | **194** (of 289 total e2e tests) |
| `keep` | **103** (53%) |
| `move-to-unit` | **54** (28%) |
| `delete` (redundant) | **34** (18%) |
| Specs covered | 8 (`auth`, `services-deductions`, `staff`, `supply-types-catalog`, `staff-payout-exemptions`, `services`, `onboarding`, `dashboard`) |
| LOC in scope | ~13.5k of 20.5k total |

**Headline finding:** roughly **half of the audited e2e tests are
candidates for deletion or migration to Vitest.** The pattern is
consistent: surfaces with strong server-action / pure-helper unit
coverage (`services-deductions`, `staff-payout-exemptions`,
`onboarding`, `supply-types-catalog`) over-test that same logic again
through the browser, while surfaces that exercise multi-step browser
flows with weaker unit coverage (`auth`, `services` chrome,
`dashboard` layout) are mostly justified.

**Anti-headline:** `auth` is the outlier — 40 of 43 tests must stay e2e
because session/cookie/middleware/email-delivery contracts have no
unit-test equivalent. Don't prune auth.

## Methodology

For each of the 7 specs the issue called out as having >15 tests, plus
the giant `dashboard.spec.ts` (1243 LOC, 4 tests — spot-checked, not
fully per-test), a parallel audit agent:

1. Extracted every `test('...')` title from the spec.
2. Read the corresponding `tests/unit/<surface>/*.test.ts` (and any
   adjacent unit dirs covering the same logic — `policy`, `time`,
   `dashboard`).
3. For each test, recorded:
   - what it asserts (one line)
   - whether matching unit coverage already exists (file + line, or
     `none`)
   - recommendation: `keep` / `move-to-unit` / `delete`
   - one-line rationale citing the specific unit-test ref or the
     specific browser-only behavior that justifies keeping it

`keep` is reserved for: real navigation, real RSC streaming, real
session/cookie/middleware, modal/wizard state machines, toast
lifecycle, clipboard/email delivery, accessibility wiring
(aria-disabled, keyboard focus), and layout/responsive shape.

`move-to-unit` is recommended when: the underlying logic
(validation, calculation, permission gate, audit-payload shape) is
already a pure server-action or helper function, currently asserted
through the browser only as a side-effect.

`delete` is recommended when: an existing unit test already asserts
the exact same logic with the same inputs/outputs, and the browser
test adds nothing beyond "the DOM reflects the unit-tested result."

## Tests not in this audit

Of the 289 total e2e tests, ~95 live in smaller specs that the issue
did not flag for review — primarily `checkout-*` (~14 files),
`card-payment-*` (~5 files), `gift-card-*` (3 files), `square-oauth`,
`end-of-day-cash`, `past-cash-counts`, `sidebar`, `concurrent-charge`,
the `staff-*-chrome` siblings, etc. Most of these exercise hard
real-world coupling (Square stub round-trips, polling fallbacks, race
windows, cash-counting state machines) where browser coverage is
load-bearing. If the local suite still needs to shrink after the PRs
below land, a second audit pass against the checkout family is the
next obvious place to look.

---

## `auth.spec.ts` — 43 tests

**Verdict: keep 40, move 1, delete 2.** Effectively noop; do not
include in a pruning PR.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | (a) signed-out visit to /dashboard redirects to /login?next=%2Fdashboard | Unauthenticated access to protected route bounces to login with returnTo param. | none | keep | Middleware redirect requires browser session state. |
| 2 | (b) valid credentials redirect to /select-staff?next=%2Fdashboard and write one audit row | Device sign-in with correct email/password succeeds and transitions between auth routes. | login-actions.test.ts:105-145 | keep | Magic-link enumeration parity is unit-tested; full e2e flow through Supabase required. |
| 3 | (c) wrong password shows the identical invalid alert and re-renders the form | Invalid password shows generic error without revealing account existence. | login-actions.test.ts:105-145 | keep | Server-action redirection tested in unit tests; DOM alert + form state are browser-only. |
| 4 | (d) unknown email shows the identical alert text (FR-019) | Unknown email shows identical error to wrong password (no enumeration). | login-actions.test.ts:167-170 | keep | Enumeration parity unit-tested; full redirect flow requires Supabase. |
| 5 | (e) exactly one device.signed_in audit row was written across (b)+(c)+(d) | Only successful login writes an audit row. | audit-actions.test.ts:38-141 | keep | Cross-test audit invariant requires Supabase transaction isolation. |
| 6 | (a) roster renders three tiles by display name | PIN keypad roster shows all active staff after device sign-in. | none | keep | DOM rendering of Supabase query results requires real staff fixture state. |
| 7 | (b) tapping Maya reveals the keypad with 4 empty dots + 11 buttons | Staff tile click expands to PIN entry UI with correct button count. | pin.test.ts:5-42 | keep | UI expansion is browser-only; PIN verification unit-tested separately. |
| 8 | (c) Maya + correct PIN 1234 lands on /dashboard with the chip | Correct PIN submits and transitions to authenticated dashboard. | pin.test.ts:13-20 | keep | PIN verification unit-tested; full auth flow + nav requires RSC/Supabase roundtrip. |
| 9 | (d) fixture owner + wrong PIN 0000 surfaces calm error + audit row | Wrong PIN stays on /select-staff, shows error, writes audit.staff.pin_failed. | pin.test.ts:18-20 | keep | Audit write + URL state requires Supabase transaction. |
| 10 | (e) keyboard input on Jordan's keypad auto-submits | Typing full PIN digits auto-submits without explicit button press. | pin.test.ts:5-42 | keep | Auto-submit on digit count requires browser keypad state machine. |
| 11 | (f) refreshing the keypad page collapses back to the roster | URL-based state restoration: bare /select-staff clears URL params. | none | keep | URL-driven state collapse is navigation behavior. |
| 12 | (a) Switch staff from /dashboard lands on /select-staff (no /login flash) | Switch staff preserves device session; no password re-entry. | none | keep | Device session persistence requires middleware + cookie chain. |
| 13 | (b) previously-selected tile is rendered with the selected modifier | /select-staff carries selectedTileId param to highlight previous operator. | next-url.test.ts:23-56 | keep | URL param handling validated in unit tests; visual modifier is browser-only. |
| 14 | (c) tap Jordan + PIN 5678 → /dashboard with Jordan in the topbar | Second staff member PIN login succeeds and updates operator chip. | pin.test.ts:13-20 | keep | Full operator transition requires Supabase staff query + session write. |
| 15 | (d) one staff.switched audit row (acting_as=Maya) + staff.signed_in with previous_staff_id=Maya | Staff switch writes audit chain with previous-operator tracking. | audit-actions.test.ts:26-74 | keep | Multi-row audit invariant requires Supabase transaction ordering. |
| 16 | (e) operator chip dropdown contains only Sign out | Feature 009: dropdown no longer includes Switch staff. | operator-menu.test.tsx:46-66 | **delete** | Dropdown content fully covered by operator-menu.test.tsx:47-66. |
| 17 | (a) magic-link form submission with owner email redirects to ?magic_sent=... | Magic-link request form submission succeeds and shows confirmation. | login-actions.test.ts:105-145 | keep | Form submission + mail delivery requires Supabase + Mailpit roundtrip. |
| 18 | (b) clicking the magic link from Inbucket lands on /select-staff?next=%2Fdashboard and writes device.signed_in | Magic-link email click through callback succeeds and authenticates device. | callback.test.ts:152-170 | keep | Email delivery + OTP exchange requires external mail server + Supabase flow. |
| 19 | (c) empty-email submit is blocked by the HTML5 `required` attribute (URL unchanged) | Empty email field submission is browser-blocked (no request). | login-actions.test.ts:220-236 | keep | HTML5 constraint validation + no-request behavior is browser-only. |
| 20 | (a)-(e) expired cookie redirects to /select-staff?next=… without flashing /login, and Max-Age=0 clears the cookie | 12-hour operator cookie expiry clears cookie and bounces to staff selection. | cookie.test.ts:60-63 | keep | Cookie middleware + Set-Cookie header inspection requires Next.js middleware layer. |
| 21 | (f) pinning in again as Maya transitions to /calendar (still 404 expected) | Post-expiry re-PIN succeeds; route 404 does not affect auth recovery. | cookie.test.ts:60-63 | keep | Cookie re-verification after manual expiry requires full middleware + server roundtrip. |
| 22 | (a) operator menu → Sign out from /dashboard lands on /login | Sign out clears sessions and redirects to login form. | none | keep | Session termination requires Supabase auth + middleware coordination. |
| 23 | (b) hard reload after sign-out keeps the user on /login | Post-sign-out hard refresh confirms no residual session persists. | none | keep | Session persistence after logout requires middleware re-evaluation. |
| 24 | (c) one device.signed_out audit row with the fixture owner's auth user + staff id | Sign-out writes one audit.device.signed_out with correct actor + acting_as IDs. | audit-actions.test.ts:26-54 | keep | Audit write requires Supabase transaction during sign-out. |
| 25 | renders two-panel shell at ≥ 720px | Login shell renders two columns at desktop viewport width. | none | keep | CSS grid + viewport layout is DOM rendering. |
| 26 | collapses to single panel at < 720px | Login shell collapses to single column below 720px breakpoint. | none | keep | Responsive layout is browser rendering-specific. |
| 27 | (T060) error alert renders inside form panel | Error alert positioned inside form panel per FR-013. | none | keep | DOM positioning requirement is structural. |
| 28 | password reveal toggle flips type | Show/hide password button toggles input type. | none | keep | UI state machine requires React component state. |
| 29 | password reveal toggle is keyboard operable | Tab to toggle button; Enter/Space reveal/hide password. | none | keep | Keyboard accessibility is browser-specific. |
| 30 | password reveal resets on view swap | Navigating away from /login unmounts component; toggle resets on return. | none | keep | React unmount lifecycle + local component state reset. |
| 31 | browser autofill stays masked on first paint | Input type="password" on initial render even with autofill present. | none | keep | Browser autofill interaction + SSR hydration. |
| 32 | (T042) full password reset round-trip | Complete reset flow: forgot → sent → link click → new password → signed in. | reset-password.test.ts:86-114 | keep | Round-trip requires email delivery, OTP exchange, Supabase session write. |
| 33 | (T043) reset writes device.password_reset audit row | Password reset writes audit with method='recovery'. | reset-password.test.ts:94-114 | keep | Audit write during reset requires Supabase transaction + full password update flow. |
| 34 | (T044) callback recovery branch writes device.signed_in with method=recovery | /auth/callback ?type=recovery writes device.signed_in method='recovery'. | callback.test.ts:124-141 (invite case only) | **move-to-unit** | Audit method dispatch is logic-only; callback test already mocks exchange; add recovery method case. |
| 35 | (T045) mismatched passwords render inline error | Password !== confirm shows error without network round-trip. | reset-password.test.ts:142-156 | keep | E2e asserts inline error DOM after form submission. |
| 36 | (T046) password < 8 chars renders inline error | Password < 8 chars shows error without network round-trip. | reset-password.test.ts:125-140 | keep | E2e asserts inline error DOM after form submission. |
| 37 | (T047) expired link renders expired state | Revisiting consumed OTP token shows expired state card + "Request a new link". | callback.test.ts:100-122 | keep | Expired OTP state requires Supabase verify endpoint behavior. |
| 38 | (T053) magic-link request via dedicated view | Clicking "Email me a link" navigates to /login?magic_intent=1. | none | keep | URL-driven view swap + view-pane rendering. |
| 39 | (T054) magic-sent send-another loops back | "Send another link" routes back to magic-intent=1. | none | keep | URL state navigation + link text routing. |
| 40 | (T055) back-to-sign-in clears magic params | "Back to sign in" clears magic_intent + magic_sent URL params. | next-url.test.ts:23-56 | keep | URL param clearing on navigation. |
| 41 | (T062) view swap is in-place (no full navigation) | Clicking /login view links uses pushState. | none | keep | Client-router pushState + performance.getEntriesByType("navigation"). |
| 42 | (T063) view animation respects prefers-reduced-motion | CSS @media disables viewIn animation. | none | keep | CSS media-query animation gating is browser rendering. |
| 43 | invite link lands on /reset-password?type=invite with 'Set your password' heading; submitting password redirects to /select-staff and writes the audit chain | Invite URL → /reset-password → password set → /select-staff + audit chain. | callback.test.ts:124-141 | keep | Invite flow requires admin.inviteUserByEmail + full password setup chain. |

**Summary.** The auth surface is almost entirely browser-only territory:
session/cookie lifecycle, multi-device audit chains, enumeration parity
via identical error text, middleware redirect chains, Mailpit-delivered
magic-link round-trips, and form/keyboard accessibility. Only test #34
(callback recovery method dispatch) is a clean move-to-unit, and only
test #16 (operator menu dropdown contents) is a true delete. Net e2e
runtime savings here are negligible; skip auth in the pruning sequence.

---

## `services-deductions.spec.ts` — 38 tests

**Verdict: keep 9, move 22, delete 7.** Highest absolute payoff —
1816 LOC and 29/38 tests are pruning candidates.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | (a) two-pane shape: left list visible, right pane empty-state, no drawer | Layout structure mounts with closed panel mode. | none | keep | Browser DOM shape & RSC hydration require e2e validation. |
| 2 | (b) click row → panel pre-fills the name input within ~200ms; Save disabled | Row click pre-fills edit panel within 200ms; Save stays disabled when draft matches baseline. | none | keep | Browser keyboard interaction + streaming timing are e2e-only. |
| 3 | (c) edit + save: name change enables Save, redirect toast fires, list row updates, panel stays in edit mode | Name edit enables Save; redirect lands on `?selected=...&toast=changes_saved`. | none | keep | Redirect + toast + reactive list updates require browser + server coordination. |
| 4 | (d) Add service: panel flips to add mode with default values, submit flips to edit for the new row | New service form opens with defaults; save creates row; panel flips to edit. | none | keep | Multi-step wizard flow + createAt-timestamp uniqueness require browser state machine. |
| 5 | (e) discard guard on row-switch: Cancel keeps panel, Discard navigates | Dirty-draft guard on row switch; modal options. | none | keep | Modal dialog + capture-phase event interception require DOM. |
| 6 | (f) discard guard on Add service: Discard flips panel to add mode | Dirty-draft guard when switching from edit to Add. | none | keep | Draft-state preservation + modal flow are browser-only. |
| 7 | (a) seeded service shows default $3 card fee chip on its row | Default card-fee chip renders with text "$3 card fee". | deductions.test.ts:18-27 | **delete** | `effectiveCardFeeCents` covers the logic; chip rendering is UI-only. |
| 8 | (b) default → custom round-trip persists value, chip updates | Mode flip default→custom; $4.50 accepted; Save persists; chip updates. | deductions.test.ts:29-34; validation.test.ts:224-259 | **move-to-unit** | Mode dispatch + custom-cents validation should unit-test; chip text is incidental. |
| 9 | (c) custom → exempt clears chip, hides custom input | Mode flip clears chip and hides input; DB persists mode=exempt. | deductions.test.ts:40-44 | **move-to-unit** | Mode resolution unit-tested; visibility is conditional UI. |
| 10 | (d) exempt → default brings chip back; custom cents null | Mode flip restores chip; DB shows custom_cents=null. | deductions.test.ts:18-44 | **move-to-unit** | Null-clearing logic is server-action concern. |
| 11 | (e) custom > $50 surfaces inline hint and Save stays disabled | "Card fee can't exceed $50" hint; Save disabled. | validation.test.ts:249-258 | **delete** | Validation + error-message identical to `validateCardFeeCustomDollars`. |
| 12 | (f) empty custom-amount in custom mode disables Save | Empty input triggers hint; Save disabled. | validation.test.ts (empty rejection) | **move-to-unit** | Validation logic unit-tested; input-to-disabled wiring is form state. |
| 13 | (g) custom = 0 is allowed and persists card_fee_custom_cents = 0 | Mode=custom amount $0 accepted; Save enabled; DB persists 0. | validation.test.ts:225-228 | **move-to-unit** | Validation + zero-cent persistence is server-action concern. |
| 14 | (a) default state: pre-existing service shows no supply chip + toggle off, inputs hidden | Supply toggle off; no chip; inputs not rendered. | none | keep | Toggle-state-driven UI visibility requires browser. |
| 15 | (b) toggle on → amount pre-fills 5.00, picker renders empty (no type selected) | Toggle on → amount pre-fills $5.00 (FR-021 buffer default); picker empty. | none | keep | FR-021 state-preservation + picker empty-state are UI contracts. |
| 16 | (c) save with valid values: amber chip on row, DB persists | Save → amber chip; DB persists supply_amount_cents & supply_type_id. | validation.test.ts:261-290; none on picker | **move-to-unit** | Amount validation + DB persistence is unit-test ready. |
| 17 | (d) toggle off clears columns + chip disappears | Toggle on; toggle off → DB columns cleared; chip gone. | validation.test.ts + implicit null-clearing | **move-to-unit** | Null-clearing is server-action concern. |
| 18 | (e) buffer preservation on toggle off → on (FR-021) | Toggle on + pick → off (no save) → on (picker still shows selected type). | none | keep | Draft-state buffer preservation is a React component concern. |
| 19 | (f) amount empty rejection: inline hint + Save disabled | Empty amount → hint + Save disabled. | validation.test.ts:269-278 | **delete** | Validation logic identical to unit test. |
| 20 | (g) amount zero rejection: inline hint + Save disabled | Amount $0 → hint + Save disabled. | validation.test.ts:269-278 | **delete** | Validation rejection + message identical. |
| 21 | (h) amount over $50 rejection: cap hint + Save disabled | Amount $60 → "Supply can't exceed $50" hint + Save disabled. | validation.test.ts:280-289 | **delete** | Validation + cap-exceeded message unit-tested. |
| 22 | (i) supply type unpicked rejection: inline hint + Save disabled | No supply type picked → hint + Save disabled. | none | keep | Picker required-field validation is component-level. |
| 23 | (l) combined chips: card-custom first, supply second | Two chips render in order: card-custom $4.50, supply $7. | deductions.test.ts:90-102 | **move-to-unit** | Chip order is visual/DOM; combined deduction data is what matters. |
| 24 | (m) exempt + supply: only the supply chip renders | Mode=exempt + supply on → only supply chip; no "No fees"; no card-fee chip. | deductions.test.ts:62-74 | **move-to-unit** | Mode + supply combo is in computeNetToTechCents. |
| 25 | (n) exempt without supply: muted No fees chip | Mode=exempt + supply off → "No fees" chip (muted). | implicit in mode=exempt | keep | "No fees" chip + muting is product design choice. |
| 26 | (a) classic case: $50 + default + $5 supply → $42 with three breakdown lines | Price $50 - $3 fee - $5 supply → net $42; three breakdown lines. | deductions.test.ts:48-60 | **delete** | Exact math + line mapping redundant with unit test. |
| 27 | (b) live price keystroke → preview recomputes within ~200ms | Keystroke $50→$60 updates preview $42→$52 within 200ms. | deductions.test.ts | keep | Live-preview timing + keystroke wiring require browser event loop. |
| 28 | (c) switch to exempt → preview becomes $55, card-fee breakdown line drops | Mode default→exempt → preview $55; card-fee line gone. | deductions.test.ts:62-74 | **move-to-unit** | Mode switch + line filtering is derivable logic. |
| 29 | (d) toggle supply off → preview becomes $60, supply breakdown line drops | Toggle supply off → preview $60; supply line gone. | deductions.test.ts:76-88 | **move-to-unit** | Toggle + line removal is in computeNetToTechCents. |
| 30 | (e) variable-price service: preview uses price_from (not the empty fixed price) per FR-026 | Variable-price toggle on; price_from=$30 → preview $30 - $3 = $27. | deductions.test.ts:47-59 | keep | Form logic (variable flag → which price) requires browser + server-action boundary. |
| 31 | (f) negative net clamps to $0; raw breakdown lines remain visible | Price $0 - $3 - $5 = -$8 → clamps to $0; all 3 lines visible. | deductions.test.ts:104-116 | **delete** | Clamping identical to unit test. |
| 32 | (a) technician sees deduction chips on every row (read works) | Technician role reads; rows render with card-fee chips. | none | keep | Role-based read + data hydration requires e2e auth + RSC. |
| 33 | (b) technician sees disabled deduction controls with role-gate tooltip | Tech: aria-disabled on segmented control + options + toggle; View only chip; tooltip text. | none | keep | Aria-disabled + role-gate tooltip + View-only chip are accessibility contracts. |
| 34 | (c) technician sees the net-to-tech preview (read-only by design) | Tech can read preview; $25 - $3 = $22; breakdown shows service + card-fee. | deductions.test.ts:48-60 | keep | Preview rendering for read-only actors requires browser. |
| 35 | (d) manager has full interactivity (no aria-disabled, controls write) | Manager: no aria-disabled; Save rendered; archive visible. | none | keep | Manager interactivity + button visibility are browser-level. |
| 36 | (e) manager flipping supply on writes a service.updated audit row with the four deduction keys diffed | Manager toggles supply on; audit row with supply_amount_cents + supply_type_id; before/after snapshots include all four deduction fields. | permissions.test.ts:13-23 + audit shape (server-action logic) | **move-to-unit** | Audit diff generation should unit-test against mock audit-write. |
| 37 | (f) deduction-only edit produces a minimal diff (only the changed key) | Manager changes only supply $5→$7.50; audit diff contains ONLY supply_amount_cents (FR-030). | implicit in server-action diff | **move-to-unit** | Audit diff selectivity is server-action concern. |
| 38 | (g) non-deduction edit produces no spurious deduction diff | Manager changes only price $25→$60; audit diff contains ONLY price_cents. | implicit in diff | **move-to-unit** | Diff selectivity is server-action logic. |

**Summary.** The biggest LOC payoff in the entire audit. 58% of these
tests re-assert deduction math, validation hints, and audit-diff shape
that `deductions.test.ts` (12 cases) and `validation.test.ts` (20+
cases) already exhaustively cover. The 9 keeps are real browser
contracts: two-pane layout shape, panel mode transitions, discard
guards, toast redirects, live-preview keystroke timing, role-gating
aria/View-only chips. **Recommended PR scope:** migrate the 7 deletes
+ 22 moves; cuts ~11 minutes of parallel e2e run and removes a major
flakiness vector (browser timing on validation hints).

---

## `staff.spec.ts` — 27 tests

**Verdict: keep 15, move 9, delete 3.** Permission-matrix tests are
fully unit-covered; toast-bridge tests should stay e2e.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | US1(a) owner reaches /settings/staff and sees fixture trio in role-priority order | Roster renders with ≥6 rows, chip counts, empty-state panel. | sort.test.ts:87-103; filter.test.ts:34-46 | keep | RSC rendering chain, row layout, chip DOM presence are browser-only. |
| 2 | US1(b) search narrows roster to single matching row | Search input narrows rows to exact match. | filter.test.ts:49-119 | **move-to-unit** | filterStaff already unit-tested; browser adds no new assertion. |
| 3 | US1(c) empty search-result shows "No staff match your search." | No-result row displays static copy. | none | **delete** | Copy-only assertion; trivial. |
| 4 | US1(d) Filter chips reveal inactive row when present | Inactive chip toggles visibility, All/Active/Inactive counts update. | filter.test.ts:34-46; sort.test.ts | keep | Filter-chip state ↔ table visibility bridge + chip count recalculation are browser-only. |
| 5 | US2(a) wizard happy path: add worker-scoped staff with PIN, audit + row + toast URL | Multi-step wizard: name → PIN → confirm → redirect + audit (no raw PIN). | permissions.test.ts:52-65; audit.test.ts:56-73 | keep | Wizard choreography (sheet, keypad, auto-advance) is browser-only. |
| 6 | US2(b) PIN mismatch resets buffer and shows error | Mismatch returns to enter phase, no audit row. | none | **move-to-unit** | PIN buffer/error logic is testable via component render. |
| 7 | US3(a) selecting a row opens edit panel and toggles ?selected= URL | Link href + Enter navigates + panel mounts + re-click toggles back. | none | keep | URL-state sync via Next.js Link requires RSC streaming. |
| 8 | US3(b) header preview updates live but table row keeps old values until Save | Name input updates preview immediately; row retains old until Save. | none | **move-to-unit** | Client React state testable via @testing-library/react. |
| 9 | US3(c) Save enables only when draft differs AND name length ≥2 | Save disabled on load / 1-char; enabled on valid diff; disabled when reverted. | none | **move-to-unit** | Pure two-boolean logic is trivial to unit-test. |
| 10 | US3(d) Save persists change, toast URL, table reflects new name, audit row with diff-aware payload | Full save → redirect → re-render → audit row with changes=['display_name']. | audit-diff.test.ts:47-114; audit.test.ts | keep | Full POST → audit → redirect → re-render cycle requires server-action integration. |
| 11 | US3(e) switching rows mid-edit silently discards drafts | Switch via ?selected=, draft discarded, panel re-keys. | none | **move-to-unit** | Panel re-keying via key prop change is component-level. |
| 12 | US4(a) change PIN for fixture tech: confirm dialog copy, badge flip, audit row with previous_pin_set: true | Modal dual-phase flow, redirect, audit payload {previous_pin_set:true}, no raw PIN. | audit.test.ts:56-73; permissions.test.ts:69-82 | keep | Modal lifecycle + POST sequence are browser-only. |
| 13 | US4(b) set PIN for fresh staff (null pin_hash): audit with previous_pin_set: false | Fresh staff inserted; button is "Set PIN"; audit {previous_pin_set:false}. | audit.test.ts:56-73 | keep | "set" vs. "change" mode branching depends on server-rendered data. |
| 14 | US4(c) PIN mismatch resets buffers, returns to enter phase, writes no audit row | Mismatch → error → phase="enter"; URL unchanged. | none | **move-to-unit** | PIN keypad state machine is pure component logic. |
| 15 | US5(a) deactivate tech: confirm dialog copy, badge flip, audit row, reactivate restores | Full lifecycle: deactivate dialog → submit → reactivate (no dialog) → audit rows. | permissions.test.ts:214-230; last_owner_trigger.test.ts:83-137 | keep | Dialog state + button toggle + sequential redirects require browser/server flow. |
| 16 | US5(b) remove tech: confirm dialog copy, row gone, panel returns to empty state, audit snapshots | Remove dialog → submit → row vanishes → panel empty-state; audit snapshots name + role. | audit.test.ts:56-73 | keep | Dialog variant switching + row removal + panel re-render are browser/server only. |
| 17 | US5(c) cancel inside deactivate dialog closes it with no mutation | Dialog opens, Cancel closes, URL unchanged, no audit, row still active. | permissions.test.ts | **move-to-unit** | Dialog cancel is pure component state. |
| 18 | US6(a) technician PIN session → /settings/staff redirects to /dashboard with no flash | Tech navigates to /settings/staff → layout gate redirects to /dashboard. | permissions.test.ts:52-65 | **move-to-unit** | Route-level layout gate is testable via Server Component render. |
| 19 | US6(b) manager opens fixture owner's row → all controls disabled, banner visible | Manager on owner row: banner + all controls disabled. | permissions.test.ts:85-103, 346-360 | **delete** | Permission matrix exhaustively unit-tested; e2e re-validates same gate. |
| 20 | US6(c) manager bypass POST against fixture owner → forbidden_target + zero audit rows | Manager strips disabled attrs in DOM, submits, server rejects, no audit. | permissions.test.ts:85-103; audit.test.ts | **delete** | Server-side rejection + audit-skip thoroughly unit-tested. |
| 21 | US7(a) ?toast=staff_added&name=… fires success toast and clears params | Toast visible with name; params cleared. | none | keep | Toast-bridge lifecycle (param detect → Sonner → URL cleanup) is browser-only. |
| 22 | US7(b) ?toast=changes_saved fires "Changes saved" | Toast visible; params cleared. | none | keep | Same toast-bridge pattern. |
| 23 | US7(c) ?toast=pin_updated fires "PIN updated" | Toast visible; params cleared. | none | keep | Same toast-bridge pattern. |
| 24 | US7(d) ?toast=staff_deactivated&name=… fires "{name} deactivated" | Toast visible; params cleared. | none | keep | Same toast-bridge pattern. |
| 25 | US7(e) ?toast=staff_removed&name=… fires "{name} removed" | Toast visible; params cleared. | none | keep | Same toast-bridge pattern. |
| 26 | US7(f) ?error=forbidden_target fires destructive toast | Error variant (destructive styling) renders. | none | keep | Error-variant Sonner integration is browser-only. |
| 27 | US7(g) two rapid toasts: only one visible at a time (no stacking) | Sonner expand=false stacking behavior. | none | keep | Library integration behavior. |

**Summary.** The permission matrix (`permissions.test.ts`) and audit
diff (`audit-diff.test.ts`) are exhaustively unit-tested, making US6
e2e tests pure redundancy. The toast-bridge family (US7, 7 tests) is
genuinely browser-only because it exercises Sonner integration + URL
param cleanup. Wizard choreography (US2, US4) stays e2e for the same
reason. Net: 12 tests can leave the spec, the remaining 15 are
load-bearing.

---

## `supply-types-catalog.spec.ts` — 22 tests

**Verdict: keep 10, move 8, delete 4.** Server-action-heavy feature
with duplicate client+server validation paths.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | (a) picker is pre-populated with the migrated type for a backfilled service | Picker trigger shows migrated name; FK in hidden input; migration audit row exists with source=migration:022. | policy/canonicalize-name.test.ts | keep | Migration audit row is part of 0017_supply_types_catalog.sql contract. |
| 2 | (b) inline-create commits a new type and pre-selects it | Inline-create saves; picker updates; hidden input updated; one supply_type.created audit row. | policy/validation.test.ts:15-47 | **move-to-unit** | Validation + creation logic are server-side; e2e wraps server action in UI. |
| 3 | (c) typing a colliding name shows the 'select existing' soft hint | Inline-create morphs to "Select existing" on collision; click selects without server call. | policy/canonicalize-name.test.ts:10-30 | **delete** | Pure client-side `useMemo` over `canonicalizeName`; same logic unit-tested. |
| 4 | (a) services sharing a canonical seed label resolve to the same supply_type_id | Two variant-cased services resolve to same supply_type_id. | policy/canonicalize-name.test.ts:10-30 + DB partial index | keep | DB-index dedup behavior beyond what unit tests cover. |
| 5 | (b) supply_types contains exactly one row per distinct canonicalized seed name | Distinct canonical names = expected count. | policy/canonicalize-name.test.ts:10-30 | keep | Post-migration invariant verifying DB index enforced dedup. |
| 6 | (c) every service marked supply-on in the manifest has a non-null supply_type_id | All supply-on services carry non-null supply_type_id + supply_amount_cents. | none | keep | Migration postcondition; pure DB state check. |
| 7 | (d) the picker on a migrated service shows the canonicalized name from the catalog | Picker displays canonicalized name from LEFT JOIN. | none | keep | RSC projection test (the loader resolves names). |
| 8 | (e) audit_log contains one migration:022 supply_type.created row per seeded type | Exactly one audit row per seeded type with source=migration:022. | none | keep | Migration audit trail verification. |
| 9 | (a) renaming via inline edit propagates to both referencing services' pickers | Rename triggers redirect; both pickers update; DB unchanged except name. | policy/validation.test.ts:15-47 + actions.ts:164-230 | **move-to-unit** | Validation + no-change check + audit emission are server-side. |
| 10 | (b) empty rename surfaces hint and restores the prior name | Submit blocked client-side when input <2 chars; Escape cancels. | policy/validation.test.ts:27-37 | **delete** | Client-side UX validation + server-side validator both unit-covered. |
| 11 | (c) colliding rename surfaces a soft hint and blocks submit | Typing existing name shows hint; Enter blocked; Escape cancels. | policy/canonicalize-name.test.ts:10-30 | **delete** | Client-side `canonicalizeName` collision check unit-covered. |
| 12 | (d) successful rename writes exactly one supply_type.renamed audit row | One audit row per rename with before/after payload. | none | **move-to-unit** | Audit emission in actions.ts:220-226 testable as server-action unit test. |
| 13 | (a) archive button is disabled with a count-aware tooltip when usage > 0 | aria-disabled=true; hover shows count-aware tooltip. | none | keep | Usage count + tooltip copy require full RSC + Tooltip component. |
| 14 | (b) after the last reference is removed, archive succeeds and the row moves to Archived | Remove reference → archive enables → redirect → row moves; archived=true in DB. | services/permissions.test.ts:25-42 + actions.ts:234-303 | **move-to-unit** | Permission + usage-count check + archived flag toggle are server-side. |
| 15 | (c) archived types are excluded from the picker on new edits | Picker omits archived types. | services/_load.ts (loader filter) | keep | RSC loader filter requires full page navigation. |
| 16 | (d) reactivate restores the archived type to active | Reactivate → row moves back to active; archived=false in DB. | none | **move-to-unit** | actions.ts:307-367 is server-side; UI move is just RSC re-render. |
| 17 | (e) successful archive writes exactly one supply_type.archived audit row | One audit row per archive with name in payload. | none | **move-to-unit** | actions.ts:291-297 audit emission is pure server logic. |
| 18 | (f) successful reactivate writes exactly one supply_type.reactivated audit row | One audit row per reactivate with name in payload. | none | **move-to-unit** | actions.ts:355-361 audit emission is pure server logic. |
| 19 | (a) row shows 'N services' badge for 2-service type and 'Unused' for 0-service type | Usage badge displays "2 services" / "Unused". | (formatUsageBadgeCopy is in client component) | keep | Badge copy requires RSC data + component render. |
| 20 | (b) expanding a populated row reveals one sub-row per referencing service | Sub-rows in sort order with name + −$X.XX in tabular numerals. | none | keep | Sub-row rendering with RSC projection is browser-only. |
| 21 | (c) clicking a sub-row closes the sheet and navigates to ?selected=<service-id> | Sub-row click closes sheet, navigates to service, picker shows type name. | none | keep | Sheet closure + cross-page nav coordination. |
| 22 | (d) usage_count reflects DB state on each sheet open | First open "2 services"; detach + reload; reopen "1 service". | none | keep | Tests revalidatePath trigger + cache invalidation. |

**Summary.** Classic e2e/unit overlap in a server-action-heavy feature.
Permission checks, validation, and audit emission for rename/archive/
reactivate are all testable as pure server-side unit tests via mocked
service-role queries — yet the spec wraps each one in a full browser
login → form submission → redirect cycle. Client-side collision
detection (picker + rename form) is tested twice: once via
`canonicalizeName` unit test, again via e2e UI. Migration assertions
(tests 1, 4-8) and sub-row navigation (tests 19-22) genuinely need
browser/RSC verification.

---

## `staff-payout-exemptions.spec.ts` — 21 tests

**Verdict: keep 6, move 4, delete 11.** Highest deletion ratio
(52%) — `summary.test.ts` covers every summary variant verbatim.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | (a) toggling Card processing fee off saves, flips subtitle, shows toast + badge, writes audit row | Toggle saves; subtitle changes; toast fires; badge appears; audit row with card_fee_exempt diff. | permissions.test.ts:287-328; audit-diff.test.ts:52-58; audit.test.ts:56-73 | keep | RSC re-fetch + real toast + live badge + multi-step transitions need browser. |
| 2 | (b) reloading after save preserves the off state | Toggle persists across reload; subtitle + badge still visible. | (validation + audit-diff + permissions cover the logic) | **move-to-unit** | Pure persistence read-back; DB contract check, not browser flow. |
| 3 | (a) default is Apply all with the documented subtitle | Default mode="apply"; subtitle matches spec. | validation-supply-mode.test.ts:13-34 | **move-to-unit** | Deterministic default state factory. |
| 4 | (b) selecting Some reveals picker with usage hints, alphabetized | Mode toggle to "partial"; 3 rows alphabetically with usage hints. | none | keep | Real DOM rendering + alphabetical sort in output + usage-hint calc against Supabase query. |
| 5 | (c) ticking type + saving persists; reload confirms tick survives | Select "Some"; tick Chrome powder; save; reload; tick visible; DB has supply_mode="partial". | validation-supply-except.test.ts:29-34, 48-55; audit-diff.test.ts:78-89 | **move-to-unit** | Pure read-back contract. |
| 6 | (d) selecting Exempt + saving hides picker and clears supply_except | Mode="exempt"; picker hides; save clears array. | validation-supply-mode.test.ts; audit-diff.test.ts:47-51 | **move-to-unit** | Pure validation + clear behavior. |
| 7 | (e) draft preservation: Some -> Apply all -> Some restores ticks | Toggle without saving; ticks dropped on "Apply"; restored on switch back to "Some". | none | keep | Client-side draft state across mode toggling; React component state. |
| 8 | (f) archived UX: archived type renders with Archived pill, still tickable | Archived type appears with pill; checkbox still tickable. | none | keep | UI conditional rendering for archived types is browser-only. |
| 9 | (g) save with both supply_mode + supply_except writes one audit row with both keys + raw uuid array | Audit row has both keys; raw uuid array in payload.after. | audit-diff.test.ts:91-109; audit.test.ts:56-73; validation-supply-except.test.ts | **move-to-unit** | buildChanges shape testable in unit. |
| 10 | (h) empty catalog: selecting Some shows empty-state copy with /services link | Click "Some"; empty state with /services link. | none | keep | Real DOM empty state + link href verification. |
| 11 | (i) FR-012 stale-tab defensive: unknown supply_except ids silently dropped server-side | Stale uuid in form → server drops + saves only valid id. | validation-supply-except.test.ts:48-55 | **delete** | Validator covers stale-tab defense contract; no browser-only behavior. |
| 12 | (a) no exemption + apply mode → no summary rendered | Default posture; no summary in DOM. | summary.test.ts:13-22 | **delete** | Direct null-case unit test. |
| 13 | (b) cardExempt + apply → 'Sam keeps the full payout on card-paid services…' | Card-exempt only summary text. | summary.test.ts:24-32 | **delete** | Exact variant unit-tested. |
| 14 | (c) supplyMode=exempt → 'Sam keeps the full payout on every service…' | Supply-exempt only summary text. | summary.test.ts:35-43 | **delete** | Exact variant unit-tested. |
| 15 | (d) cardExempt + exempt → both deductions copy | Card+supply exempt summary text. | summary.test.ts:46-54 | **delete** | Exact variant unit-tested. |
| 16 | (e) partial + [Chrome powder] → 'Sam keeps the full payout on every service and is exempted from chrome-powder…' | Partial mode summary text with 1 type slug. | summary.test.ts:57-68 | **delete** | Exact variant unit-tested. |
| 17 | (f) cardExempt + partial + [Chrome powder, GelX] → 'card-paid + chrome-powder and gelx-tips-gel…' | Combined card+partial summary with 2 type slugs. | summary.test.ts:70-81 | **delete** | Exact variant unit-tested. |
| 18 | (g) front-desk role + no exemption → renders hint instead of summary | Front-desk role; hint text renders; no summary. | summary.test.ts:84-89 | **delete** | formatFrontDeskHint covers hint text. |
| 19 | (h) non-front-desk role + no exemption → neither summary nor hint | Technician, no exemptions; neither element in DOM. | summary.test.ts:13-22 (null) | **delete** | Null case unit-tested. |
| 20 | (i) live badge update: badge appears immediately on toggle; reload clears it (FR-016) | Toggle (no save) → badge appears immediately; reload → badge gone. | none | keep | Real-time client draft state reflection; interaction + reload cycle. |
| 21 | (j) Active/Inactive chip always renders in panel header | Active chip visible in header. | none | **delete** | Trivial rendering check; better as component snapshot. |

**Summary.** The single biggest deletion opportunity in the audit. 7
summary-variant tests (12-18) plus the FR-012 stale-tab defense (11)
duplicate `summary.test.ts` and the supply-except validator verbatim.
4 more reload/persistence/audit-shape tests are clean
move-to-unit. Only 6 tests exercise genuine browser concerns: real
toast wiring, picker pagination, draft preservation, archived-UX
rendering, empty catalog state, and live badge reflection. **This is
the most attractive first pruning PR** — lowest risk, biggest
runtime-per-LOC reduction.

---

## `services.spec.ts` — 22 tests (9 active, 13 skipped/deferred)

**Verdict: keep 15, move 5, delete 0.** Most justified spec in the audit.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | US1(a) owner sees seeded catalog grouped by category | 5 active rows; alphabetical groups; rows sorted within group; duration/price pills. | sort.test.ts:35-80; format.test.ts:33-131 | keep | Browser DOM rendering + grouped list assembly + RSC streaming. |
| 2 | US1(b) search 'mani' narrows the catalog to manicure rows | Substring search reduces rows; empty groups stripped. | none | keep | Search filtering + grouping render combination is interactive. |
| 3 | US1(c) no-match search shows 'No services match your search.' | Empty result state + groups hidden. | none | keep | Conditional empty-state branch. |
| 4 | US1(d) Show-archived toggle reveals the archived seed row when on | Toggle switches view; archived row carries data-archived; toggle off hides. | none | keep | sessionStorage state + conditional visibility. |
| 5 | US1(e) clicking a row updates ?selected= in the URL | Row click via Enter on Link updates URL; data-selected="true". | none | keep | URL routing + Link navigation semantics are RSC-specific. |
| 6 | US1 empty-state renders the Sparkles empty-state when the catalog is empty | Empty catalog; "0 active · 0 total"; Sparkles icon + text. | none | keep | Full-page empty state + icon rendering. |
| 7 | US2(a) Add service → drawer flips to Edit, toast + row appear | Add → form → flip to Edit; new row; URL gains ?selected + toast + name. | permissions.test.ts:13-22; validation.test.ts:23-178 | **move-to-unit** | Validators already unit-tested; flip + redirect can move to action unit test. |
| 8 | US2(b) Add service with zero techs → secondary no_techs_assigned param fires | **SKIPPED** — staff-assignment UI deferred. | N/A | N/A | Disabled pending feature. |
| 9 | US3(a) clicking Spa pedicure hydrates the drawer with Sam @ 75-min override pre-filled | **SKIPPED** — staff-assignment UI deferred. | N/A | N/A | Disabled pending feature. |
| 10 | US3(b) edit Classic pedicure: change price + untick Sam + add a 50-min override for Jordan → save | **SKIPPED** — staff-assignment UI deferred. | N/A | N/A | Disabled pending feature. |
| 11 | US3(c) DB reflects the staff_services diff and audit_log has a service.updated row | **SKIPPED** — staff-assignment UI deferred. | N/A | N/A | Disabled pending feature. |
| 12 | US4(a) archive Gel polish → dialog, row removal, toast, bottom action flips to Restore | Archive dialog → confirm → row gone → reappears with archived filter; button flips. | none | keep | Multi-step dialog + conditional UI state machine. |
| 13 | US4(b) restore Gel polish → row returns to the default view, toast fires, bottom action flips back to Archive | Restore → row returns; button flips. | none | keep | UI state machine for drawer button visibility. |
| 14 | US5(a) Add a variable-price service with no bounds → 'Variable' pill, DB price_cents = 0 | Variable toggle switches form layout; no bounds → variable_price=true, price_cents=0; pill "Variable". | format.test.ts:49-61; validation.test.ts:105-128 | **move-to-unit** | Variable UI toggle + bounds validation unit-tested. |
| 15 | US5(b) Set From $20 only → 'From $20' pill; then To $60 → '$20 – $60' pill | Bounds set; pills update. | format.test.ts:63-75, 92-103 | **move-to-unit** | Price range formatting fully unit-covered. |
| 16 | US5(c) Set To < From → inline bounds error + Save disabled | Inverted bounds → inline error; Save disabled; fix re-enables. | validation.test.ts:130-150 | **move-to-unit** | bounds_inverted unit-tested. |
| 17 | US5(d) Toggle Variable off → fields clear, fixed price re-appears, DB nullifies variable-only columns | Toggle off → fields disappear; fixed price reappears; DB row variable_price=false with all bounds null. | validation.test.ts | **move-to-unit** | Form toggle + DB constraint testable in server-action unit test. |
| 18 | US6(a) technician sees the catalog read-only with disabled Add button and tooltip | Catalog visible; Add button aria-disabled; keyboard focus reveals tooltip. | permissions.test.ts:13-22 | keep | Keyboard-focus tooltip + disabled button rendering. |
| 19 | US6(b) clicking a row opens the drawer in read-only mode (every control disabled, View only chip) | Drawer opens in Edit; every input/toggle/swatch disabled; Save replaced with "View only" chip. | permissions.test.ts:13-22 | keep | Cascading disabled state across multiple control types. |
| 20 | US7(a) add → edit → archive → restore each fires exactly one toast with documented copy | One toast per action with correct copy; URL params stripped. | none | keep | Toast lifecycle + URL-state bridging. |
| 21 | US7(b) two mutations back-to-back: the second toast replaces the first | Sonner stacking behavior — first dismissed before second renders. | none | keep | Library-specific timing behavior. |
| 22 | US7(c) add with zero techs → success + secondary warning both render | **SKIPPED** — staff-assignment UI deferred. | N/A | N/A | Disabled pending feature. |

**Summary.** Best-factored spec in the audit. The validation logic is
correctly unit-tested in `validation.test.ts` and `format.test.ts`,
and the e2e tests focus on browser-specific behaviors: drawer state
machines, URL `?selected` + `?toast` routing, Sonner toast lifecycle,
keyboard navigation, disabled-state cascading. The 5 moves are gray
zone — underlying validation is unit-tested but the form-submission
glue could be extracted. Zero deletes. **Skip in the pruning sequence
unless e2e runtime is still a problem after the bigger wins land.**

---

## `onboarding.spec.ts` — 17 tests

**Verdict: keep 7, move 4, delete 6.** Heavy server-action unit
coverage already exists; e2e is over-validating.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | owner sees the hero, three sections, and owners-only notice | Onboarding heading + 3 section headings + owners-only notice + onboard CTA. | none | keep | UI layout + access control gate are RSC behavior. |
| 2 | manager is redirected to /settings/staff | Non-owner manager → /settings/staff. | actions-invite-quick.test.ts:278-282 | **delete** | Permission gate unit-tested; middleware handles redirect. |
| 3 | owner opens hero CTA, sends magic-link invite, sees toast + new pending row, audit recorded | Quick invite happy path: sheet → form → submit → toast → pending row → audit. | actions-invite-quick.test.ts:70-120, 185-200, 240-280 | **delete** | Happy path fully covered by unit test. |
| 4 | (a) magic-link via Thorough: 4-step wizard reaches the same end state as US1 Quick | 4-step wizard completes magic-link invite with same audit state. | actions-invite-thorough.test.ts:70-120, 220-280 | **move-to-unit** | Final audit payload is logic-testable; wizard state machine should unit-test. |
| 5 | (b) password-setup via Thorough: audit method='password', invite email landable on /reset-password | Thorough password path: invite → /reset-password → password + PIN → /dashboard. | actions-invite-thorough.test.ts:150-200, 280-320 | **move-to-unit** | Server-action branches; /reset-password is Supabase auth contract. |
| 6 | first PIN ≠ confirm PIN → error copy renders, both entries clear, can complete with matching PINs | PIN mismatch error + dot reset + resubmit succeeds. | none | keep | InlinePin component state + re-entry pattern lives in UI. |
| 7 | offboards the fixture manager with reason 'Performance' → row moves, audit logged, sign-in fails within 5s, picker omits him | Offboard reason → confirm → row moves + audit + sign-in fails + picker omits. | actions-offboard.test.ts:100-180, 200-240 | keep | Multi-step offboard + sign-out + cross-session sign-in failure requires e2e auth integration. |
| 8 | self-row: the fixture owner opens their own row menu → sees 'You can't offboard yourself' line, no destructive item | Self-offboard guard text + no Offboard menuitem. | none | keep | Permission guard + menu conditional rendering. |
| 9 | owner resets Sam's PIN → notice appears at /select-staff → successful PIN clears notice + clears pin_reset_admin_at | Reset PIN → notice on /select-staff → correct PIN → notice cleared + pin_reset_admin_at cleared. | actions-reset-pin.test.ts:100-140, 200-220 | keep | Notice lifecycle across two pages + state-clearing requires multi-session state sync. |
| 10 | owner sends password reset → toast confirms, audit logged, Inbucket receives recovery email | Password reset from active row → toast → audit device.password_reset → Inbucket email. | none | **move-to-unit** | Should have actions-send-password-reset.test.ts covering resetPasswordForEmail + audit. |
| 11 | opens sheet, validates three gates, removes fixture manager permanently, frees email for re-invite, audit logged | Hard remove: 3 acks + button state machine + row anonymized + email freed + audit. | actions-remove.test.ts:100-200, 300-350, 380-420 | **delete** | Three-gate validation + anonymization + audit fully unit-tested. |
| 12 | Resend: inline icon rotates the token + new email arrives + toast | Resend icon → new token via generateLink + new email + toast. | actions-resend.test.ts:100-150, 200-250 | **move-to-unit** | Token rotation + audit dispatch are server-action logic. |
| 13 | Copy invite link: menu item writes URL to clipboard | Copy-link icon writes magic-link URL to clipboard. | none | keep | Clipboard API + browser permissions. |
| 14 | Cancel: row disappears, audit recorded with snapshot email, email is freed for re-invite | Cancel → row removed + audit + email freed for re-invite. | actions-cancel.test.ts:100-160, 220-260, 310-340 | **delete** | Happy path + audit + email-freeing all unit-tested. |
| 15 | owner reactivates the fixture manager → row moves to Pending → audit + fresh email + staff.id preserved | Reactivate → row moves + fresh link + audit + staff.id preserved. | actions-reactivate.test.ts:100-150, 200-240, 300-330 | **delete** | staff.id preservation + audit payload unit-tested. |
| 16 | typing filters rows, hides empty sections, clearing restores; ?q= URL-sync; empty Offboarded without ?q= shows placeholder | Search ILIKE filter + empty section hiding + URL ?q= sync + empty bucket placeholder. | none | keep | URL-synced search + conditional section rendering require full page nav. |
| 17 | Sub-case 2: without ?q= and an empty Offboarded bucket, the section header IS visible with the empty-row placeholder | Empty bucket + no filter → section header + empty placeholder both visible. | none | keep | Conditional empty-state placeholder based on bucket state. |

**Summary.** ~3500 lines of unit tests exist covering the 7 server
actions (invite-quick, invite-thorough, offboard, remove, reset-pin,
send-password-reset, resend, cancel, reactivate), making 6 e2e tests
pure duplicates. E2e legitimately holds: layout (1, 8), PIN
mismatch UI (6), multi-session offboard sign-in failure (7), PIN-reset
notice lifecycle (9), clipboard (13), and URL-synced search (16, 17).
Tests 4, 5, 10, 12 should be unit-tested at the action layer — the
wizard variant and send-password-reset action both lack dedicated unit
files today.

---

## `dashboard.spec.ts` — 4 tests (spot-check)

**Verdict: keep 1, move 1, delete 2.** The 1243 LOC isn't bloat —
it's load-bearing parallel-safe fixture infrastructure.

| # | Test name | What it asserts | Unit coverage? | Recommendation | Rationale |
|---|-----------|------------------|----------------|----------------|-----------|
| 1 | (a) live tile values, payment-mix legend, subtitle, no comparison badges, no techs tile, no client column, one Split pill | 5 paid tickets render with correct aggregates; payment-mix legend; formatted subtitle; feed rows; Split pill. | dashboard/queries.test.ts:142-246; dashboard/aggregate.test.ts:28-82; dashboard/format.test.ts | **delete** | Feed ordering + split-tender detection + formatting are unit-covered. |
| 2 | (b) empty-state path | 0 tiles when no paid tickets today; neutral payment-mix; empty feed copy; collapsed subtitle. | dashboard/aggregate.test.ts:20-26; dashboard/format.test.ts:65-72 | **delete** | Empty-state aggregation + neutral payment-mix unit-covered. |
| 3 | (a) toggling Today / Week / Month re-renders tiles from in-window tickets only | Period toggle re-renders tiles; negative controls never contribute; no audit writes. | time/period-windows.test.ts; dashboard/queries.test.ts:92-138 | **move-to-unit** | Period window math + boundary-respecting queries unit-tested. |
| 4 | (a–f) 15 rows in closed_at desc order, inner scroll, no page horizontal scroll, feed pinned to today, no audit writes | 15 rows desc-ordered; container scrolls internally; no page horizontal overflow; feed pinned to today across period toggle. | none | keep | Inner-scroll layout + "feed always today" invariant are RSC + layout contracts. |

**Summary.** The file is 1243 LOC for 4 tests because of heavy per-test
setup: TZ-aware fixture helpers (`laTodayMidnightUtcMs`, DST handling),
calendar-math seed builders, and cross-test coordination (audit cursors
+ ticket-state locks for parallel safety). The **infrastructure is
load-bearing** and should not be refactored away. The **assertions**,
however, mostly duplicate `tests/unit/dashboard/` and `tests/unit/time/`.
Net: shrink to 1 test, but preserve the fixture helpers as a shared
module others can import.

---

## Suggested PR sequence

Ordered by impact-per-risk (highest first). Numbers in parens =
`(deletes / moves / kept) of total`.

| # | PR | Surface | Tests removed | Risk | Why |
|---|---|---|---|---|---|
| 1 | `chore/prune-e2e-staff-payout-exemptions` | `staff-payout-exemptions.spec.ts` (11/4/6 of 21) | 15 leave e2e | **Low** | 7 deletes are direct duplicates of `summary.test.ts` with exact-text matches; zero new unit tests needed (validators + summary helpers already cover). Easiest, biggest deletion ratio. |
| 2 | `chore/prune-e2e-services-deductions` | `services-deductions.spec.ts` (7/22/9 of 38) | 29 leave e2e | **Medium** | Largest absolute LOC payoff (1816 LOC, ~11min runtime savings parallel). Requires backfilling some unit tests for audit-diff selectivity (tests 36-38) and chip ordering (23), but `deductions.test.ts` already covers 80% of the moves. |
| 3 | `chore/prune-e2e-onboarding` | `onboarding.spec.ts` (6/4/7 of 17) | 10 leave e2e | **Low** | 6 deletes are clean duplicates of `actions-invite-quick`, `actions-remove`, `actions-cancel`, `actions-reactivate` unit tests. Moves require 2 new unit files (`actions-send-password-reset.test.ts`, `actions-invite-thorough.test.ts` for password path). |
| 4 | `chore/prune-e2e-supply-types-catalog` | `supply-types-catalog.spec.ts` (4/8/10 of 22) | 12 leave e2e | **Medium** | 4 deletes are pure client-side collision checks already covered by `canonicalize-name.test.ts`. 8 moves need new unit tests against `app/(studio)/settings/policy/actions.ts` for rename/archive/reactivate. |
| 5 | `chore/prune-e2e-staff` | `staff.spec.ts` (3/9/15 of 27) | 12 leave e2e | **Low-medium** | US6(b/c) deletes are pure permission-matrix duplicates of `permissions.test.ts`. 9 moves are mostly PIN keypad state machine + form button logic — straightforward component tests with `@testing-library/react`. |
| 6 | `chore/refactor-dashboard-fixtures` | `dashboard.spec.ts` (2/1/1 of 4) | 3 leave e2e | **Medium-high** | Smallest count but trickiest. The TZ/DST fixture helpers are load-bearing; preserve them in a shared module before deleting the tests that exercise them. Otherwise deletes are clean (queries/aggregate/format units already cover). |
| 7 | `chore/prune-e2e-services` | `services.spec.ts` (0/5/15 of 22) | 5 leave e2e | **Medium** | Smallest payoff — no deletes, just moves. Defer until 1-6 land and the suite still needs to shrink. Several tests are already skipped pending staff-assignment UI. |
| 8 | (skip) | `auth.spec.ts` | 2 of 43 | n/a | Negligible payoff; rolling into another PR is more churn than benefit. |

**Total potential reduction across PRs 1-7:** 86 tests leave the e2e
suite (34 deleted outright, 53 migrated to Vitest). That's **~45% of
the audited tests** (~30% of the full 289-test suite).

**Estimated runtime impact:** `staff-payout-exemptions`,
`services-deductions`, and `onboarding` together account for ~5800
LOC and (rough estimate from full-suite local runs) ~12-15 min of
parallel e2e wall time. PRs 1-3 alone should cut that by 60-70%.

**Risk-mitigation rule:** every PR in the sequence must land its
backfilled unit tests **before** deleting/migrating the e2e ones, so
coverage never dips. The unit-test backfills are small (typically
add 1-3 cases to existing `*.test.ts` files), with the exception of
two new files needed in PR #3.
