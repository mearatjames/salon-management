# Checkout / New Transaction — Phased Build Plan

Source prototypes:
- `design-system/prototypes/transaction/FlowSingle.jsx` (recommended layout)
- `design-system/prototypes/transaction/components.jsx` (shared cart, price sheet, tiles)
- `design-system/prototypes/transaction/FlowSingleExtras.jsx` (bill preview)
- `design-system/prototypes/transaction/TechPicker.jsx`
- `design-system/ui_kits/studio/CheckoutScreen.jsx` (lighter sketch)

Entry points already wired (target route still empty):
- Sidebar "Checkout" → `/checkout` (`components/lacquer/sidebar/nav-items.ts:87`)
- Dashboard "New transaction" CTA → `/checkout` (`components/lacquer/new-transaction-cta.tsx:15`)

## Phase overview

| # | Phase | Why this slice |
|---|---|---|
| 1 | Services catalog (Settings) | Nothing to sell without services. Pure CRUD. |
| 2 | Cash sale MVP | First end-to-end checkout: standalone walk-up ticket, cash only. Demoable. |
| 3 | Cart polish | Variable-price modal, discount lines, restaurant-style bill print. |
| 4 | Client + appointment/walk-in linkage | Connect tickets to real clients; "Seat" from `/walkin` opens a pre-filled checkout. |
| 5 | Square Terminal (card) | OAuth, terminal checkout, webhook + 5s poll fallback. Biggest integration. |
| 6 | Gift card + split tender | Multi-payment composition. |
| 7 | Tip-split dialog | Auto-allocate proportional to each tech's service revenue; editable; writes `tip_splits`. |
| 8 | Voids + refunds | Manager-PIN inline override; Square refunds; cash refund touches the drawer. |
| 9 | Cash drawer + realtime | Open-drawer gate, expected-balance tracking, realtime payment sync per ticket. |

---

## Phase 1 — Services catalog

```
Build the Services catalog management surface under Settings.

What it does: lets an owner/manager add, edit, archive, and re-order the
services the salon sells (e.g. Gel polish, Classic manicure, Nail art).
Each service has a name, default duration (minutes), default price (cents),
a category, a Lacquer color token, an `active` flag, and a `taxable` flag
(reserved for future tax computation — no UI effect in v1). A service can be
flagged "variable price" with optional `price_from` / `price_to` bounds and a
note shown in the variable-price sheet later.

Also captures **per-tech duration overrides** (`staff_services` join table):
in the service edit view, pick which staff can perform this service and
optionally set a per-tech duration that overrides the default.

Entry point: `/settings/services` (a new tab under Settings, sibling of the
existing staff management page).

Reuse from `design-system/`:
- Lacquer Settings page chrome (header, tab strip, two-column layout)
- Existing staff management UI patterns at `app/(studio)/settings/staff` as a
  template for list + drawer pattern and audit-log writes

DB: new `services` table and `staff_services` join (per the data model in
`docs/system-design.md`). Migration is part of this phase.

Authorization: only owner/manager can write; technicians/front_desk can read.
Privileged writes go through a Server Action that checks
`staff.role` for the current `acting_as_staff_id` and writes an
`audit_log` row with `action='settings.updated'`.

Out of scope for this phase:
- Square catalog sync (services are local-only for now)
- Tax computation / tax rate UI
- Service photos / marketing copy
- Reordering UX beyond a simple list sort (drag-drop deferred)
```

---

## Phase 2 — Cash sale MVP

