# Quickstart: Square Terminal Card Payment (developer setup)

This walkthrough takes a fresh checkout of the repo to a working end-to-end Square Terminal card payment against the Square Sandbox. Estimated wall-clock time: 25–35 minutes including the Square Developer Dashboard setup.

Prerequisites: the repo is set up per the root `README.md` / `CLAUDE.md` (Supabase local running, `.env.local` populated with Supabase URL + keys, `npm install` complete).

---

## 1. Install cloudflared (one-time per machine)

```bash
brew install cloudflared        # macOS
# or follow https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ for other OS
```

---

## 2. Create a Square Sandbox application (one-time per developer)

1. Sign in to https://developer.squareup.com.
2. Click **+** → **Create application**. Name it e.g. `Tang Nails — <your-name>`.
3. In the application's settings, switch the toggle at the top from **Production** to **Sandbox** — every URL and key below is for the sandbox.

Leave the dashboard open — you'll come back to populate URLs.

---

## 3. Start the cloudflared tunnel

In a dedicated terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Note the URL it prints, e.g. `https://random-words.trycloudflare.com`. **This URL changes every time you restart the tunnel** — for this session, keep the tunnel running.

---

## 4. Fill in `.env.local`

Copy from `.env.example` and add the Square + cron entries:

```bash
# --- Square Sandbox (from your Square Developer Dashboard → Sandbox) ---
SQUARE_APPLICATION_ID=<sandbox app id>
SQUARE_APPLICATION_SECRET=<sandbox app secret>
SQUARE_ENVIRONMENT=sandbox
SQUARE_WEBHOOK_SIGNATURE_KEY=<webhook signature key from step 6>

# --- Encryption-at-rest plumbing ---
SQUARE_OAUTH_KEY_VAULT_NAME=square_oauth_key

# --- Vercel Cron auth (any long random string for local) ---
CRON_SECRET=local-dev-cron-secret-not-a-real-one
```

---

## 5. Create the Supabase Vault secret (one-time per database)

The pgcrypto symmetric key MUST live in Supabase Vault. Run once against your local Supabase:

```sql
-- In Supabase Studio SQL editor (or psql against your local instance):
select vault.create_secret(
  'a-32-byte-or-longer-random-string-keep-this-secure',
  'square_oauth_key',
  'Symmetric key for encrypting Square OAuth tokens at rest'
);
```

The name `square_oauth_key` MUST match `SQUARE_OAUTH_KEY_VAULT_NAME` from `.env.local`. The secret value can be any sufficiently long random string — for local dev, `openssl rand -base64 48` is fine.

For preview/prod, the same `vault.create_secret` call is run as part of the Supabase project setup — record the value in 1Password and never commit it.

---

## 6. Configure the Square Sandbox application

Back in https://developer.squareup.com → your Sandbox app:

**OAuth tab**:
- Redirect URL: `https://<your-cloudflared-url>/settings/square/callback`

**Webhooks tab** → Subscriptions → **Add subscription**:
- API version: latest
- Notification URL: `https://<your-cloudflared-url>/api/webhooks/square`
- Events: select **terminal.checkout.updated**.
- After creating the subscription, copy the **Webhook signature key** value into `SQUARE_WEBHOOK_SIGNATURE_KEY` in `.env.local`.

Note: each cloudflared restart changes the URL — you'll need to update the OAuth redirect URL and the webhook notification URL in the Square dashboard. (A named cloudflared tunnel with a stable DNS record is a future polish.)

---

## 7. Pair a Square Terminal device (one-time per developer)

Without a paired terminal you can still test the OAuth flow (US1) but not the card payment flow (US2/US3). Two options:

**Option A — Use a Square virtual terminal in the sandbox.**
Square's sandbox dashboard provides a "Virtual Terminal" simulator that responds to terminal checkout API calls. Follow Square's instructions to create one and copy its device id.

**Option B — Use a physical Square Terminal in sandbox mode.**
If you have one, follow Square's pairing instructions to put it in sandbox mode.

Either way, the device should appear in `/settings/square` after a fresh `listDevices` refresh.

