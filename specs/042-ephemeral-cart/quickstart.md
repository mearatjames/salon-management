# Quickstart: Ephemeral Cart

**Feature**: 042-ephemeral-cart | **Date**: 2026-05-18

How a developer or reviewer can exercise this feature end-to-end on a local dev environment.

---

## Prerequisites

1. Tang Nails dev env up: `npm run dev` against a seeded local Supabase (`npx supabase start` from another terminal; the seed includes Test Owner/Manager/Tech, sample services, sample customers).
2. The three prerequisite bugfix issues (#25, #26, #27) MUST be merged to `main` before testing this feature end-to-end. The feature relies on `discardTicket`'s in-flight-payment guard and `pos_record_card_payment`'s late-capture auto-recovery to behave correctly under failure paths.

## 1. Verify the hygiene invariant (SC-001, SC-002, SC-003)

Open two browser windows side-by-side:

- Window A: `npm run dev` at `http://localhost:3000`. Log in, select staff, click "New transaction" on the dashboard.
- Window B: A Supabase Studio query window watching `SELECT id, status, created_at FROM tickets ORDER BY created_at DESC LIMIT 5;`.

Expected:

- Window A is at `/checkout` (no `:ticketId` in URL).
- Window B shows no new `tickets` row.
- Add services, change tech, pick a customer, set a discount — Window B remains unchanged.
- Refresh Window A — the cart is empty.
- Window B still unchanged. **SC-001, SC-002, SC-003 pass.**

## 2. Cash commit (US1, P1)

In Window A:

- Add 2 services, pick a tech, click "Submit Cash", enter cash tendered.
- The UI transitions to the receipt screen at `/checkout/<new-id>`.

In Window B:

```sql
SELECT t.id, t.status, t.total_cents, COUNT(ti.id) AS items, COUNT(p.id) AS payments
FROM tickets t
LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
LEFT JOIN payments p ON p.ticket_id = t.id
GROUP BY t.id ORDER BY t.created_at DESC LIMIT 1;
```

Expected: one row with `status='paid'`, `items=2`, `payments=1`. **US1 acceptance scenario 2 passes.**

Also verify in `audit_log`:

```sql
SELECT action, payload FROM audit_log
WHERE payload->>'ticket_id' = '<new-id>' ORDER BY at;
```

Expected: `ticket.paid` and `payment.captured` rows. No `ticket.created` row.

## 3. Gift card commit (US1)

Similar to step 2 but with "Submit Gift" and a valid GAN. Same atomic outcome with `method='gift'`.

## 4. Square Terminal commit (US2)

For local testing you'll need either a Square Sandbox Terminal device paired or the Sandbox simulator. Otherwise this step is best validated in CI/preview.

In Window A:

- Add services, click "Send to Square Terminal".
- The UI transitions to the existing "waiting for terminal" view at `/checkout/<new-id>`.

In Window B:

```sql
SELECT t.status, p.method, p.status AS payment_status, p.square_terminal_checkout_id
FROM tickets t JOIN payments p ON p.ticket_id = t.id
WHERE t.id = '<new-id>';
```

Expected at this point: `status='open'`, `method='card'`, `payment_status='pending'`, `square_terminal_checkout_id` is populated.

Complete the Sandbox capture; the webhook should fire and flip the ticket to `paid` exactly as today.

### Handoff failure path

Simulate a Square API failure (network drop or invalid device ID). In Window A:

- Click "Send to Square Terminal" with an invalid `deviceId`.
- The UI shows an error toast; the cart is still visible and editable.

In Window B:

```sql
SELECT COUNT(*) FROM tickets WHERE created_at > now() - interval '1 minute';
SELECT COUNT(*) FROM ticket_items WHERE ticket_id = '<would-have-been-id>';
SELECT COUNT(*) FROM payments WHERE ticket_id = '<would-have-been-id>';
```

Expected: all three counts are 0 (rollback succeeded). **SC-006 passes.**

## 5. Split tender commit (US3)

In Window A:

- Add 2+ services, click "Split tender".
- The UI transitions to `/checkout/<new-id>` showing the existing mid-split-tender screen.

In Window B:

```sql
SELECT t.status, COUNT(ti.id) AS items, COUNT(p.id) AS payments
FROM tickets t
LEFT JOIN ticket_items ti ON ti.ticket_id = t.id
LEFT JOIN payments p ON p.ticket_id = t.id
WHERE t.id = '<new-id>'
GROUP BY t.id;
```

Expected: `status='open'`, `items=N`, `payments=0` (legs are inserted as each tender is captured by the existing mid-split UI).

Capture each leg via the existing UI; verify the final state matches a today's split-tender sale.

## 6. Retry-after-failure UX

In Window A:

- Build a multi-item cart.
- (Dev-only) deactivate one of the cart's services in Supabase: `UPDATE services SET active=false WHERE id='<one-of-the-cart-service-ids>';`.
- Click "Submit Cash".
- Expected: error toast referencing `STALE_SERVICE`. Cart remains intact in Window A.
- Re-activate the service: `UPDATE services SET active=true WHERE id='<id>';`.
- Click "Submit Cash" again.
- Expected: success, normal redirect to receipt. **FR-013 passes.**

## 7. No Cancel/Discard buttons on cart-building (FR-006)

In Window A at `/checkout`, inspect `tx-header`:

- Cancel button: NOT rendered.
- Discard button: NOT rendered.

Navigate to a real mid-split-tender ticket at `/checkout/<id>`:

- Discard button: rendered and functional (per FR-007).

## 8. Run the test suite

From the repo root:

```bash
npm run test:e2e -- tests/e2e/checkout-ephemeral-cart.spec.ts
npm test -- tests/unit/checkout
```

Expected: green.

Then the full pre-push gate set (Constitution § Quality Gates):

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

All five MUST pass before the PR is opened.