```
Build the new-transaction checkout flow — cash-only, fresh standalone
ticket, no client or appointment attached yet.

User story: front desk taps "New transaction" on the dashboard (or
"Checkout" in the sidebar). They land in the single-screen cart. They pick a
tech, tap services from the tile grid to add them, see the running cart,
choose Cash, mark the cash received, and see a "Charged $X" confirmation
with a "New sale" button.

Entry points:
- Dashboard `NewTransactionCTA` → `/checkout` → server action creates an
  empty ticket (`tickets` row, `status='open'`, no `client_id`, no
  `appointment_id`) → redirect to `/checkout/[ticketId]`.
- Sidebar "Checkout" item → same behavior: if no open ticket for the
  operator, create one and redirect; if there's an open ticket from this
  operator's last session, resume it.

The page is `app/(studio)/checkout/[ticketId]/page.tsx`. Reuse the layout
from `design-system/prototypes/transaction/FlowSingle.jsx` — adapt JSX, do
not redraw. Specifically port these components into
`components/lacquer/checkout/`:
- `TxHeader` (header with cancel)
- `TechAvatarRow` (single-select up front, collapses to a chip with
  "Change" link once a tech is picked)
- `ServiceTiles` (search, category chips, tile grid)
- `CartRowWithTech` (per-line tech chip override, price + remove)
- `PaymentTiles` (only `cash` enabled in this phase; card / gift / split
  rendered disabled with a "Coming soon" tooltip so the visual layout
  matches the prototype)
- `Totals` block (subtotal, tax = $0 in v1, total)
- `DoneScreen` (Charged $X confirmation, "New sale" button)

Behavior:
- Adding a service inserts a `ticket_items` row with `kind='service'`,
  snapshotted `name`, `unit_price_cents`, qty 1; assigns the row to the
  currently-selected tech (defaults to first chosen, overridable via the
  chip popover on the row).
- Variable-price services land in the cart with `priceUnconfirmed=true` —
  for this phase, the Charge button is disabled with the hint "Set price on
  highlighted items" and tapping the row's price button just opens a
  placeholder dialog ("Variable pricing is part of the next checkout
  phase"). Full variable-pricing modal comes in phase 3.
- Cash flow: tapping "Take cash · $X" inserts a `payments` row with
  `method='cash'`, `kind='payment'`, `status='succeeded'`, then flips
  `tickets.status` to `paid`, then renders DoneScreen. No tip is captured
  (cash tips are not reported through the app — matches prototype).
- "New sale" on DoneScreen creates a fresh ticket and routes there.

DB: new `tickets`, `ticket_items`, `payments` tables per
`docs/system-design.md` data model. Migration in this phase. `appointments`
schema is also added so `tickets.appointment_id` FK is satisfied, but no
appointments UI yet — `appointment_id` is nullable for now.

Realtime / multi-device: NOT in this phase (added in phase 9). Optimistic
client-side updates only.

Receipt: a minimal in-browser printable receipt at `/checkout/[ticketId]/receipt`
that uses browser print. No PDF library.

Out of scope:
- Variable-price modal, discount lines, bill preview (phase 3)
- Client lookup / attach, walk-in seeding, appointment seeding (phase 4)
- Square / card / gift card / split tender (phases 5–6)
- Tip-split dialog (phase 7)
- Voids / refunds (phase 8)
- Cash drawer "open session" gate (phase 9 — for this phase, cash sales
  are accepted without a drawer session and we leave the drawer-tracking
  TODO inline)
- Realtime payment sync (phase 9)
```

---

## Phase 3 — Cart polish (variable pricing, discounts, bill preview)

```
Add the cart-side polish to the existing single-screen checkout: variable
pricing, discount lines, and a restaurant-style "drop the bill" preview that
prints or emails before payment is taken.

Builds on phase 2's `/checkout/[ticketId]` page.

Variable-price sheet:
- Reuse the `PriceSheet` component from
  `design-system/prototypes/transaction/components.jsx`.
- Triggered automatically when adding a service flagged `variable=true`
  (the cart row stays in `priceUnconfirmed` state and the Charge button
  shows "Set price on highlighted items" until resolved).
- Also opened by tapping the price button on any cart row to override the
  snapshotted price for this sale only.
- Includes quick adjusters (−$10, −$5, +$5, +$10, +$20), preset chips (when
  the service defines `presets`), and a collapsible numpad.
- "Remove" is shown only when the row is in `priceUnconfirmed` state.

Discount line:
- A "+ Discount" affordance in the cart header opens a small sheet to add a
  discount as a `ticket_items` row with `kind='discount'`. Two shapes:
  flat amount (negative `unit_price_cents`) or percent (stores
  `discount_pct` and recomputes amount from the current subtotal of
  service lines).
- Manager-PIN gate threshold is configurable via the
  `discount.manager_threshold_cents` setting (null in v1 = no threshold,
  any discount allowed without override). Wire the read but skip the
  manager-PIN UI here — it lands in phase 8 along with refunds.

Bill preview (restaurant-style):
- Reuse `BillSheet` from
  `design-system/prototypes/transaction/FlowSingleExtras.jsx`.
- Opens from the "Bill" button in the cart footer (next to Charge).
- Renders an itemized check with suggested gratuity rows (18% / 20% /
  25%).
- "Print bill" uses `window.print()` with a print-only CSS sheet so only
  the bill renders.
- "Email" opens a small email-address dialog. For this phase, log to
  `audit_log` (`action='bill.emailed'`) and show a success toast; do NOT
  actually send mail — wire a stub Server Action that returns success
  (real email integration is post-v1).
- Salon name/address/phone come from the `settings` table (seed sensible
  defaults; admin edit UI is out of scope here).

DB: extend `ticket_items` per data model (add `discount_pct`,
`kind='discount'` enum value). `services` table gains `variable`,
`price_from`, `price_to`, `note`, `presets jsonb` columns. Migration in
this phase.

Out of scope:
- Manager-PIN gate (phase 8)
- Real outbound email (post-v1)
```

