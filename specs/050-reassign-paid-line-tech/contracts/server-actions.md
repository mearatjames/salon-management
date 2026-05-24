# Server Action Contract — `reassignPaidLineTech`

**Location**: `app/(studio)/transactions/actions.ts` (new file).

**Trust model**: Server-authoritative (Constitution Principle II). The
action is the **authority** for who may reassign and when; the UI's
absence-of-affordance is defense in depth (FR-014).

---

## Input

```ts
type ReassignPaidLineTechInput = {
  ticketId: string;          // uuid; the paid ticket whose line is being corrected
  lineId: string;            // uuid; the ticket_items.id to reassign
  newAssignedStaffId: string; // uuid; the staff.id to assign (must be active)
};
```

Validation (zod, mirroring the pattern in
`app/(studio)/checkout/actions.ts`):
- All three fields must be present and parse as uuids.
- A failure here throws a generic `Error` (consistent with `setLineTech`).
  It is not one of the six typed errors below — it's a client bug, not a
  policy decision.

---

## Output (success)

```ts
type ReassignPaidLineTechResult = { ok: true };
```

The single `{ ok: true }` shape covers two distinct success paths:

1. **Mutation applied.** The line's `assigned_staff_id` was different
   from the input; one `UPDATE`, one `audit_log` insert, four
   `revalidatePath` calls.
2. **No-op (FR-013).** The line's `assigned_staff_id` already equals
   the input; no `UPDATE`, no audit row, no revalidations. Returns
   `{ ok: true }` so the client's handling is uniform (no error path
   needed; the next render simply shows the same chip).

The action does not return the new tech's display fields — the client
reads them from the staff roster it already has, exactly as the cart
does after `setLineTech`.

---

## Errors (typed)

Six distinct typed errors, one per FR-012 gate. Each is a subclass of
`Error` with a stable `.name` the client can switch on, matching the
existing convention in `app/(studio)/checkout/actions.ts`
(`TicketNotOpenError`, `StaffNotActiveError`, etc.).

| Class name | Thrown when | FR clause |
|---|---|---|
| `PermissionDeniedError` | `viewer.staff.role` is neither `'owner'` nor `'manager'`. | FR-003, FR-012 (a), FR-014 |
| `TicketNotPaidError` | The loaded ticket's `status !== 'paid'`. | FR-012 (b) |
| `PayPeriodFinalizedError` | `isPayPeriodFinalized` returned `true` for the ticket's pay period. | FR-002, FR-004, FR-012 (c) |
| `StaffNotActiveError` | The loaded staff row's `active !== true`. **Reuse** the class from `app/(studio)/checkout/actions.ts` (already defined). | FR-005 (race), FR-012 (d) |
| `TicketOrLineNotFoundError` | Ticket id resolves to no row, OR line id resolves to no row, OR the line's `ticket_id` does not match `input.ticketId`. | FR-012 (e) |
| (generic `Error`) | Database write failed mid-flow (e.g., Supabase down). | Not a policy error — surfaced to the operator via the existing toast pattern. |

**Order of checks** (matters for both spec semantics and the audit
guarantee that *no data of any kind, including no audit row, is
written on rejection*):

1. Parse input (zod). Reject on shape failure.
2. `viewer = await requireStudioSession()`. (Throws `AuthRedirectError`
   if not signed in — the existing pattern.)
3. **Role check** → `PermissionDeniedError`.
4. Service-role Supabase client.
5. Load `tickets` row by `input.ticketId`. → `TicketOrLineNotFoundError`
   if no row.
6. **Paid-state check** → `TicketNotPaidError`.
7. Resolve `PayPeriodRef` from `ticket.closed_at`.
8. **Finalized check** (`isPayPeriodFinalized`) → `PayPeriodFinalizedError`.
9. Load `staff` row by `input.newAssignedStaffId`. → `StaffNotActiveError`
   if no row or `active !== true`.
10. Load `ticket_items` row by `input.lineId`. → `TicketOrLineNotFoundError`
    if no row or `ticket_id !== input.ticketId`.
11. **No-op check** — if `lineRow.assigned_staff_id === input.newAssignedStaffId`,
    return `{ ok: true }` without writing.
