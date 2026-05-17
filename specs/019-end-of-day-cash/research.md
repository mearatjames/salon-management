# Phase 0 — Research: End of Day Cash Count

All clarifications from `spec.md` (Q1/Q2/Q3) were resolved by the user before this phase began. The remaining research items below are not blockers — they are the explicit "why this choice, why not the alternatives" record for the technical decisions in `plan.md`.

---

## R1 — How to bootstrap a `cash_drawer_sessions` row in v1

**Decision**: Auto-open a session with `opening_cents = 0` on first need — lazily, inside the same RPC that closes it. Concretely, the close RPC does an `INSERT … ON CONFLICT (id) DO NOTHING` against a partial unique index, then closes that row. No separate `pos_ensure_cash_drawer_session` call is needed; the close RPC handles both cases.

**Rationale**:
- The user's Q1 answer (A) explicitly chose "auto-open with `opening_cents = 0`; no opening UI in v1."
- A separate open-on-first-cash-payment trigger would require editing `pos_take_cash` and the soon-to-land split-tender RPCs to ensure a session exists — needless coupling for v1.
- A "lazy open inside close" keeps the entire session lifecycle in one RPC and removes the only case that would otherwise produce "session opened but never closed" rows (operator opens the page but walks away).

**Alternatives considered**:
- *Explicit `pos_ensure_cash_drawer_session` RPC called on page load*: would create an open row even if the operator never closes. Adds an audit verb (`cash_drawer.opened`) with no value in v1 since there is no opening-cash UI to attribute. Rejected for scope; the `cash_drawer.opened` action is **not** added to the TS audit vocabulary in this feature.
- *Trigger on first `payments` insert*: couples the cash-drawer lifecycle to every cash payment everywhere (cash sale, split tender cash leg). Rejected as cross-cutting.

**Knock-on effect**: only one new audit verb (`cash_drawer.closed`) is added in `lib/auth/audit.ts`. Plan and contracts are updated to reflect this.

---

## R2 — How "today" is computed for the cash list and expected total

**Decision**: Reuse the existing `todayWindow(tz, now)` helper from `lib/time/period-windows.ts`. The salon's timezone comes from `getSalonTimezone()` (`lib/db/settings.ts`), which reads `settings.salon.timezone` and falls back to `America/Los_Angeles`. The cash list query filters `payments.processed_at >= start AND payments.processed_at <= end`.

**Rationale**: Single source of truth for time math (Principle III bullet on time correctness). The dashboard already exercises this exact pair in `loadDashboard`; the same window is used here so "today" agrees across surfaces.

**Alternatives considered**:
- *Use `created_at` instead of `processed_at`*: cash payments today set both at insertion time, so they coincide for the cash path. Card/gift payments may have a `processed_at` later than `created_at` (webhook arrival). The expected-cash total cares about when the cash actually entered the drawer — that's `processed_at`. Rejected `created_at`.
- *Pull a 7-day window and filter client-side*: wasteful. The `payments` index on `(ticket_id, processed_at)` is not optimal for this read; a small composite index would be the alternative, but a single-day filter against the existing index is fast enough at v1 scale (single salon, < 200 payments/day).

---

## R3 — How to enforce one-open-session-per-day under concurrency

**Decision**: Two layers.
1. **Schema**: partial unique index on `cash_drawer_sessions` `WHERE closed_at IS NULL` — at most one open row at a time, full stop. Mirrors the system-design wording for this table.
2. **RPC**: `pos_close_cash_drawer` does the close inside a `SERIALIZABLE` (or repeatable-read with `FOR UPDATE`) transaction:
   - `INSERT INTO cash_drawer_sessions … ON CONFLICT DO NOTHING` (handles the lazy auto-open),
   - `SELECT … FOR UPDATE` the open row,
   - if the row is already closed, raise `cash_drawer_already_closed` (caller maps to "already-closed" confirmation),
   - recompute `expected_cents` from `payments` for today,
   - if `p_expected_cents != recomputed_expected`, raise `cash_drawer_expected_changed` (caller maps to the recount banner),
   - else update the row's `counted_cents`, `variance_cents`, `notes`, `closed_at`, `closed_by_staff_id`,
   - insert the `audit_log` row inside the same transaction.

**Rationale**: Mirrors `pos_take_cash`'s pattern in `0004_checkout_cash_sale.sql` (lock → check → write → audit, all in one transaction). The partial unique index is the belt; the row lock is the suspenders. The two distinct error codes give the client two distinct UX outcomes (already-closed screen vs recount banner) without parsing strings.

**Alternatives considered**:
- *Advisory lock on a constant key*: works but doesn't help if a second operator skips the RPC. The index + lock combo defends both paths.
- *Optimistic CAS with a version column*: more rows, more complexity, no real concurrency at v1 scale.

---

## R4 — Role gating: where the check lives and which roles are allowed

**Decision**: Gate at **both** the page (`page.tsx`) and the Server Action (`closeCashDrawerAction`). Allowed roles: `owner`, `manager`. `front_desk` and `technician` get a 403 at the page (redirected to the dashboard with a flash) and a thrown error from the action if they bypass the page.

**Rationale**: Constitution II — "Authorization MUST be enforced inside Server Actions; RLS is a backstop." The page check is a UX courtesy; the action check is the security boundary. Two-layer defence matches how `services-edit` and the staff-management routes gate writes.