---

## Phase 4 — Client attach + appointment/walk-in linkage

```
Connect tickets to real clients, and make the existing walk-in waitlist and
calendar appointments seed the checkout cart.

Three entry paths into `/checkout/[ticketId]`, all attaching a `client_id`:

1. **From `/walkin` "Seat" button**: server action creates an
   `appointment` (source='walk_in', status='checked_in', staff_id from the
   waitlist row's requested_staff_id if present), creates a ticket linked
   to that appointment, seeds cart from `appointment_services` (in this
   case, the single requested service from the walk-in if any), and
   redirects to `/checkout/[ticketId]`.

2. **From `/calendar` "Check out" action on an appointment**: server action
   creates a ticket linked to that appointment, seeds cart from
   `appointment_services`, copies `appointment.staff_id` as the default
   tech for each cart row.

3. **From the dashboard "New transaction" CTA (existing entry)**: now
   opens a client picker before creating the ticket. The picker is a
   command-palette-style search by phone (E.164) or name with a "+ New
   client" inline-create option. Selecting a client creates the ticket
   with `client_id` set and routes to `/checkout/[ticketId]`. There is also
   a "Skip — walk-up sale" link that creates a ticket with no client
   (preserves phase 2's behavior).

Header: the `TxHeader` in the checkout page now shows the attached client
name + phone + linked appointment summary when present (e.g. "Maya Patel ·
Gel polish appt at 2:55 PM"). The header gets an "Edit client" link that
opens the picker to swap.

DB: full `clients`, `appointments`, `appointment_services`, `walk_ins`
tables per data model — migrations in this phase if they don't yet exist
from earlier features. `tickets.client_id`, `tickets.appointment_id`,
`tickets.walk_in_id` are wired.

Reuse:
- `prototypes/walkin/StaffWaitlist.jsx` for the "Seat" interaction (the
  walk-in page may already exist; just wire the new server action).
- shadcn `<Command>` for the client picker.

Out of scope:
- Full client detail/CRM page (separate feature)
- Calendar drag-drop (separate feature)
- Square customer sync
```

---

## Phase 5 — Square Terminal (card payment)

```
Add Square Terminal card payment to the existing checkout. This is the
single biggest integration phase — OAuth, terminal cloud-to-device, webhook
+ 5s polling fallback.

User story: at checkout, front desk picks Card (or the only-card "Charge"
default), taps "Send to Square Terminal · $X". The chosen terminal device
displays the amount and tip prompt; the customer taps/inserts their card
and chooses a tip on the device. When the webhook fires, the ticket flips
to paid and the cart screen advances to the Done state.

Pieces:

1. **Settings → Square OAuth tab** at `/settings/square`:
   - "Connect Square" button starts the OAuth flow (sandbox in dev).
   - On callback, encrypt access/refresh tokens with pgcrypto (key in
     Supabase Vault, exposed as GUC `app.square_oauth_key`) and store in
     `square_oauth`.
   - Lists Square terminal devices via `terminals.listDevices`; lets the
     owner give each one a friendly name (stored in a `square_devices`
     table keyed by Square device id).
   - "Reconnect" / "Disconnect" actions.
   - Daily Vercel Cron refreshes the access token before expiry.

2. **`lib/square/`** wrappers:
   - `oauth.ts` — token read/write with decryption helper
   - `terminal.ts` — `createCheckout`, `getCheckout`
   - `webhooks.ts` — signature verification against
     `SQUARE_WEBHOOK_SIGNATURE_KEY`
   - All calls use deterministic idempotency keys:
     terminal checkouts → `${ticket_id}:${payment_id}`

3. **Checkout flow update**:
   - Reuse the `stage = 'waiting'` screen from `FlowSingle.jsx` (lines
     127–148) with the Square Terminal glyph and "Hand the terminal to
     your client" copy.
   - The waiting page subscribes via Supabase Realtime to
     `payments.status` updates for the open ticket (this is the only
     realtime channel we add in this phase; broader payment realtime is
     phase 9).
   - 5s polling fallback to `/api/square/terminal-checkout/[id]` while
     status is `pending` — same pattern documented in
     `docs/system-design.md` § "Square integration details".
   - "Cancel and pick a different method" link calls
     `terminals.cancelCheckout` and returns to cart.

4. **Webhook handler** at `app/api/webhooks/square/route.ts`:
   - Verifies signature (return 401 if invalid).
   - Handles `terminal.checkout.updated` events: updates
     `payments.status` (`succeeded` | `failed`), captures tip from the
     Square Terminal response (the device collects tip — we store it
     server-side as `payments.tip_cents`), flips
     `tickets.status='paid'` when total payments cover the ticket.
   - Idempotent: replaying the same webhook is a no-op.

5. **Sandbox developer setup**:
   - Document tunneling webhooks with `cloudflared tunnel` to
     `localhost:3000/api/webhooks/square`.
   - Add Square Sandbox env vars to `.env.example`.

DB: new `square_oauth`, `square_devices` tables; `payments` gains
`square_payment_id`, `square_terminal_checkout_id`, `raw jsonb`
columns. Migration in this phase.

Out of scope:
- Gift card redemption (phase 6)
- Split tender (phase 6)
- Refunds (phase 8)
- Selling gift cards (post-v1)
```

