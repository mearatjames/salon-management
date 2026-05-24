# Phase 1 — Data Model

This feature **adds no tables, no columns, no indexes, no triggers, no
RLS policies, and no migrations.** It mutates exactly one existing
column and writes one new kind of audit row.

The Phase 0 (`research.md`) decisions inform every shape below.

---

## Entities read

### `tickets`
Existing. Defined in `supabase/migrations/0004_checkout_cash_sale.sql`.
Columns read by this feature:

| Column | Type | Why we read it |
|---|---|---|
| `id` | `uuid` | Identify the target ticket. |
| `status` | `public.ticket_status` enum (`open` / `paid` / `discarded`) | FR-012 (b) — gate: `status = 'paid'`. |
| `closed_at` | `timestamptz` | FR-002 — input to the pay-period resolution. |

Constraints already on the table guarantee `closed_at IS NOT NULL`
whenever `status = 'paid'` (migration 0004 line 79), so the action can
treat `closed_at` as present after the paid-state gate succeeds.

### `ticket_items`
Existing. Defined in migration `0004_checkout_cash_sale.sql`, relaxed in
`0007_cart_polish.sql` (line 25 — `assigned_staff_id` is nullable).
Columns read by this feature:

| Column | Type | Why we read it |
|---|---|---|
| `id` | `uuid` | Identify the line. |
| `ticket_id` | `uuid` | Defensive verify the line belongs to the ticket. |
| `assigned_staff_id` | `uuid` (nullable) | Previous value for the audit payload (and no-op comparison). |

### `staff`
Existing. Columns read:

| Column | Type | Why we read it |
|---|---|---|
| `id` | `uuid` | Identify the new tech. |
| `active` | `bool` | FR-012 (d) — gate: `active = true`. |

### `pay_periods`
Existing. Defined in `supabase/migrations/0021_payroll.sql`.
Columns read by `isPayPeriodFinalized`:

| Column | Type | Why we read it |
|---|---|---|
| `id` | `uuid` | Used to filter `payroll_payouts`. |
| `starts_on` | `date` | Lookup key — matches `PayPeriodRef.startsOn`. |
| `status` | `public.pay_period_status` enum (`open` / `closed`) | Lock signal (a). |

If no row exists for the resolved `starts_on`, the period is **not**
finalized — no payouts can exist without the period row. The helper
returns `false` early in that branch.

### `payroll_payouts`
Existing. Defined in `supabase/migrations/0021_payroll.sql`.
Columns read by `isPayPeriodFinalized`:

| Column | Type | Why we read it |
|---|---|---|
| `pay_period_id` | `uuid` | Existence check keyed by the resolved period id. Lock signal (b). |

The helper uses `select('id').limit(1)` — we only need to know if *any*
row exists, not how many.

---

## The single column written

`ticket_items.assigned_staff_id` — `uuid` (nullable since
0007_cart_polish.sql).

The Server Action issues exactly one `UPDATE` of the form:

```sql
UPDATE public.ticket_items
SET assigned_staff_id = $1
WHERE id = $2;
```

No other column on `ticket_items` is read for write, and no other table
is mutated by the update phase. Money fields (`unit_price_cents`,
`qty`), discount fields (`discount_pct`), and snapshot fields
(`name_snapshot`) are all untouched (FR-007, SC-006).

