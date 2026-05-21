# Contract: Server Actions

File: `app/(studio)/payroll/actions.ts` (`"use server"`). Plus an **extension** to `app/(studio)/settings/staff/actions.ts::updateStaff`.

Every action follows the established prelude (see `app/(studio)/end-of-day/actions.ts`):
1. `requireStudioSession()` → `viewer` (throws `AuthRedirectError` if unauthenticated).
2. Role gate — return a `FORBIDDEN` result if the role is not allowed.
3. Parse + validate input.
4. Recompute authoritative figures server-side (never trust the client with money).
5. Call the RPC via `createSupabaseServiceRoleClient()`.
6. Map any Postgres error to a result code.
7. `revalidatePath()` the affected routes.
8. Return a discriminated result.

Shared result shape:

```ts
type ActionResult<T = {}> =
  | ({ ok: true } & T)
  | { ok: false; code: PayrollErrorCode; message: string };

type PayrollErrorCode =
  | "FORBIDDEN" | "PERIOD_CLOSED" | "ALREADY_PAID"
  | "NOT_PAID" | "INVALID" | "UNEXPECTED";
```

---

## `recordPayout` — US3

```ts
recordPayout(input: {
  payPeriodId: string;
  staffId: string;
  method: "cash" | "zelle" | "check";
}): Promise<ActionResult<{ payoutId: string }>>
```

- **Allowed roles**: `owner`, `manager`.
- Recompute the tech's payroll figures fresh via `lib/payroll/aggregate` for the period window (do **not** trust any client figures). If the tech is not eligible (earnings = 0) → `INVALID`. Resolve `paid_on` = today in `SALON_TZ`.
- Call `payroll_record_payout` with the freshly computed snapshot.
- `revalidatePath("/payroll")` and `revalidatePath("/payroll/" + staffId)`.

## `undoPayout` — US3

```ts
undoPayout(input: {
  payPeriodId: string;
  staffId: string;
}): Promise<ActionResult>
```

- **Allowed roles**: `owner`, `manager`.
- Call `payroll_undo_payout`. `revalidatePath` `/payroll` and `/payroll/[staffId]`.

## `closePeriod` — US4

```ts
closePeriod(input: {
  payPeriodId: string;
  confirmedUnpaid: boolean;   // true when the owner confirmed the unpaid-techs warning
}): Promise<ActionResult>
```

- **Allowed roles**: `owner` **only** (manager → `FORBIDDEN`).
- Recompute the period's full ledger. If eligible-but-unpaid techs exist and `confirmedUnpaid` is false → return `{ ok: false, code: "INVALID", message: "<n> techs are still unpaid: …" }` so the UI can show the confirmation dialog (FR-030).
- Build `p_frozen_rows` (the eligible-unpaid snapshots) and `p_period_totals`, call `payroll_close_period`.
- `revalidatePath("/payroll")`.

## `updateStaff` (extension) — US5

`app/(studio)/settings/staff/actions.ts::updateStaff` gains three fields in its FormData parse, validation, diff, and `UPDATE`:

| Field | Validation (`_validation.ts`) |
|-------|-------------------------------|
| `service_commission_pct` | number, 0–100 in the UI, stored as a 0–1 fraction; reject outside range |
| `tip_split_pct` | number, 0–100 in the UI, stored as a 0–1 fraction; reject outside range |
| `check_portion_cents` | integer cents ≥ 0; reject negative / non-numeric |

- **Allowed roles for these three fields**: `owner` **only**. A manager editing other staff fields stays allowed; attempting to change a payroll-rate field as a manager → the field is rejected from the diff (or the action returns `FORBIDDEN` if a rate field changed). The owner-only rule is added to `app/(studio)/settings/staff/permissions.ts`.
- The three fields join the existing `staff.updated` audit diff payload — satisfies FR-035; no new audit action.
- `revalidatePath("/settings/staff")` and `revalidatePath("/payroll")` (so the open period reflects the new rate — FR-034 / SC-007).

---

## CSV export — US1 (not a Server Action)

Client-side, mirroring `report-actions.client.tsx`: `components/lacquer/payroll/payroll-export.client.tsx` calls `buildPayrollCsv(readModel)` from `lib/payroll/csv.ts` and triggers a `data:text/csv` download (`Payroll-<period label>.csv`). No server round-trip; the read model is already on the page.