The closing user is the *operator* (`acting_as_staff_id`), per `lib/auth/session.ts`. `requireStudioSession()` returns the staff object including `role`; the page calls it once, the action calls it again to re-read role at submit time (cookie + role haven't changed in the request hop).

**Alternatives considered**:
- *Only gate at the action*: leaves the page visible to non-managers with a "you can't close out" error on submit. Bad UX.
- *Only gate at the page*: violates Principle II.
- *RLS policy on `cash_drawer_sessions`*: RLS is a backstop, not the primary control; in this codebase it would require a `current_setting('app.actor_staff_id')` ferry that the rest of the schema doesn't use.

---

## R5 — Refund handling in the read model (forward-compat)

**Decision**: The aggregation function treats any `payments` row with `method='cash'`, `status='succeeded'`, and `kind='refund'` as a refund — rendered as a list row with a negative amount and a "Refund" meta label, and subtracted from `expected_cents`. The current schema has only `payment_kind = 'payment'`, so no refund rows can exist today; the path is *dead* in production until the refund feature lands and adds `'refund'` to the enum.

**Rationale**: Q2 answer (A) requires refunds to appear as `−$X.XX` rows when they exist. Writing the code now and unit-testing it with synthetic fixtures means the EOD screen "just works" the day refunds ship, with no follow-up edit. Scope discipline is respected because no UI surface, no migration, and no code path is added for refunds beyond what's required to *render zero of them correctly today*. The unit test seeds a synthetic `kind='refund'` row through a test helper that bypasses the enum to prove the formatting code is correct.

**Alternatives considered**:
- *Wait for refunds to land before adding the display code*: would mean a guaranteed follow-up edit to this feature's files. Rejected.
- *Add `'refund'` to `payment_kind` in this feature's migration*: adds a schema construct with no caller (Principle V — speculative generality). Rejected.

---

## R6 — Stale-expected detection: snapshot key

**Decision**: The page renders the expected total to the operator and passes `expected_cents` (the snapshot value) as a parameter on submit. The server recomputes the current expected total inside the close transaction; if they differ, the close is rejected with error code `cash_drawer_expected_changed` and the page reloads.

The snapshot key is the integer cent value, not a timestamp or a hash — a real cash payment between page-load and submit changes the integer, which is exactly when we want to refuse the close. A no-op change (re-rendering the same total) does not.

**Rationale**: Q3 answer (A). Minimum information passed over the wire, no extra round-trip for a hash check, no race on a "last seen at" timestamp.

**Alternatives considered**:
- *Pass a `loaded_at` timestamp and reject if any cash payment happened after it*: equivalent in correctness, more brittle (clock skew, late webhooks). Rejected.
- *Subscribe via Supabase realtime to refresh expected live*: the dashboard does this for the recent-transactions feed; doing it here too would still need a submit-time tie-break. Out of scope for the simplest correct solution.

---

## R7 — Numpad input rules

**Decision**: A small client component owns the digit buffer as a string. Rules implemented:
- Digits append; if `fresh` flag is set (after Clear, or initial), the first digit replaces the buffer instead of appending.
- `.` is a no-op if the buffer already contains `.`.
- After the decimal point, max 2 more digits accepted (cap).
- Backspace removes one char from the end.
- Clear resets the buffer to `""` and `fresh = true`.

The buffer string is the display; computation parses it as a float (or, more safely, splits on `.` and computes integer cents). The integer-cent path is used for the comparison.

**Rationale**: Verbatim port of the prototype's rules (`EndOfDay.jsx` lines 137–148). Lifting the same rules avoids divergence with the design and is trivially unit-testable as pure functions.

**Alternatives considered**:
- *Use a native `<input type="number">`*: violates Principle I (no big-touch numpad matching the prototype) and lets the keyboard slip onto a tablet's auto-keyboard.

---

## R8 — Status pill copy

**Decision**: Show only `Open` (success-tinted pill) or `Closed` (muted pill). Drop the prototype's "· Closing at 8 PM" suffix since the salon does not yet have a `salon.closing_time` setting and adding one would be scope creep.

**Rationale**: Spec Assumption — "actual closing time can be derived from settings; for v1, showing 'Open' or 'Closed' is sufficient." The two pill states use the existing `--success` / `--muted` / `--muted-foreground` tokens already used by the prototype's `.eod-status-pill` classes.

**Alternatives considered**:
- *Hard-code "8 PM"*: a maintenance bear-trap (the salon changes their hours and the pill lies). Rejected.

---

## R9 — Why a new `styles/end-of-day.css` instead of inlining

**Decision**: Vendor the prototype's `.eod-*` class block (≈ 200 lines of CSS) into `styles/end-of-day.css` and import it in `app/(studio)/end-of-day/page.tsx`, mirroring how `styles/dashboard.css` is wired into the dashboard page. All values continue to reference `var(--*)` tokens from `styles/tokens.css`.

**Rationale**: Matches the established repo pattern; keeps tailwind class soup out of the component files for this view, which is heavily one-off and 1:1 with the prototype. The CSS file is the diffable artifact for the design auditor pass.

**Alternatives considered**:
- *Tailwind utility classes everywhere*: would not match the prototype's exact look without reaching for arbitrary values, which fights Principle I.
- *CSS-in-JS or inline styles*: same Principle I concern; harder to audit against the prototype's CSS.

---

## R10 — Audit payload shape

**Decision**: `audit_log.payload` for `cash_drawer.closed` is `{expected_cents: int, counted_cents: int, variance_cents: int, notes: string | null, session_id: uuid}`.

**Rationale**: Mirrors the `payment.captured` payload pattern from feature 011. The payload is the auditable snapshot of what was closed; `session_id` lets investigators jump from the audit row to the `cash_drawer_sessions` row directly without joining on a timestamp window.

**Alternatives considered**:
- *Just `{session_id}` and have investigators join*: less self-contained, marginally less convenient. Rejected.
