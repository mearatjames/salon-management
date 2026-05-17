# Contract: Server Actions — Checkout (Cart Polish)

**Module**: `app/(studio)/checkout/actions.ts` (extended in this phase)

This file contracts the four Server Actions added by this feature: signature, inputs, return shape, errors, invariants, and audit emissions. Same module as phase 2 — these actions sit alongside `createEmptyTicket`, `resumeOrCreateTicket`, `addServiceLine`, `removeLine`, `setLineTech`, `takeCash`, `discardTicket`, and `startNewSale` (whose contracts continue to live in `specs/011-cash-sale-checkout/contracts/server-actions.md`).

All actions in this phase follow the same prelude as phase 2:

1. `requireStudioSession()` returns a `StudioViewer` (`{ deviceUserId, staff: { id, role, … } }`).
2. UUID-shape validation on every id input (`assertUuid` helper from `actions.ts`).
3. Service-role Supabase client from `lib/db/admin.ts` for writes.
4. Mutations update through the same `recomputeTicketTotals` helper (extended per research.md § R18) so all cart-affecting actions share one recompute path.
5. `recordAudit(...)` per `contracts/audit.contract.md` on the success branch.

UI-recoverable failures throw typed error subclasses from `app/(studio)/checkout/_errors.ts` whose `code` field the client island renders as banners/toasts.

---

## 1. `setLinePrice(input)`

**Purpose**: Save a price for a variable-priced cart row (US1) OR override the snapshotted price on a confirmed cart row (US2). Replaces the FR-016 placeholder dialog from phase 2.

**Signature**:

```ts
const SetLinePriceInput = z.object({
  ticketId: z.string().uuid(),
  lineId: z.string().uuid(),
  unitPriceCents: z.number().int().positive(),  // strictly > 0; FR-006
});

export async function setLinePrice(
  input: z.infer<typeof SetLinePriceInput>
): Promise<{ subtotalCents: number; totalCents: number }>;
```

**Invariants**:

- Refuses if ticket is not `open` (`TicketNotOpenError`).
- Refuses if `unitPriceCents <= 0` (`InvalidPriceError`). The zod schema catches this client-side; the server-side throw is defense in depth.
- Refuses if the line does not exist on this ticket (`Error("setLinePrice: line … does not belong to ticket …")` — defensive, same pattern as `setLineTech`).
- Refuses if the line has `kind = 'discount'` (`InvalidPriceError("cannot price-override a discount row")`). Discount lines are mutated via `addDiscountLine` / `removeDiscountLine`, not in place.
- Captures the line's current `unit_price_cents` and `price_unconfirmed` for the audit payload (`previous_unit_price_cents`, `was_unconfirmed`) BEFORE the update.
- Updates the line's `unit_price_cents = input.unitPriceCents` and `price_unconfirmed = false` (clearing the flag for both auto-open AND override paths — once a price is saved, the row is confirmed).
- Calls `recomputeTicketTotals(supabase, ticketId)` — the helper folds the new amount into any percent-discount recompute on this ticket.
- Emits `line.price_set`, `entity_id = lineId`, `payload = { ticket_id, previous_unit_price_cents, new_unit_price_cents, was_unconfirmed }`.
- Returns the post-recompute totals so the client can update the footer without an extra roundtrip.

**Why the action is the same for both auto-open and override**: the only behavioral split is the Remove button visibility, which is purely client-side. From the database's perspective, "set this row's price" is the same write whether the row was previously unconfirmed (auto-open) or confirmed (override). The audit payload's `was_unconfirmed` field disambiguates them for downstream reporting.

**Errors**:

- `TicketNotOpenError` → client renders the FR-019-style banner.
- `InvalidPriceError` → inline error in the sheet; sheet stays open.
- ownership-violation `Error` → reload the page (treated as developer error / forged request).

---

## 2. `addDiscountLine(input)`

**Purpose**: Add a discount line to the cart (US3, FR-014, FR-015, FR-016a).

**Signature**:

```ts
const AddDiscountLineInput = z.object({
  ticketId: z.string().uuid(),
  shape: z.enum(["flat", "percent"]),
  // For shape='flat': value is the discount amount in cents (positive int).
  // For shape='percent': value is the whole percent 1..100.
  value: z.number().int().positive(),
  note: z.string().max(80).optional(),
});

export async function addDiscountLine(
  input: z.infer<typeof AddDiscountLineInput>
): Promise<{ lineId: string; subtotalCents: number; totalCents: number }>;
```