---

## Phase 6 — Gift card redemption + split tender

```
Add Square gift card redemption and split-tender (multiple payments
composing one ticket).

Gift card:
- New payment method tile: "Gift card".
- On select, prompt for the GAN (gift card number) via a numpad sheet.
- Server action calls Square `giftCards.retrieveGiftCardFromGAN` to fetch
  current balance; render "$X available on this card".
- If balance ≥ amount-due, create a Square `payments.create` with
  `source_id` = gift card id for the full due amount. Same
  webhook-completion path as card (phase 5).
- If balance < amount-due, create a Square payment for the available
  balance and leave the ticket in a "split needed" state — the cart footer
  shows "Owes $Y" with the payment tiles re-enabled so the user can pick a
  second method.
- Cache the gift card row in `gift_cards` (square_gan unique,
  balance_cents_cached, last_synced_at).

Split tender:
- A "Split" link in the payment tile row (visible in `FlowSingle.jsx:227`)
  switches the cart footer into split mode.
- In split mode, the user composes 2+ payment legs by entering an amount
  per leg and picking a method per leg. Running totals show "Paid $X of
  $Y · Owes $Z".
- Each leg follows its method's flow when activated (cash → instant
  succeeded; card → send to terminal with the leg amount; gift → GAN
  prompt). When all legs sum to total and all succeeded, the ticket flips
  to paid.
- Cancel/remove a pending leg before activation; succeeded legs can only
  be reversed via refund (phase 8).

DB: `gift_cards` table. `payments` already supports multiple rows per
ticket from earlier phases — verify the migration models the per-leg
amounts correctly.

Idempotency: each leg's Square call uses
`${ticket_id}:${payment_id}` as its idempotency key.

Out of scope:
- Selling / issuing gift cards (post-v1; redeem only)
- Apple Pay / digital wallets on the terminal (covered automatically by
  Square Terminal; no extra UI here)
```

---

## Phase 7 — Tip-split dialog

```
After a multi-tech ticket is paid, surface a tip-allocation review dialog
and persist the splits to the database. Also expose an "Edit splits" entry
point from End-of-Day until the day is closed.

Trigger: when the last payment on a ticket succeeds and the cart advances
to DoneScreen, BEFORE showing the Charged-$X confirmation, render the
tip-split dialog if the ticket has services from 2+ distinct techs and a
total tip > 0.

Auto-allocation rule (per `docs/system-design.md`): for each payment on the
ticket, distribute `payment.tip_cents` to each tech proportional to that
tech's service revenue on the ticket (i.e. the sum of that tech's service
line `unit_price_cents * qty`). The dialog seeds editable rows from this
auto-allocation.

Dialog UI:
- One row per (payment, tech) combination, showing avatar, tech name,
  service-revenue context, and an editable tip amount.
- Real-time validation: sum of editable rows for each payment must equal
  that payment's `tip_cents`. Show inline error and disable Confirm until
  balanced.
- "Reset to auto" link reseeds from the proportional rule.
- "Confirm" writes `tip_splits` rows (delete existing rows for these
  payments first, then insert the new set) inside a Server Action,
  records `audit_log` (`action='tipsplit.set'`), and proceeds to
  DoneScreen.

Re-edit until day close:
- Add a Tips tab to `/end-of-day` that lists all tickets from today with
  multi-tech tip splits. Each row opens the same dialog read-only/editable
  depending on whether the day has been closed (see phase 9 for the close
  action — for now, treat the day as never closed and always editable).

Single-tech tickets skip the dialog and auto-write a single
`tip_splits` row covering each payment's full `tip_cents`.

DB: `tip_splits` table per data model. Migration in this phase.

Out of scope:
- Manager-only override of locked splits (post-close edit is implicitly
  disabled by phase 9's close action; no explicit unlock UI)
- Commission reporting UI (post-v1)
```

