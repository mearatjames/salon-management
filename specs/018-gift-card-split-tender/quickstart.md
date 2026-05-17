# Quickstart — Gift Card Redemption & Split-Tender Checkout

**Feature**: 018-gift-card-split-tender · **Plan**: [plan.md](./plan.md)

This is the developer setup for working on feature 018 locally. It assumes you've already done the feature-015 quickstart (Square OAuth connected, paired terminal device, e2e Square stub running) — this feature reuses that entire surface and adds gift-card lookup + payment stubs on top.

---

## 1. Prereqs (verify before you start)

- `supabase start` running and reachable on the default ports.
- `npm run dev` runs without errors (Next.js 16 dev server on `:3000`).
- `cloudflared tunnel run <tunnel-name>` is up if you plan to exercise the **real** Square Sandbox webhook locally. For e2e specs you don't need the tunnel — the e2e stub intercepts all Square calls.
- `npm run test:e2e -- --grep card-payment-happy` (the feature-015 happy-path spec) passes.

If any of those fail, finish the feature-015 setup first — feature 018 piggybacks on it directly.

---

## 2. Apply the new migration

```bash
# in the running supabase instance (preview Supabase is auto-applied on PR)
supabase db reset    # rebuilds the local DB from migrations/* — picks up 0010_gift_card_split_tender.sql
```

Verify the new schema:

```bash
psql "$SUPABASE_DB_URL" -c "\d+ gift_cards"
psql "$SUPABASE_DB_URL" -c "\df pos_compose_payment_draft pos_remove_payment_draft pos_activate_cash_draft pos_record_gift_payment"
psql "$SUPABASE_DB_URL" -c "select enum_range(null::payment_method);"
psql "$SUPABASE_DB_URL" -c "select enum_range(null::payment_status);"
```

Expected: `payment_method` shows `{cash, card, gift}`; `payment_status` shows `{draft, pending, succeeded, failed}`; four RPCs exist; `gift_cards` exists with `last4_mask`, `balance_cents_cached`, `state`.

Regenerate types:

```bash
npm run db:gen-types     # convention: writes lib/db/types.ts
```

---

## 3. Extending the e2e Square stub

The stub at `tests/e2e/_square-stub.ts` already intercepts terminal calls. This feature adds two endpoints + a fixture matrix keyed by GAN suffix.

