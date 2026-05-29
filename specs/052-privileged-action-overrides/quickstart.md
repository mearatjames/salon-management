# Quickstart: Voids & Refunds

Exercise both paths against a local Supabase + seed.

## Prereqs

- Local stack up: `supabase start`; app on `npm run dev`.
- Migration applied: `supabase db reset` (runs `0025_void_refund.sql` + reseed).
- Square in sandbox (card/gift refunds) — or use a cash ticket to exercise the DB path without a Square call.
- Sign in and switch to a staff member whose role is **owner** or **manager** (only they see the actions).

## Same-day void (Story 1)

1. Ring a fresh ticket and pay it (cash is simplest): checkout → add service → take cash. Land on the paid `DoneScreen`.
2. As owner/manager, click **Void sale** → confirm in the dialog.
3. Verify:
   - The ticket now reads voided.
   - `select status from tickets where id = '<id>'` → `void`.
   - `select kind, method, amount_cents, refunds_payment_id from payments where ticket_id='<id>'` → an original `payment` row **and** a mirrored `refund` row (same method/amount, `refunds_payment_id` set).
   - `select action, acting_as_staff_id, payload from audit_log where entity_id='<id>' order by ts desc limit 1` → `payment.void_issued`, acting staff = your owner/manager.
4. As a **technician**, confirm **Void sale** is not shown, and a direct `voidSale` call is refused (`PermissionDeniedError`).
5. Prior-day ticket: confirm **Void sale** is absent (refund path only).

## Refund — full & partial (Story 2)

1. From **Dashboard → Recent transactions** (or **End of Day → day report**), as owner/manager open a past paid ticket's receipt drawer and choose **Refund**.
2. Partial: enter an amount **less** than one payment, submit.
   - Ticket reads partially refunded; `select status` → `partially_refunded`.
   - A `kind='refund'` row for exactly that amount exists; remaining = original − refunded.
   - Entering more than the remaining is blocked by the sheet; a forced over-amount is refused server-side (`RefundExceedsRemainingError`).
3. Refund the rest → ticket reads refunded; `select status` → `refunded`.
4. `audit_log` shows `payment.refund_issued` with `resulting_status` matching each step.
5. Card/gift in sandbox: confirm `square_refund_id` is set on the refund row after settlement; simulate a Square failure (disconnect/sandbox error) and confirm the ticket status is **unchanged** and a `SquareRefundFailedError` surfaces (SC-007).

## Tests

```bash
npm run test:changed          # unit: refund-status + square refund wrapper
npx playwright test tests/e2e/void-sale.spec.ts
npx playwright test tests/e2e/refund-ticket.spec.ts
```

Final gate before PR: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`.