**Invariants**:

- Refuses if ticket is not `open` (`TicketNotOpenError`).
- Per-shape validation:
  - `shape = 'flat'`: `value > 0` (any positive integer cents).
  - `shape = 'percent'`: `1 <= value <= 100`.
  - Violations throw `DiscountInvalidError` with a `reason` field (`'flat_value_non_positive' | 'percent_out_of_range' | 'note_too_long'`).
- Reads `discount.manager_threshold_cents` via `getSetting<number | null>('discount.manager_threshold_cents')`. In v1, the returned value is intentionally ignored — the read is wired so phase 8 can plug in the manager-PIN gate at this exact point without further plumbing changes. (FR-018.)
- Builds the row to insert:
  - `kind = 'discount'`
  - `ref_id = null`, `assigned_staff_id = null` (CHECK-enforced)
  - `name_snapshot` from a small helper:
    - flat → `"Discount"`
    - percent → `"Discount · {value}%"`
  - `unit_price_cents`:
    - flat → `-value` (negative cents)
    - percent → `0` initially — `recomputeTicketTotals` writes the correct amount in the same transaction after the insert lands.
  - `qty = 1`
  - `discount_pct`:
    - flat → `null`
    - percent → `value` (e.g., `15.00`)
  - `note = input.note ?? null`
- Inserts the row and captures the new `id`.
- Calls `recomputeTicketTotals(supabase, ticketId)` — this is the step that turns the placeholder `unit_price_cents = 0` for percent discounts into the correct `-round(pct * service_subtotal / 100)`.
- Emits `discount.added`, `entity_id = newLineId`, `payload = { ticket_id, shape, value, note }`.
- Returns `{ lineId, subtotalCents, totalCents }` from the recompute.

**Errors**:

- `TicketNotOpenError`, `DiscountInvalidError` → client renders inline error in the discount sheet; sheet stays open for the operator to correct.

---

## 3. `removeDiscountLine(input)`

**Purpose**: Remove a discount line from the cart (FR-016).

**Signature**:

```ts
const RemoveDiscountLineInput = z.object({
  ticketId: z.string().uuid(),
  lineId: z.string().uuid(),
});

export async function removeDiscountLine(
  input: z.infer<typeof RemoveDiscountLineInput>
): Promise<{ subtotalCents: number; totalCents: number }>;
```

**Invariants**:

- Refuses if ticket is not `open` (`TicketNotOpenError`).
- Refuses if the named line is not on this ticket (`Error`, same pattern as `removeLine`).
- Refuses if the named line is not `kind = 'discount'` (`DiscountInvalidError("not a discount line")`). Removing a service line is done via the existing `removeLine` action.
- Captures the row's `discount_pct`, `unit_price_cents`, and `note` for the audit payload (before delete).
- Deletes the row.
- Calls `recomputeTicketTotals` — any remaining percent discounts will re-recompute against the unchanged service subtotal (no-op if no service-line change happened); the helper still re-derives `tickets.subtotal_cents` and `tickets.total_cents` because the discount line's contribution is gone.
- Emits `discount.removed`, `entity_id = deleted lineId`, `payload = { ticket_id, shape, value, note }` where `shape` is `'percent'` if `discount_pct != null` else `'flat'`, and `value` is `discount_pct` (for percent) or `-unit_price_cents` (for flat — converts back to the positive value originally entered).
- Returns post-recompute totals.

---

## 4. `emailBillStub(input)`

**Purpose**: Stub the "email the bill" affordance (FR-024, FR-025, FR-026) — writes the `bill.emailed` audit row without dispatching real mail. The contract is shaped so that a post-v1 swap to real mail is a body change inside this action; the audit verb and the input shape stay.

**Signature**:

```ts
const EmailBillStubInput = z.object({
  ticketId: z.string().uuid(),
  address: z.string().min(3),  // server-side regex below is the real check
  snapshot: z.object({
    lines: z.array(z.object({
      id: z.string().uuid(),
      kind: z.enum(["service", "discount"]),
      name: z.string(),
      unitPriceCents: z.number().int(),
      qty: z.number().int().positive(),
      note: z.string().nullable(),
      discountPct: z.number().nullable(),
    })),
    serviceSubtotalCents: z.number().int().nonnegative(),
    discountTotalCents: z.number().int().nonpositive(),
    totalCents: z.number().int().nonnegative(),
    capturedAt: z.string(),     // ISO timestamp from the client snapshot helper
  }),
});

export async function emailBillStub(
  input: z.infer<typeof EmailBillStubInput>
): Promise<{ ok: true }>;
```