---

## Phase 8 — Voids + refunds (manager-PIN inline override)

```
Add the privileged-action paths: same-day voids and any-time refunds, both
gated by a manager-PIN inline override.

Manager-PIN override component:
- Reusable `<ManagerPinDialog />` in `components/lacquer/`. Anyone can
  initiate an action; at submission, a PIN keypad dialog (reuse the
  existing `pin-keypad.tsx`) asks for an owner-or-manager PIN.
- Server action `verifyManagerPin(pin)` checks `staff.pin_hash` against
  active owner/manager rows and returns either the authorizing
  `staff_id` or an error. No lockout (matches v1 policy in
  `docs/system-design.md`).
- The authorizing staff_id is passed into the wrapping Server Action so
  it can be persisted on the relevant row.

Same-day void (ticket not yet closed for the day):
- On a paid (or partially-paid) ticket, "Void sale" action in the
  checkout page → manager-PIN dialog → server action:
  1. For each completed `payments` row, create a corresponding
     `kind='refund'` payment.
  2. For card/gift payments, call Square `refunds.create` with
     idempotency key `${payment_id}:refund:${refund_payment_id}`.
  3. For cash payments, write the refund row (drawer adjustment is
     handled by phase 9 once the drawer session exists).
  4. Set `tickets.status='void'`.
  5. Write `audit_log` (`action='void.issued'`) capturing both the
     operator (`acting_as_staff_id`) and the authorizing manager
     (`authorized_by_staff_id`).

Post-close refund (full or partial):
- From the existing recent-transactions feed on the dashboard and from
  the End-of-Day day report, "Refund" opens a refund composition sheet:
  - Pick which payments to refund (one or more, full or partial)
  - Enter refund amounts per payment (sum ≤ that payment's
    `amount_cents`)
- Submit → manager-PIN dialog → server action creates
  `kind='refund'` payments with `refunds_payment_id` pointing at the
  originals; Square refunds issued for card/gift; cash refund handled
  inline by phase 9.
- Ticket status becomes `partially_refunded` or `refunded` based on
  remaining balance.

Discount manager-PIN gate (deferred from phase 3): if
`settings.discount.manager_threshold_cents` is non-null and a discount
line exceeds the threshold, require the manager-PIN dialog before
accepting the discount.

Out of scope:
- Re-opening a voided ticket (you'd re-ring; no undo of void)
- Refund without an original payment (e.g. goodwill credit) — post-v1
```

---

## Phase 9 — Cash drawer + realtime polish

```
Wire up the cash drawer session that ties cash sales/refunds to a single
salon-wide drawer, and add multi-device realtime sync to the checkout
page.

Cash drawer session:
- New "Open drawer" action on `/end-of-day` (and inline prompt on the
  first cash sale of the day): opens a `cash_drawer_sessions` row with
  `opened_by_staff_id`, `opening_cents` (counted starting cash).
- Enforce at most one open session via a partial unique index on
  `closed_at IS NULL`.
- Every cash `payments` row increments the session's expected balance;
  every cash refund decrements it.
- Phase 8's cash refund now adjusts the currently-open drawer session
  (or refuses if no session is open, with a "Open the drawer first"
  prompt).
- "Close drawer" action prompts for counted cash, computes
  `variance = counted - expected`, writes `counted_cents`,
  `variance_cents`, `closed_by_staff_id`, `closed_at`.
- The End-of-Day report page reads from this session for its cash
  reconciliation section.

Day close lockout:
- Closing the drawer also locks tip-split edits for that day (phase 7's
  "always editable" assumption is replaced with "editable until the
  drawer session that covers this ticket is closed").

Realtime payment sync:
- On `/checkout/[ticketId]`, subscribe to `postgres_changes` on
  `payments` filtered by this ticket. Any update invalidates the
  TanStack Query cache so multiple operators looking at the same ticket
  see consistent state.
- Add a connection-status indicator that uses the existing
  `ReconnectingBanner` pattern when the realtime channel drops.

DB: `cash_drawer_sessions` table per data model with the partial unique
index. Migration in this phase.

Out of scope:
- Multiple drawers / per-station drawers (single salon-wide drawer in
  v1)
- Server-side webhook-sweep cron (the 5s polling fallback from phase 5
  remains the only safety net in v1)
```