**Fixture matrix** (per [research.md § R10](./research.md#r10--extending-the-local-square-stub)):

| Suffix    | Response                                |
|-----------|-----------------------------------------|
| `0001`    | ACTIVE, balance $60                     |
| `0002`    | ACTIVE, balance $15                     |
| `0003`    | ACTIVE, balance $5                      |
| `0000`    | ACTIVE, balance $0 (zero-balance edge)  |
| `BLKD`    | BLOCKED                                 |
| `PEND`    | PENDING                                 |
| `DEAC`    | DEACTIVATED                             |
| anything else (incl. `9999`) | NOT_FOUND            |

**Convention for new specs**: construct GANs by suffix and pass them as plain strings to the cart UI. The stub strips spaces and matches on the last 4 chars.

```ts
// in a spec
const ACTIVE_60_GAN = "6000 1234 5678 0001";      // → ACTIVE $60
const PARTIAL_15_GAN = "6000 1234 5678 0002";     // → ACTIVE $15
const BLOCKED_GAN = "6000 1234 5678 BLKD";        // → BLOCKED
```

The stub also simulates `payment.updated` webhook delivery for gift-card payments. By default it fires the COMPLETED event 100ms after `payments.create`. For race-testing, suppress it with the spec's `withSuppressedGiftWebhook()` helper.

---

## 4. Manual exercise in the dev studio

Once the migration is applied and the stub is extended, you can drive the flows manually against `npm run dev`:

### Story 1 — Full-balance gift card

1. Open `/checkout` and start a fresh sale.
2. Add a service that totals to $40.
3. Tap the **Gift** payment tile.
4. Enter GAN `6000 1234 5678 0001` on the numpad sheet.
5. Sheet shows "$60.00 available on this card". Tap **Redeem**.
6. Cart flips to the Done screen. Receipt shows one gift-card payment of $40.

### Story 2 — Split tender (cash + card)

1. Open `/checkout` and start a fresh sale of $60 total.
2. Tap **Split**. The cart footer switches to the split-mode composition view.
3. Tap **Add leg** → enter $20 → pick **Cash**. A draft leg row appears: "Cash · $20.00 · Draft".
4. Tap **Add leg** → enter $40 → pick **Card**. A second draft leg row appears: "Card · $40.00 · Draft".
5. Tap the cash leg's **Activate**. It instantly flips to "Cash · $20.00 · Succeeded" and the running total updates to "Paid $20 of $60 · Owes $40".
6. Tap the card leg's **Activate**. The terminal-waiting screen appears. Simulated webhook (after ~1s) settles it.
7. Cart flips to Done. Receipt shows two payments totaling $60.

### Story 3 — Partial-balance gift card auto-split

1. Open `/checkout` and start a fresh sale of $40 total.
2. Tap **Gift**.
3. Enter GAN `6000 1234 5678 0002` (ACTIVE $15).
4. Sheet shows "$15.00 available · ticket needs $40 · split needed". Tap **Redeem available**.
5. Cart enters split mode. The gift leg row shows "Gift · $15.00 · Pending → Succeeded" (webhook arrives quickly). A second draft leg row is pre-populated: "Pick method · $25.00 · Draft".
6. Tap the second draft leg → pick **Cash** → tap **Activate**. Cart flips to Done.

### Edge cases (drive them by changing the GAN suffix)

- `0000` (zero balance) → sheet shows "$0.00 available — pick a different method"; redeem button disabled.
- `BLKD` → sheet shows "This gift card is blocked and can't be redeemed".
- `PEND` → sheet shows "This gift card is pending activation and can't be redeemed yet".
- `9999` (not found) → sheet shows "Gift card not found — re-enter the number".

---

## 5. Running the new e2e specs

```bash
npm run test:e2e -- --grep 'US1 .* gift card.*full'         # gift-card-full-balance.spec.ts
npm run test:e2e -- --grep 'US2 .* split tender'            # split-tender-cash-card.spec.ts
npm run test:e2e -- --grep 'US3 .* gift card.*partial'      # gift-card-partial-balance.spec.ts
npm run test:e2e -- --grep 'gift card errors'               # gift-card-errors.spec.ts
npm run test:e2e -- --grep 'concurrent charge'              # concurrent-charge-blocked.spec.ts
```

These use the per-test audit-cursor convention; they will not interfere with each other when run in parallel (per the CLAUDE.md gates note).

---

## 6. Running the unit suite for this feature

```bash
npm test -- tests/unit/square/gift-card-lookup tests/unit/square/gift-card-payment tests/unit/square/webhook-payment-updated tests/unit/checkout/compose-draft-leg tests/unit/checkout/remove-draft-leg tests/unit/checkout/activate-cash-draft tests/unit/checkout/activate-gift-draft tests/unit/checkout/redeem-gift-whole-ticket tests/unit/checkout/cart-edit-invalidates-drafts tests/unit/checkout/one-in-flight-per-ticket tests/unit/checkout/leg-sum-equals-total
```

All nine unit files are red-first per Constitution Principle IV — each starts as a failing assertion against an unimplemented action/RPC, then the implementation makes it green.

---

## 7. Verification checklist before any UI work is considered complete

Per CLAUDE.md and `design-system/SKILL.md`:

- [ ] Compared the GAN numpad sheet side-by-side with `components/lacquer/numeric-keypad.client.tsx` (the existing PIN numpad). Spacing, key sizes, and font weights match — only the input length and the "Look up balance" CTA differ.
- [ ] Compared the split-mode cart footer side-by-side with `design-system/prototypes/transaction/FlowSingle.jsx:220–266`. The leg-row list, the "Add leg" affordance, and the running-totals copy match the prototype.
- [ ] Compared the gift-card balance sheet side-by-side with the muted-rose accent strip in `FlowSingle.jsx:230–235`. Same background, same `--rose-700` foreground.
- [ ] Every color/spacing/radius value resolves to a token in `styles/tokens.css` (no raw hex codes; no off-scale spacing).
- [ ] Tabular numerals on every currency render.
- [ ] Lucide icons only (Gift, SplitSquareHorizontal, Banknote, CreditCard), 1.5px stroke, sized 16/20/24.
- [ ] No emoji anywhere in the chrome.
- [ ] Compared the running-totals copy ("Paid $X of $Y · Owes $Z") against the spec FR-011 — both match verbatim.
- [ ] Ran `speckit-design-auditor` against the feature branch and got a PASS.

---

## 8. Pre-push gates (per CLAUDE.md)

Before pushing the final commit:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

All five MUST be green. CI runs the same commands.