**Invariants**:

- Validates the address with the shared regex (research.md § R15):

  ```ts
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  ```

  Mirror of the client-side check; the server runs it again as defense in depth (FR-026 second clause).
- On invalid address: throws `EmailAddressInvalidError`. **No audit row is inserted, no toast is shown.**
- On valid address:
  - Calls `recordAudit("bill.emailed", viewer.deviceUserId, input.ticketId, { address: input.address, line_snapshot: input.snapshot }, viewer.staff.id)`.
  - Returns `{ ok: true }`.
- The action does NOT verify that the ticket actually exists at the time of the call — the audit row stands as evidence the operator attempted to email the bill even if the ticket has since been discarded (which would be an odd flow but not a contract violation). Phase 8's manager-PIN flow may tighten this if it ever needs to.
- The action does NOT dispatch any external network call in this phase. No queue insert, no provider API call, no `mail_outbox` row. The audit row is the only persisted evidence the action ran.

**Errors**:

- `EmailAddressInvalidError` → client renders inline error in the email dialog; dialog stays open.

**Why the snapshot is part of the input**: the audit row's `payload.line_snapshot` captures what the operator was actually looking at when they pressed Email — not "what the cart looked like when the audit was inserted." The two could differ if a service line was added/removed between bill-open and email-submit (the bill is read-only by R14, but the cart underneath isn't). The audit row therefore stands as evidence of "the operator emailed THIS bill to THIS address," which is what an owner reviewing audit logs would want to know.

---

## Cross-cutting invariants

- **Operator attribution**: every action reads `viewer.staff.id` for the audit row's `acting_as_staff_id` and `viewer.deviceUserId` for `actor_user_id`, same as phase 2. No additional `taken_by_staff_id` columns are introduced by this phase.
- **No client trust for money**: `addDiscountLine` reads the threshold setting from the database; `setLinePrice` writes the operator-supplied cents but the percent-discount recompute that depends on it runs server-side; `pos_take_cash` continues to re-read `tickets.total_cents` inside its FOR-UPDATE lock so a stale client view cannot charge a different amount than the server has stored.
- **Idempotency**: not needed here (no Square calls, no external API, no webhook). Double-submits on the same `setLinePrice` are safe — the second write reproduces the same value. Double-submits on `addDiscountLine` would create two discount lines; the discount sheet client-side guards with a `pending` flag (same pattern as the tile add-pending in phase 2). Double-submits on `emailBillStub` would write two audit rows — that's intentional in a strict audit-log sense, and the dialog disables Send after click.

---

## Type exports

```ts
// Added to app/(studio)/checkout/_errors.ts:
export type CheckoutActionError =
  | { code: "TICKET_NOT_OPEN" }
  | { code: "TICKET_ALREADY_TERMINAL" }
  | { code: "TICKET_HAS_UNPRICED_ITEMS" }
  | { code: "TICKET_EMPTY" }
  | { code: "STAFF_NOT_ACTIVE" }
  | { code: "SERVICE_ARCHIVED" }
  | { code: "CASH_PAYMENT_FAILED"; pgError?: string }
  // NEW in this phase:
  | { code: "INVALID_PRICE" }
  | { code: "DISCOUNT_INVALID"; reason: "flat_value_non_positive" | "percent_out_of_range" | "note_too_long" | "not_a_discount_line" }
  | { code: "EMAIL_ADDRESS_INVALID" };

export class InvalidPriceError extends CheckoutError {
  readonly code = "INVALID_PRICE" as const;
}

export class DiscountInvalidError extends CheckoutError {
  readonly code = "DISCOUNT_INVALID" as const;
  readonly reason: "flat_value_non_positive" | "percent_out_of_range" | "note_too_long" | "not_a_discount_line";
  constructor(message: string, reason: DiscountInvalidError["reason"]) {
    super(message);
    this.reason = reason;
    this.name = "DiscountInvalidError";
  }
}

export class EmailAddressInvalidError extends CheckoutError {
  readonly code = "EMAIL_ADDRESS_INVALID" as const;
}
```

The error subclasses extend `CheckoutError` (already in `_errors.ts` from phase 2) so the client island's existing `instanceof CheckoutError` narrowing keeps working for the new codes.