The no-op branch (FR-013, when the incoming `assignedStaffId` equals
the row's current `assigned_staff_id`) does **not** issue this
`UPDATE`.

---

## Audit log row written by this feature

Existing table `public.audit_log` (defined in
`supabase/migrations/0001_auth_schema.sql:37–52`). Each successful,
non-no-op reassignment writes **exactly one** row via the existing
`recordAudit(...)` helper in `lib/auth/audit.ts:158–185`.

The new `AuditAction` literal added to the union in `lib/auth/audit.ts`
is `"ticket.line_tech_reassigned"`.

### Row shape

| `audit_log` column | Value written | Source / FR clause |
|---|---|---|
| `ts` | `now()` (DB default) | n/a |
| `actor_user_id` | `viewer.deviceUserId` | The Supabase auth uid on the device. FR-011 *"the acting user."* |
| `acting_as_staff_id` | `viewer.staff.id` | The signed `acting_as_staff_id` cookie identity. FR-011 *"the acting user."* |
| `action` | `"ticket.line_tech_reassigned"` | New literal — FR-010 *"distinct from the audit action used for checkout-time assignment."* |
| `entity_type` | `"ticket_item"` | Matches the existing `setLineTech` audit's entity. |
| `entity_id` | `input.lineId` | The line that was reassigned. |
| `payload` | JSON — see below | FR-011 fields. |

### Payload shape

```jsonc
{
  "ticket_id": "<uuid>",                 // FR-011
  "previous_staff_id": "<uuid> | null",  // FR-011 — null when the line was previously unassigned (FR-006)
  "new_staff_id": "<uuid>",              // FR-011
  "closed_at": "<ISO 8601 UTC>",         // FR-011 — the ticket's closed_at
  "pay_period_start": "YYYY-MM-DD"       // FR-011 — pay_periods.starts_on (salon-local calendar date)
}
```

The `acting_as_staff_id` already lives in its own top-level column on
`audit_log`; we do not duplicate it inside `payload`.

The shape is **deliberately a strict superset** of the existing
`ticket.line_tech_assigned` payload (which carries
`ticket_id`/`previous_staff_id`/`new_staff_id` only — see
`app/(studio)/checkout/actions.ts:632`) so anyone querying both actions
can normalize. The two extra fields (`closed_at`, `pay_period_start`)
are the audit-trail anchors a payroll dispute investigator needs to
reconstruct which period a correction belongs to.

### Rows written when **not** to write

Zero `audit_log` rows are written when:
- The action is rejected for any of the six gate reasons (FR-012).
- The action is a no-op because `assigned_staff_id` already equals the
  input (FR-013).

This is enforced by ordering the `recordAudit` call **after** every
gate and **after** the no-op short-circuit in the action body.

---

## Read model extensions (drawer plumbing)

The drawer needs two new pieces of information to render the right
chip state. Both are computed on the server (Principle II) inside the
existing Transactions page load, threaded as props.

### `TransactionDetail` (extended)

Defined in `lib/transactions/aggregate.ts`. Two new fields:

```ts
type TransactionDetail = {
  // ...existing fields (id, displayId, items, totals, etc.)...
  items: ReadonlyArray<{
    // ...existing fields (kind, name, lineTotalCents, qty, techId, ...)...
    lineId: string;        // NEW — stable id for the per-line picker submit
  }>;
  payPeriodFinalized: boolean; // NEW — true iff isPayPeriodFinalized returned true for this ticket
};
```

`lineId` is `ticket_items.id`; it is already in the underlying query
result but is not currently surfaced on `TransactionDetail.items`.
The change to `lib/transactions/queries.ts` is one select-list addition
and one mapping addition — no new query.

### Viewer-role prop

The Transactions page (`app/(studio)/transactions/page.tsx`) passes
the viewer's role down as a top-level prop to
`<TransactionsView viewerRole="owner" | "manager" | "tech" | "frontdesk" | "kiosk" | ...>` (the existing `StudioViewer.staff.role` type).
The drawer reads it from the view and uses it to gate the "Change"
trigger:

```ts
const canEdit =
  (viewerRole === "owner" || viewerRole === "manager") &&
  !transaction.payPeriodFinalized;
```

The boolean is computed in the parent `<ReceiptDrawer>` and passed to
each `<ReceiptLineTechChip>` along with the per-line data.

### Per-period finality cache

The page loads N `TransactionDetail` rows spanning M ≤ N distinct pay
periods (each period covering a half-month, so M is typically 1, with
edge cases of 2 at the period boundary). To avoid N database round-trips
the page computes a `Map<string /* startsOn */, boolean /* finalized */>`
populated by **one** `isPayPeriodFinalized(...)` call per distinct
`startsOn`, then stamps each transaction's `payPeriodFinalized` from
the map. The cache lifetime is one render of the page (in-memory).

---

## Helper added

`lib/payroll/finalized.ts` — single small file, two exports:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePayPeriod, type PayPeriodRef } from "@/lib/payroll/window";
import { SALON_TZ } from "@/lib/time/tz"; // or wherever the salon tz lives today

/**
 * Resolves the PayPeriodRef for the period containing `closedAt`.
 * Pure — no DB. Reuses the existing window math.
 */
export function payPeriodForClosedAt(closedAt: Date | string): PayPeriodRef;

/**
 * True iff:
 *   - a pay_periods row exists for ref.startsOn AND
 *   - either ( row.status = 'closed' )
 *     OR ( ≥1 payroll_payouts row references row.id )
 */
export async function isPayPeriodFinalized(
  supabase: AnySupabase,
  ref: PayPeriodRef
): Promise<boolean>;
```

Unit-tested independently (see `tests/unit/payroll/finalized.test.ts`)
so the rule is fixed in code and a future migration of the lock
semantics has one place to change.
