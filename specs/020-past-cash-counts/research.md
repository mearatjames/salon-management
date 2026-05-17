# Phase 0 — Research: Past Cash Counts

Decisions made during planning. Each one resolves an option the spec or the plan deliberately left open.

---

## R1 — Detail surface: slide-in panel vs dedicated route

**Decision**: Dedicated route at `/end-of-day/history/[sessionId]`.

**Rationale**:
- Shareable URL — when an owner spots a problem and forwards "look at this day" to a manager, the URL is the deliverable.
- Native browser back-button works without custom history shimming.
- Simpler RSC composition — the page is its own server component with its own data fetch; no client-side modal/sheet state machine needed.
- Consistent with existing studio patterns (`/services/[id]`, `/staff/[id]`) used by features 008 and 006.

**Alternatives considered**:
- Slide-in panel from the list. Rejected — would require either holding the detail data in client state (an unnecessary network round-trip on row open) or RSC-streaming into a parallel slot (over-engineered for a single detail per page). Also would not produce a shareable URL.
- Inline expand-collapse rows in the list. Rejected — the edit form needs vertical room (numpad is 4 rows × 3 columns; comparison block; notes textarea); inlining would crowd the list and harm SC-001 scan-time.

---

## R2 — Concurrency model for edits: last-write-wins vs optimistic locking

**Decision**: Last-write-wins on the `cash_drawer_sessions` row update. Every edit (including no-op edits, see R5) writes an `audit_log` row, so concurrent edits both appear in the change history and neither is silently lost.

