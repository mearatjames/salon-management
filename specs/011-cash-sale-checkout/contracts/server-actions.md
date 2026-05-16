# Contract: Server Actions — Checkout (Cash-Only Sale)

**Module**: `app/(studio)/checkout/actions.ts`

This file contracts the seven Server Actions for this feature: signature, inputs, return shape, errors, invariants, and audit emissions. The Server Actions are the only mutation surface for the feature (Constitution Principle II); there is no public HTTP API, no webhook, no CLI in this phase.

All actions:

- Are exported `async function`s marked `"use server"` at the file top.
- Authenticate via the existing `requireStudioSession()` helper in `lib/auth/session.ts`. It returns a `StudioViewer` (`{ deviceUserId, staff: { id, role, … } }`) and throws `AuthRedirectError` if no valid session exists. The operator id is `viewer.staff.id`; the device-user id is `viewer.deviceUserId`. No anonymous mutation path.
- Validate input with `zod` schemas defined alongside the action.
- Use the service-role Supabase client from `lib/db/admin.ts` for writes. Service-role bypasses RLS; authorization is enforced in the action body.
- Emit an `audit_log` row through `lib/auth/audit.ts` for every successful write (except `payment.captured`, which is emitted from inside the `pos_take_cash` SQL function — see [audit.contract.md](./audit.contract.md)).

Common error shape: every action either returns its success type or throws. UI-recoverable failures (e.g., `takeCash` on a ticket that became unpriced between client check and submit) throw a typed error subclass whose `code` field is rendered as a banner by the client island.

---

## 1. `createEmptyTicket()`

**Purpose**: Open a brand-new standalone ticket for the current operator (FR-002).

**Signature**:

```ts
export async function createEmptyTicket(): Promise<{ ticketId: string }>;
```

**Invariants**:

- Inserts one `public.tickets` row with `status='open'`, `appointment_id=null`, `opened_by_staff_id = viewer.staff.id`, all totals = 0.
- Emits `audit_log` row with `action='ticket.created'`, `entity_id = newTicketId`, payload `{ created_by_entry_point: 'unspecified' }` (the entry point is provided by `resumeOrCreateTicket` when it calls through; direct callers omit it).
- Never re-uses an existing ticket. The caller (`/checkout/page.tsx`) is responsible for redirect logic.

**Errors**: refuses if no `acting_as_staff_id` cookie (throws — middleware should have redirected first).

---

## 2. `resumeOrCreateTicket()`

**Purpose**: The sidebar "Checkout" entry point (FR-001, FR-003). Implements the same-day-only resume rule (clarification Q1, FR-003) and the discarded-exclusion (clarification Q5).

**Signature**:

```ts
export async function resumeOrCreateTicket(): Promise<{
  ticketId: string;
  resumed: boolean;
}>;
```

**Invariants**:

- Runs the resume query from research.md § R8: `status='open'`, `opened_by_staff_id = viewer.staff.id`, `created_at` within the salon's current calendar day (TS-computed bounds, see R8). Returns the most recently updated row, if any.
- If found: returns `{ ticketId, resumed: true }`. No audit emission (no write occurred).
- If not found: calls `createEmptyTicket()` and returns `{ ticketId, resumed: false }`. The downstream `ticket.created` audit row carries `payload.created_by_entry_point = 'sidebar_resume_or_create'`.
- Paid and discarded tickets are NEVER returned — the resume query filters them out by index predicate.

**Errors**: same as `createEmptyTicket` for the no-session path.

---

## 3. `addServiceLine(input)`

**Purpose**: Tap a service tile (FR-009, FR-010, FR-014).

**Signature**:

```ts
const AddServiceLineInput = z.object({
  ticketId: z.string().uuid(),
  serviceId: z.string().uuid(),
  assignedStaffId: z.string().uuid(),     // current header-picked tech (client-supplied; server validates)
});

export async function addServiceLine(
  input: z.infer<typeof AddServiceLineInput>
): Promise<{ lineId: string; subtotalCents: number; totalCents: number }>;
```

**Invariants**:

- Refuses if the ticket is not in `status='open'` (throws `TicketNotOpenError`).
- Refuses if `assignedStaffId` is not an active staff member (throws `StaffNotActiveError`).
- Reads `services.{name, price_cents, variable_price}`; refuses if the service is `active=false` (throws `ServiceArchivedError`).
- Inserts `ticket_items` with:
  - `kind='service'`
  - `ref_id = serviceId`
  - `name_snapshot = services.name`
  - `unit_price_cents = services.price_cents`
  - `qty = 1`
  - `assigned_staff_id = assignedStaffId`
  - `price_unconfirmed = services.variable_price`
- Recomputes `subtotal_cents` and `total_cents` on the parent ticket (research.md § R2). `tax_cents` stays 0.
- Emits `audit_log` row `ticket.line_added`, entity = `ticket_items.id`, payload `{ ticket_id, service_id, unit_price_cents, price_unconfirmed }`.

**Errors**:

- `TicketNotOpenError` → client renders "This ticket is no longer open" inline; navigates to dashboard.
- `StaffNotActiveError`, `ServiceArchivedError` → client renders an inline toast and removes the optimistic line.

---

## 4. `removeLine(input)`

**Purpose**: Remove a cart line (FR-011).

**Signature**:

```ts
const RemoveLineInput = z.object({
  ticketId: z.string().uuid(),
  lineId: z.string().uuid(),
});

export async function removeLine(
  input: z.infer<typeof RemoveLineInput>
): Promise<{ subtotalCents: number; totalCents: number }>;
```

**Invariants**:

- Refuses if ticket is not `open` (`TicketNotOpenError`).
- Deletes the named `ticket_items` row (no soft-delete in this phase; the row never has reporting value before charge).
- Recomputes ticket totals; if the cart is now empty, totals return to 0.
- Emits `ticket.line_removed`, entity = the deleted `lineId`, payload `{ ticket_id, service_id, unit_price_cents }`.

---

## 5. `setLineTech(input)`

**Purpose**: Per-line tech reassignment (FR-013, US3).

**Signature**:

```ts
const SetLineTechInput = z.object({
  ticketId: z.string().uuid(),
  lineId: z.string().uuid(),
  assignedStaffId: z.string().uuid(),
});

export async function setLineTech(
  input: z.infer<typeof SetLineTechInput>
): Promise<{ ok: true }>;
```

**Invariants**:

- Refuses if ticket is not `open`.
- Refuses if `assignedStaffId` is not an active staff member.
- Updates ONLY the named line's `assigned_staff_id`. No other line changes; header-picked tech is unchanged.
- Emits `ticket.line_tech_assigned`, entity = `lineId`, payload `{ ticket_id, previous_staff_id, new_staff_id }`.

---

## 6. `takeCash(input)`

**Purpose**: The atomic cash-payment terminal action (FR-018, FR-019).

**Signature**:

```ts
const TakeCashInput = z.object({
  ticketId: z.string().uuid(),
});

export async function takeCash(
  input: z.infer<typeof TakeCashInput>
): Promise<{ paymentId: string; chargedCents: number }>;
```

**Invariants**:

- Calls the `pos_take_cash(p_ticket_id, p_operator)` RPC. The RPC does the actual mutation (insert payment, flip ticket, audit) inside a single Postgres transaction (research.md § R1).
- Does NOT pre-check the ticket from Node side; the RPC owns the validation. Pre-checking would race with `discardTicket` on the same ticket.
- On Postgres error code translation:
  - `ticket_not_open` → throws `TicketNotOpenError` → client banner.
  - `ticket_has_unpriced_items` → throws `TicketHasUnpricedItemsError` → client re-enables Take cash with the FR-015 hint.
  - `ticket_empty` → throws `TicketEmptyError` (defensive; client disables Take cash when cart is empty anyway).
  - any other Postgres exception → throws `CashPaymentFailedError` → client shows the FR-019 banner ("Cash payment didn't save — try again").
- Audit emission: the `payment.captured` row is written by `pos_take_cash` itself, not by this action. The action does NOT also audit (avoiding double-emission).
- On success returns `{ paymentId, chargedCents }`. Caller renders DoneScreen with the charged amount.

**Concurrency**: The RPC's `FOR UPDATE` lock on `tickets` serializes `takeCash` and `discardTicket` on the same ticket. The loser sees `ticket_not_open`.

---

## 7. `discardTicket(input)`

**Purpose**: Explicit operator-driven discard of an in-progress ticket (FR-005, clarification Q5, SC-008).

**Signature**:

```ts
const DiscardTicketInput = z.object({
  ticketId: z.string().uuid(),
});

export async function discardTicket(
  input: z.infer<typeof DiscardTicketInput>
): Promise<{ ok: true }>;
```

**Invariants**:

- Refuses if the ticket is already `paid` or `discarded` (terminal states are not revisitable — throws `TicketAlreadyTerminalError`).
- Updates `tickets.status='discarded'`, `closed_by_staff_id = viewer.staff.id`, `closed_at = now()`. `total_cents` is left as-is for forensic visibility (the cart contents on a discarded ticket are still readable via the receipt route, though no receipt would normally be printed for a discarded ticket).
- Emits `ticket.discarded`, entity = `ticketId`, payload `{ subtotal_cents_at_discard, line_count_at_discard }`.
- Caller (the client island) routes the operator back to the dashboard after a successful discard.

**Not in this phase**: there is no "un-discard" action. Once `discarded`, the ticket is terminal.

---

## Cross-cutting invariants

- **Operator attribution**: every action reads the operator id from the `StudioViewer` returned by `requireStudioSession()` — specifically `viewer.staff.id`. Audit rows carry this as `acting_as_staff_id` (via the existing `audit()` helper, which also writes `actor_user_id = viewer.deviceUserId`). Relevant table columns (`tickets.opened_by_staff_id`, `tickets.closed_by_staff_id`, `payments.taken_by_staff_id`) all derive from `viewer.staff.id`.
- **No client trust for money**: `addServiceLine` reads `services.price_cents` from the database — the client never sends a price. `takeCash` reads `tickets.total_cents` inside the RPC's locked transaction.
- **Idempotency**: actions do not currently key inputs (no `Idempotency-Key` header analog). Re-submission protection is by:
  - `takeCash` — the ticket is locked + `status='open'` checked; a second submission sees `ticket_not_open`.
  - `discardTicket` — same — second submission sees `TicketAlreadyTerminalError`.
  - mutating actions on `ticket_items` — multiple submissions could create duplicate lines; the client island guards with a `pending` flag on the tile (matches the prototype's behavior). This is acceptable because duplicates are easily removed and never cause money loss; if telemetry shows it's a real problem, a phase-9 follow-up adds a client-supplied `dedupe_key`.

## Type exports

```ts
export type CheckoutActionError =
  | { code: 'TICKET_NOT_OPEN' }
  | { code: 'TICKET_ALREADY_TERMINAL' }
  | { code: 'TICKET_HAS_UNPRICED_ITEMS' }
  | { code: 'TICKET_EMPTY' }
  | { code: 'STAFF_NOT_ACTIVE' }
  | { code: 'SERVICE_ARCHIVED' }
  | { code: 'CASH_PAYMENT_FAILED'; pgError?: string };
```

The error subclasses extend `Error` with a non-enumerable `code` field for `instanceof`-friendly handling in the client island.
