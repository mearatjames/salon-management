# Ephemeral cart — `/speckit-specify` prompt draft

Working draft of the natural-language prompt to feed `/speckit-specify` for
the in-memory / ephemeral checkout cart refactor. Tweak before pasting.

## How to use

1. Run `/speckit-specify` and paste the **prompt block** below (between the
   horizontal rules). It generates `specs/NNN-ephemeral-cart/spec.md` on a
   new feature branch.
2. Run `/speckit-clarify` next — it surfaces the open questions and prompts
   you for answers, then embeds them in the spec.
3. From there: `/speckit-plan` → `/speckit-tasks` → and the resulting
   `tasks.md` is what the agent loop can execute phase by phase overnight.

## Two things to consider tweaking before pasting

- **Open question #1 (Square Terminal handoff failure recovery)** — if you
  already know the answer (gut read: mark discarded with reason, no retry),
  pre-decide it in the spec and remove from open questions.
- **Open question #5 (auto-clear after inactivity)** — if you know this
  should/shouldn't exist, pre-decide it. The whole "ephemeral cart" model
  implies no, but worth being explicit.

---

## Prompt block (paste this into `/speckit-specify`)

Convert the checkout/cart-building page from a database-backed flow to an
in-memory ephemeral cart. The cart only writes to the database when the
operator commits to a payment.

### Current behavior

Opening `/checkout` (via the dashboard "New transaction" CTA, the sidebar
"Checkout" link, or the DoneScreen "New sale" link) immediately inserts an
empty `tickets` row with `status='open'` and redirects to `/checkout/<new-id>`.
Every cart operation (add service, add discount, change tech, etc.) writes
to `ticket_items`/`tickets` keyed by that `ticket_id`. Two consequences I
want to eliminate:

1. The database accumulates empty/abandoned `open` ticket rows from
   operators who opened checkout and walked away.
2. The checkout page needs Cancel and Discard buttons just to clean these
   up, which creates an awkward UX (no confirmation on Discard, Cancel
   reachable during Square Terminal payment, Cancel/Discard mental model
   that operators have to learn).

### Desired behavior

Treat the cart-building phase like an unsaved document. Items, discounts,
customer selection, and tech assignment live in client-side React state
only. No `tickets` or `ticket_items` rows exist while the cart is being
built.

The first database write happens at the moment the operator commits to a
payment — one of:

- Submit cash payment
- Submit gift card payment
- Click "Send to Square Terminal" to charge a card
- Initiate split tender (split-tender legs need a real ticket row to anchor
  against, so the commit must happen at split initiation, not at first leg
  capture)

At any of those commit points, a single server action atomically creates
the `tickets` row + bulk-inserts `ticket_items` + creates the first
`payments` row (or split-tender draft legs). After that first commit,
everything behaves exactly as today — all split-tender legs settle as they
do now, the Square Terminal webhook flow is unchanged, the receipt screen
is unchanged, audit logging post-commit is unchanged.

If the operator navigates away, refreshes the page, or closes the browser
before any commit, the cart state is lost. That is intentional — the model
is "unsaved changes, lost on leave," consistent with how text editors and
form drafts work everywhere else.

### Prerequisites

This spec assumes the following bugfix issues have already merged into
`main`. Without them, the new "promote on commit" server actions would
inherit the same money-handling gaps that exist in today's checkout flow.