---

## 8. Apply the migration locally

```bash
supabase db reset       # or supabase db push if you don't want to wipe data
```

This applies `0008_square_terminal_payment.sql` and creates the `square_oauth`, `square_devices` tables and the additions on `payments`.

---

## 9. Start the dev server

```bash
npm run dev
```

In another terminal, ensure the cloudflared tunnel from step 3 is still running.

---

## 10. Connect Square (US1 walkthrough)

1. Open the cloudflared URL in your browser (NOT `localhost:3000` — the OAuth callback redirects back to the registered redirect URL, which is the cloudflared URL).
2. Sign in to the studio shell as an owner-role staff member.
3. Navigate to **Settings → Square**.
4. Click **Connect Square**. You'll be redirected to Square's sandbox sign-in.
5. Sign in with your Square sandbox account credentials.
6. Authorize the requested scopes.
7. You'll be redirected back to `/settings/square?connected=1`. The page should show your sandbox merchant's name + the list of paired devices.
8. Give your test device a friendly name like "Test terminal".
9. Mark it as the default with the radio button.

Audit verification: in Supabase, run `select * from audit_log where action like 'integration.square_%' order by created_at desc limit 5;`. You should see the verbs in this order: `integration.square_connected`, `integration.square_device_renamed`, `integration.square_device_default_set`.

---

## 11. Take a card payment (US2 walkthrough)

1. From the dashboard, tap **New transaction** to land in checkout.
2. Add a service or two.
3. On the payment-method screen, tap **Card** (or, if Card is the only method, tap **Charge $X**).
4. The waiting screen appears with the Square Terminal glyph and "Hand the terminal to your client".
5. On your sandbox terminal (or virtual terminal), simulate a successful tap. Square's sandbox provides a "Complete" button in the device simulator that fires the webhook.
6. Within ~1 second, the cart should advance to the Done screen showing "Charged $X" plus the tip.

Audit verification: `select * from audit_log where action = 'payment.captured' order by created_at desc limit 1;` — you should see the row with `payload.method = 'card'`.

---

## 12. Run the test suite (CI parity)

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

The e2e tests use the Square HTTP stub (`tests/e2e/_square-stub.ts`) and do NOT hit Square Sandbox — they run hermetically. Confirm all four new e2e specs pass:

- `tests/e2e/square-oauth.spec.ts`
- `tests/e2e/card-payment-happy.spec.ts`
- `tests/e2e/card-payment-cancel.spec.ts`
- `tests/e2e/card-payment-race.spec.ts`

---

## 13. Pre-merge verification (mandatory)

Before opening the PR for this feature, the developer who built it MUST do **at least one** live end-to-end pass against the real Square Sandbox (steps 10 + 11) on their machine. The e2e suite covers the logical paths, but only a live pass exercises Square's actual cloud-to-device flow and webhook signing.

Record in the PR description: "Live sandbox e2e: OAuth ✓ / Card payment ✓ / Cancel ✓ / Decline ✓ (sandbox card 4000 0000 0000 0002)".

Plus the standard pre-push gate set (CLAUDE.md § Pre-push quality gates):

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

All five MUST be green locally before push.

---

## 14. Verification checklist before claiming a UI task complete

Per `design-system/SKILL.md`:

- [ ] Side-by-side comparison of the new card-waiting screen against `design-system/preview/transaction-flows.html` (the FlowSingle waiting state).
- [ ] Every color/spacing/radius/shadow value in `components/lacquer/checkout/card-waiting.tsx` and the settings tab traces to a token in `styles/tokens.css`.
- [ ] Icons are Lucide at 1.5px stroke, sized 16/20/24. The SquareTerminalIcon glyph is the one from the prototype (already vendored).
- [ ] Tabular numerals (`font-variant-numeric: tabular-nums`) on every currency render in the waiting screen, the device list, and the Done screen.
- [ ] No raw hex codes, no off-scale spacing.
- [ ] `speckit-design-auditor` agent has been dispatched and returned PASS for the touched components/ and app/ files.