**Rationale**:
- The audit trail is the safeguard the constitution demands (Principle III); a "last edit wins" UX is fine as long as the loser is preserved in the audit, which it is.
- Optimistic locking (`If-Match` against `updated_at`) would require: a client-side token, a reject-on-mismatch error code, and a refresh-and-retry path. For a single salon with at most a few managers, the realistic collision rate is ~0; that complexity does not earn its keep in v1.
- Mirrors how the close RPC handles concurrent attempts on the same business day (existing 019 RPC uses the partial unique index + `FOR UPDATE`; here the row-level lock during the RPC's `UPDATE` is sufficient because each edit targets a specific session by id).

**Alternatives considered**:
- Optimistic lock via `updated_at` etag. Rejected — see above; complexity without observed collision risk.
- Pessimistic lock (advisory lock per session id while the edit form is open). Rejected — requires lease/heartbeat infrastructure; way out of scope for v1.

---

## R3 — "Edited" indicator source: audit_log query vs denormalized flag

**Decision**: Derive the indicator from `audit_log` rows where `action = 'cash_drawer.edited'` and `entity_id = <session.id>`. Specifically, the list query left-joins a `count(*)`/`max(created_at)`/`max(acting_as_staff_id)` aggregate; the detail page reads the full set ordered by `created_at desc` for the change-history accordion.

**Rationale**:
- FR-009 explicitly requires deriving from audit_log, not from a denormalized flag. The reasoning behind that requirement: a flag that lives on the row could drift from the audit reality (someone forgets to set it; a bug skips one write); the audit IS the truth.
- Single-tenant scale: even if a salon edits 5 closed days every week for a year, that is ~260 rows in `audit_log` filtered by entity_type — a cheap indexed read.
- Keeps `cash_drawer_sessions` schema lean — only `updated_at` is added (and that one is for the "Edited at" timestamp display only; the "was-edited?" boolean is `count > 0` from audit_log).

**Alternatives considered**:
- Boolean `was_edited` flag on `cash_drawer_sessions`. Rejected by FR-009.
- Trigger that maintains a `edit_count` counter column. Rejected — same drift-risk as a flag plus extra surface area on writes; the audit_log query is fast enough.

---

## R4 — Pagination strategy for the history list

**Decision**: Offset-based pagination with a default page size of 90 days. Initial render shows the most recent 90 closed sessions; a "Show earlier" button at the bottom of the list fetches the next 90 (and so on).

**Rationale**:
- Single salon, ~365 closed sessions per year at most. The largest realistic list after 5 years is ~1,825 rows — offset still scans cleanly in Postgres against the `cash_drawer_sessions_business_day_idx`.
- Offset pagination is the simplest mental model for the UI and the easiest to URL-encode (`/end-of-day/history?page=2`).
- Cursor pagination's only win is consistent paging under heavy concurrent writes; that scenario does not apply here (one row written per day).

**Alternatives considered**:
- Cursor (`?before=<business_day>`). Rejected — extra complexity, no benefit at this scale.
- Infinite scroll with intersection observer. Rejected — harder to deep-link to a specific spot in history; "Show earlier" is a more honest UI for an audit surface.
- Server-side date range filter (`?from=&to=`). Deferred — useful but not in scope for v1; the "Show earlier" pagination plus the per-day `/end-of-day/history/[sessionId]` detail covers the SC-001 lookup time target.

---

## R5 — No-op edit handling: silent skip vs always-write-audit

**Decision**: Always write an `audit_log` row, even when every after-value equals the corresponding before-value. The DB-level row update is run unconditionally with the new values — when those equal the existing values it is a harmless self-overwrite, and `updated_at` advances either way.

**Rationale**:
- The audit trail "operator looked at this row and saved it" is itself useful — it tells an auditor that two managers reviewed a day even if neither changed it.
- The alternative (compare-in-RPC and skip if equal) requires a SELECT-for-comparison plus conditional write — more code, more failure modes, and the auditor loses information.
- Idempotency under retry (FR-013) is preserved: re-submitting the same edit values produces the same end state; audit rows accumulate but each one is honest about what happened ("save attempted at T, no value diff").

**Alternatives considered**:
- Skip audit when no values changed. Rejected — loses the "manager reviewed this row" signal.
- Skip the row update entirely when no values changed. Rejected — same loss, plus `updated_at` doesn't advance, which would conflict with the "Last edited at" UI showing the latest review.

---

## R6 — Comparison-block extraction: where does the shared `deriveComparison` live?

**Decision**: Extract the existing `deriveComparison` helper out of `components/lacquer/eod/cash-count.client.tsx` and into `lib/end-of-day/comparison.ts`. Both client islands (the close screen's `cash-count.client.tsx` and the new `edit-form.client.tsx`) import it. The function is pure; the existing Vitest test against it (currently exercised through the close-island integration test) moves to a focused `comparison.test.ts`.

**Rationale**:
- DRY: the math (cents conversion, diff sign, match/short/over state) is identical between close and edit. Duplicating it would inevitably drift.
- Pure helper in `lib/` matches how other pure derivations live in the repo (`lib/end-of-day/aggregate.ts`, `lib/time/format.ts`).
- The extraction is a *moved file*, not a behavior change — easy to verify via the existing test continuing to pass.

**Alternatives considered**:
- Leave the helper in the close-island file and import it into the edit island. Rejected — `"use client"` files re-exporting helpers is awkward; the consumer would have to be a client component too. A pure module decouples.
- Re-derive the comparison rules independently in each island. Rejected — would drift.

---

## R7 — Migration sequencing: column add + RPC create in one file vs two

**Decision**: One migration file (`0015_cash_drawer_edits.sql`) that adds the `updated_at` column, creates the `pos_edit_cash_drawer` RPC, and grants execute to `service_role`. Same shape as the 019 migration that added the table and the close RPC together.

**Rationale**:
- The RPC body references `updated_at` — splitting the migration into two files would require careful ordering and add nothing.
- The schema-drift-forbidden rule (constitution § Dev Workflow) is honored either way; one file is the simplest deliverable.

---

## R8 — Notes-field rules on edit: re-asserting the close-time invariants

**Decision**: The edit RPC enforces the same `cash_drawer_notes_required_when_variance_chk` semantics as the close RPC — if the resulting `variance_cents != 0`, the trimmed `notes` MUST be non-empty. If the resulting `variance_cents == 0`, an empty `notes` is allowed (the operator may legitimately clear an outdated explanation). The RPC trims the notes before persistence and treats whitespace-only as empty.

**Rationale**:
- Mirrors the close-time behavior (existing constraint on the table). Operators learn one rule, not two.
- The existing CHECK constraint on the table enforces this at the database level too — the RPC enforcement is for clean error mapping (the UI gets `NOTE_REQUIRED` rather than a raw constraint-violation message).

**Alternatives considered**:
- Always require a non-empty notes on edit (even when the new variance is zero). Rejected — would prevent a legitimate correction of a previously-explained variance back to zero. Owners need to be able to clear stale explanations.

---

## R9 — Are the dashboard's existing currency / time formatters sufficient?

**Decision**: Yes. Reuse `formatCurrency` from `lib/format/currency.ts` and the existing time formatters from `lib/time/format.ts`. Display business_day as a long-form date ("Mon, May 11") using a small `Intl.DateTimeFormat` matching the close screen's header subtitle pattern. No new formatter modules.

---

## Out of scope (named explicitly to prevent later re-litigation)

- **Reopen transition.** No way to flip a closed session back to open. Edits modify in place.
- **PIN re-prompt before edit.** Role gate alone; consistent with other manager-only studio screens.
- **Lock-after-N-days.** A future feature can add a "locked at deposit" gate; today, edits are permitted indefinitely.
- **Recompute `expected_cents` from current payments.** Frozen at close-time. If a missing cash payment is discovered later, that is a separate data-correction concern.
- **Filtering by closer, variance, or date range.** The most recent 90 days plus "Show earlier" satisfies SC-001; richer filters are a future feature.
- **Exporting history to CSV.** Deferred.
- **A separate `cash_drawer_edits` history table.** Audit_log already carries per-edit detail and that is what FR-009 and FR-010 read from.