12. `UPDATE ticket_items SET assigned_staff_id = $1 WHERE id = $2`.
13. `recordAudit("ticket.line_tech_reassigned", ...)` — see
    [data-model.md](../data-model.md) § "Audit log row written by this
    feature" for the exact payload shape.
14. `revalidatePath('/transactions')` · `revalidatePath('/dashboard')` ·
    `revalidatePath('/report')` · `revalidatePath('/payroll')`.
15. Return `{ ok: true }`.

If any step 4–14 throws, the action propagates the throw and **no
audit row is written** (the audit insert is step 13, after every
gate). If the database itself partially writes between steps 12 and
13 (extremely unlikely — single-table single-row updates are atomic on
Postgres), the audit row may be missing for an applied update; this is
documented as an inherent limitation of the single-action pattern and
is no worse than the existing `setLineTech` behaviour.

---

## Idempotency

This action is **idempotent at the operator level**: invoking it twice
with the same input produces the same end state. The second call hits
the no-op branch (step 11) — no second audit row.

It is **not** idempotency-key-keyed (unlike Square calls). The natural
key — `(ticket_id, line_id, new_staff_id)` — already provides the
no-op guarantee, and there is no external system to deduplicate
against.

---

## Concurrency

Plain `UPDATE` — no row lock, no version check. See research.md § 11.
Two concurrent reassignments of the same line both succeed; both
write audit rows; the later write wins on `assigned_staff_id`. The
audit history is fully reconstructible.

---

## Caller contract — UI

The drawer's `<ReceiptLineTechChip>` calls the action via a Next.js
Server Action import — the standard `'use server'` pattern. On
resolution:

- **Success**: dismiss the Popover, call `router.refresh()` so the
  server parent re-renders with the new `techId` (the
  `revalidatePath('/transactions')` invalidates the page-cache; the
  refresh is what triggers the re-fetch in the visible drawer).
- **Failure**: a toast carrying the error's human-readable message —
  the typed errors above map 1:1 to copy. Suggested copy (this is a
  copy decision the implementing developer should run by the
  maintainer, not a spec requirement):
  - `PermissionDeniedError` → *"You need owner or manager access to
    change a service line's tech."* (essentially unreachable from a
    properly-rendered drawer — defense-in-depth landed here.)
  - `TicketNotPaidError` → *"This ticket isn't paid; use the cart to
    change the tech instead."*
  - `PayPeriodFinalizedError` → *"Payouts for this pay period have
    been finalized. The line can't be reassigned."* (matches the
    locked-chip tooltip copy.)
  - `StaffNotActiveError` → *"That staff member is no longer active.
    Pick someone else."*
  - `TicketOrLineNotFoundError` → *"The ticket or line couldn't be
    found. Refresh and try again."*
  - generic `Error` → *"Couldn't save the change. Try again."*

The action never returns an error in-band as part of `Result` — it
throws — so the client uses a `try/catch` around the call, matching
the existing pattern around `setLineTech`.

---

## Anti-contract — what this action MUST NOT do

These are tested explicitly (see `tests/unit/transactions/reassign-paid-line-tech.test.ts`)
so future edits do not regress:

1. **Touch any monetary field.** `unit_price_cents`, `qty`,
   `discount_pct`, `tip_*`, `total_*` — none of these are read for
   write, and none are part of the `UPDATE`. SC-006.
2. **Touch the cashier identity** (`tickets.closed_by_staff_id`). Out
   of scope per FR-007.
3. **Touch any field besides `ticket_items.assigned_staff_id`.** Not
   even `ticket_items.updated_at` (the column doesn't exist on the
   table; if it ever did, this contract would be amended to address
   it explicitly).
4. **Write more than one audit row.** Exactly one row on success;
   zero on no-op or rejection. SC-002, FR-013.
5. **Write any audit row when the request is rejected** for any of
   the six gate reasons. FR-012.
6. **Insert or upsert into `pay_periods` or `payroll_payouts`.** The
   finality check is read-only; if the `pay_periods` row doesn't
   exist, the period is by definition open and the helper returns
   `false`. The Payroll page is the only surface that creates
   `pay_periods` rows (via `ensurePayPeriodRow` in
   `lib/payroll/queries.ts:81`).