- **Discard during Square Terminal "waiting" cancels the terminal checkout
  first** (Issue #25). Today `handleDiscard` calls `discardTicket`
  directly even while a Square terminal session is live, so a customer
  card-tap moments later captures money against a now-`discarded` ticket.
- **`discardTicket` refuses when any in-flight `payments` row exists**
  (Issue #26). Guard on `status IN ('pending', 'succeeded', 'draft')`.
  This catches both the split-tender-partial-leg case and the
  Square-waiting case defensively.
- **`pos_record_card_payment` auto-recovers late captures on discarded
  tickets** (Issue #27). When the late capture sum meets the ticket
  total, auto-flip `discarded` → `paid` (instead of silently no-opping),
  emit a `payment.captured_after_discard` audit event, and preserve the
  original discard's forensic record. Makes the captured money visible
  as a normal `paid` sale rather than orphaned against a discarded
  ticket.

### In scope

- New client-side cart state holding items, discounts, tech assignment, and
  customer, replacing the current per-action DB writes
- Three new "promote on commit" server actions that atomically create
  ticket + items + first payment in one transaction:
  - `submitCashFromCart(cart)`
  - `sendCardToTerminalFromCart(cart)`
  - `splitTenderFromCart(cart)` (creates ticket + items, then hands off to
    the existing split-tender UI which assumes a real ticket exists)
- Route topology change: `/checkout` becomes the cart-building page with NO
  `ticketId` in the URL. `/checkout/<id>` becomes the post-commit page
  only — used by mid-split-tender screens and the completed-sale receipt view
- Rewire entry points (dashboard CTA, sidebar Checkout link, DoneScreen
  "New sale" link) to land on `/checkout` with no eager-create
- Remove Cancel and Discard buttons from the cart-building phase entirely.
  No row exists to discard. Discard remains on the mid-split-tender screen
  where a real ticket exists

### Out of scope

- Split-tender behavior once a ticket exists — leg settlement RPCs, draft
  invalidation, `FOR UPDATE` locking, etc. all stay as they are today
- The Square Terminal payment lifecycle after handoff — webhook, polling,
  RPCs unchanged. The only change is that ticket+payment rows are created
  at the handoff click instead of pre-existing
- Receipt screen / DoneScreen behavior
- New persistence mechanisms — no localStorage, no IndexedDB, no
  server-side draft store. The cart is truly ephemeral
- The resume-today's-open-ticket sidebar behavior — that capability goes
  away by design (there are no "today's open tickets" until commit)
- Schema migrations — no new tables, columns, or indexes are needed

### Open questions to clarify

1. **Square Terminal handoff failure recovery.** The new
   `sendCardToTerminalFromCart` action will atomically create the ticket
   + items + `payments(status='pending')` row, then call Square's API.
   If the Square call fails, what state should the orphan ticket end up
   in? Note that the Prerequisites' Issue 2 guard means we cannot just
   call `discardTicket` — it will refuse because the `pending` payment
   row exists. So the options are:
   - (a) **Delete the rows directly** in the same server action — bypass
     `discardTicket` because no operator-facing discard is happening,
     this is system rollback of a failed transaction
   - (b) **Mark the `pending` payment `failed` first** (which clears the
     in-flight blocker), then call `discardTicket` for a clean audit
     trail with a `ticket.discarded` event
   - (c) **Leave both rows in place** with the `pending` payment marked
     `failed` and the ticket still `open`, then show a retry affordance
     on the page so the operator can try again without rebuilding the
     cart from memory (which is already gone at this point)

2. **Cart state survival within an SPA session.** If the operator clicks
   another sidebar link and comes back to `/checkout`, should the cart
   still be there? Or is leaving the route always destructive?

3. **Multi-device pre-commit cart visibility.** Today, in principle, two
   staff on different iPads can both load `/checkout/<id>` and see the
   same ticket mid-build. Is this a real workflow we use? If yes, this
   change breaks it for pre-commit carts (would still be fine for
   post-commit tickets via the `/checkout/<id>` URL).

4. **Audit trail of pre-commit activity.** Today there is a
   `ticket.created` audit event when the empty ticket is born. After
   this change, there is no audit footprint until commit. Acceptable, or
   do we need an explicit "checkout opened" / "cart abandoned" audit
   event for compliance?

5. **Inactivity auto-clear.** Should the in-memory cart be cleared
   automatically after some inactivity window (e.g., 30 min) to avoid
   stale state if someone leaves the browser open overnight?

### Reference files (current implementation)

Entry points:

- `app/(studio)/checkout/page.tsx` (line 24-29: eager-create dispatcher)
- `components/lacquer/new-transaction-cta.tsx` (dashboard CTA, `href=/checkout?fresh=1`)
- `components/lacquer/sidebar/nav-items.ts` (line 87: sidebar Checkout link)
- `components/lacquer/checkout/done-screen.tsx` (line 70: New sale link)

Page + UI:

- `app/(studio)/checkout/[ticketId]/page.tsx` (post-commit reader)
- `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` (monolithic
  UI; contains `handleCancel` line 613, `handleDiscard` line 595, all
  cart-edit handlers)
- `components/lacquer/checkout/tx-header.tsx` (line 58-105: Cancel/Discard
  buttons)

Server actions:

- `app/(studio)/checkout/actions.ts`:
  - `createEmptyTicket` line 152
  - `resumeOrCreateTicket` line 259
  - `addServiceLine` line 395 (and other addX/removeX cart-edit actions)
  - `discardTicket` line 867
  - `sendCardToTerminal` line 1318

Split-tender + payment internals (do not change, but understand):

- `app/(studio)/checkout/_drafts.ts` (`discardDraftLegs`)
- `lib/realtime/payments.ts` (`subscribePaymentChanges`)
- `supabase/migrations/0004_checkout_cash_sale.sql` (`tickets` schema,
  status enum, `pos_take_cash` RPC)
- `supabase/migrations/0008_square_terminal_payment.sql`
  (`pos_record_card_payment`, `payments.square_terminal_checkout_id`)
- `supabase/migrations/0012_gift_card_split_tender.sql`
  (`pos_compose_payment_draft`, `pos_activate_cash_draft`,
  `pos_record_gift_payment`, one-in-flight unique index)

### Success criteria

- Visiting `/checkout` with no actions writes nothing to the database
- Building a cart of any size and then leaving writes nothing to the
  database
- Submitting cash, submitting gift, sending to Square Terminal, and
  initiating split tender each work end-to-end, producing the same final
  DB state as today
- Page refresh during cart building clears the cart (intentional)
- No Cancel or Discard buttons on the cart-building phase
- Discard still appears and works on the mid-split-tender screen
- No `tickets` row exists with `status='open'` and zero `ticket_items`
  rows after any operator session, ever
- All existing e2e tests pass (with updates for the route topology change
  and removed Cancel button)
