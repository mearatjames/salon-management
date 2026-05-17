---

description: "Task list for Square Terminal Card Payment"
---

# Tasks: Square Terminal Card Payment

**Input**: Design documents from `/specs/015-square-terminal-payment/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/server-actions.md](./contracts/server-actions.md), [contracts/webhooks.contract.md](./contracts/webhooks.contract.md), [contracts/api-routes.contract.md](./contracts/api-routes.contract.md), [contracts/audit.contract.md](./contracts/audit.contract.md), [quickstart.md](./quickstart.md).

**Tests**: REQUIRED. This is a money critical path (Constitution Principle IV). Every test on the critical path — webhook signature verification, per-attempt-retry semantics, cancel-vs-success race, lazy expiration, the cash-vs-card payment-method behavior — is written and shown to fail before the implementation that satisfies it. Playwright e2e tests cover each user story end-to-end against a stubbed Square HTTP layer (no live Square calls in CI).

**Organization**: Tasks are grouped by user story so each story can ship independently. MVP scope is Phase 1 + Phase 2 + Phase 3 (US1 — connect Square) + Phase 4 (US2 — take a card payment). Phase 5 (US3 — recovery) is required before live-salon use.

**Intermediate gate scoping (per `CLAUDE.md` § "Scoping intermediate phase gates")**: every per-phase gate uses scoped commands — `npx playwright test ... -g "USn"`, scoped prettier+eslint on the diff. The full `format:check && lint && typecheck && test && test:e2e` suite runs once, at the final gate.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: [US1], [US2], [US3] for story phases; setup / foundational / polish phases have no story label.

## Path Conventions

Repo root: `/Users/mearathou/Dev/salon-management/`. Paths below are repo-relative (e.g., `lib/square/oauth.ts`). Single Next.js project — Option 1 from the template, as recorded in `plan.md` § Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring up the configuration and directory layout the feature owns. The Next.js app, Supabase tooling, and the `square@^44.0.1` SDK are already installed.

- [X] T001 [P] Create directories `lib/square/`, `lib/realtime/`, `app/(studio)/settings/square/`, `app/(studio)/settings/square/callback/`, `app/api/webhooks/square/`, `app/api/square/terminal-checkout/[id]/`, `app/api/square/refresh-token/`, `components/lacquer/settings/square/`, `tests/unit/square/`, and `tests/e2e/_square-fixtures/` so subsequent file-creation tasks have targets. No code change.
- [X] T002 [P] Append `SQUARE_OAUTH_KEY_VAULT_NAME=square_oauth_key` and `CRON_SECRET=change-me-to-a-long-random-string` to `.env.example`, with the same comment style as the existing Square block. Verify `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_ENVIRONMENT`, and `SQUARE_WEBHOOK_SIGNATURE_KEY` are already present (they are; this confirms no duplication).
- [X] T003 [P] Create `vercel.json` at repo root with a single `crons` entry registering `/api/square/refresh-token` on schedule `0 4 * * *` per `contracts/api-routes.contract.md` § 2. (No `vercel.json` exists yet; this is a fresh file.)

**Checkpoint**: Directories exist, env scaffolding in place, cron registered. Feature work can proceed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, type regen, audit vocabulary, the Square SDK client factory, the OAuth + encryption plumbing, and the e2e Square stub. Every user story phase depends on these.

**⚠️ CRITICAL**: No user-story work begins until this phase is complete.

### Schema (data-model.md)

- [X] T004 Create `supabase/migrations/0008_square_terminal_payment.sql` per `data-model.md` §§ 1–6: `create extension if not exists pgcrypto`; create `square_oauth` (singleton via `id boolean primary key default true` + check); create `square_devices` with the partial unique index `square_devices_one_default_idx`; `alter type public.payment_method add value if not exists 'card'`; add columns `square_payment_id`, `square_terminal_checkout_id`, `raw jsonb`, `failure_reason text` to `public.payments`; drop the `tip_cents = 0` constraint and replace with `tip_cents >= 0`; create unique partial index `payments_unique_succeeded_terminal_checkout_idx`; create the `pos_record_card_payment` plpgsql function exactly as in `data-model.md` § 4 (including the `expired → succeeded` escape hatch and `security definer` + `service_role` grant); create the `decrypt_square_token(bytea)` SQL function with `service_role` grant only. RLS for new tables: single `select to authenticated using (true)` policy each, no insert/update/delete policies.
- [X] T005 Run `supabase db reset` locally to apply the new migration. Confirm with `\dt public.square_oauth public.square_devices`, `\df public.pos_record_card_payment public.decrypt_square_token`, and `\d public.payments` (expecting the four new columns + the relaxed tip constraint). Document any apply error before moving on.
- [X] T006 Regenerate `lib/db/types.ts` from the updated schema using the same script the repo's prior migrations used (`supabase gen types typescript --local > lib/db/types.ts`). Run `npm run typecheck` to confirm the new types compile against the rest of the codebase.

### Vault secret (out-of-band; documented as a task because it's mandatory for local dev)

- [X] T007 In Supabase Studio (local) SQL editor, run `select vault.create_secret('<openssl rand -base64 48>', 'square_oauth_key', 'Symmetric key for encrypting Square OAuth tokens at rest');`. Verify with `select * from vault.secrets where name = 'square_oauth_key';`. Record the value in 1Password if this is a shared dev machine; otherwise keep local.

### Audit vocabulary (contracts/audit.contract.md)

- [X] T008 Extend `lib/auth/audit.ts`: add to `AuditAction` the seven new verbs (`payment.failed`, `payment.cancelled`, `integration.square_connected`, `integration.square_disconnected`, `integration.square_token_refreshed`, `integration.square_device_renamed`, `integration.square_device_default_set`); extend `deriveEntityType` with `if (action.startsWith("integration.")) return "integration";` placed alongside the existing prefix branches; widen the return-type union to include `"integration"`. No call sites yet — additions only.

### Square SDK client factory

- [X] T009 [P] Create `lib/square/client.ts` exporting `getSquareClient(accessToken: string): SquareClient`. Construct from `square@^44.0.1` using `SQUARE_ENVIRONMENT` to pick `'sandbox'` vs `'production'`. Document with a JSDoc that this MUST NOT be imported from client components; add a Vitest in `tests/unit/square/client-import-graph.test.ts` (in the same task — small) that asserts no file matching `**/*.client.tsx` imports `lib/square/*`.

### OAuth + encryption plumbing (research R3, R4)

- [X] T010 Write `tests/unit/square/oauth-encryption.test.ts` covering: (a) `setOauthKeyGuc()` followed by `pgp_sym_encrypt` round-trip via `decrypt_square_token` returns the original plaintext; (b) calling `decrypt_square_token` without first setting the GUC raises with Postgres error code `42704`; (c) a different GUC value yields a decryption that fails. This file is the red baseline before T011 lands. Uses a transactional local Postgres connection through the service-role client.
- [X] T011 Create `lib/square/oauth.ts` exporting: `setOauthKeyGuc(client)` (issues `select set_config('app.square_oauth_key', vault_secret_value, true)`); `startOAuth(returnUrl): string` (builds the authorization URL with state JWT, scopes, redirect URI); `exchangeCodeAndPersist(code, operatorStaffId)` (POSTs Square `/oauth2/token`, encrypts with `pgp_sym_encrypt(plain, current_setting('app.square_oauth_key'))`, INSERTs/UPSERTs `square_oauth`); `readDecryptedTokens()` (selects encrypted columns + `decrypt_square_token` SQL function); `refreshIfNeeded()` (R7 retry policy: 3 attempts, 1s/2s/4s backoff; on persistent failure sets `refresh_failed_at`); `revokeAndDelete()` (calls Square revoke, then `delete from square_oauth` + `delete from square_devices` in one transaction). All callers must be server-only. Make T010 green.

### Square HTTP stub for e2e (research R9)

- [X] T012 [P] Create `tests/e2e/_square-stub.ts` as a Playwright fixture that intercepts `connect.squareupsandbox.com/v2/terminals/checkouts*` and `/v2/terminals/devices*` requests. Expose helper methods: `stubListDevices(devices[])`, `stubCreateCheckout({ticketId, paymentId, returnStatus})`, `stubGetCheckoutStatus(checkoutId, {status, tipCents?})`, `stubCancelCheckout(checkoutId, {responseStatus})`, `simulateWebhook(event)` (POSTs a validly-signed payload to `/api/webhooks/square` using `SQUARE_WEBHOOK_SIGNATURE_KEY` from `.env.test`). Asserts at teardown that no real Square hostnames were called. Also add `tests/fixtures/square-webhook-key.txt` with a deterministic test key value, and load it into `.env.test`.

### Webhook signature verification (research R4)

- [X] T013 [P] Write `tests/unit/square/webhook-signature.test.ts` covering all four cases from `contracts/webhooks.contract.md` § 2 — valid signature returns `true`; one-byte-changed body returns `false`; missing header returns `false`; wrong algorithm header returns `false`. Use Square's documented HMAC-SHA256 algorithm with a known signing key fixture. This file is red before T014 lands.
- [X] T014 Create `lib/square/webhooks.ts` exporting `verifySignature(rawBody: string, signatureHeader: string | null, signatureKey: string, notificationUrl: string): boolean`. Use `crypto.createHmac('sha256', signatureKey).update(notificationUrl + rawBody).digest('base64')` and `crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader ?? ''))`; return `false` if `signatureHeader` is null. Make T013 green.

**Checkpoint**: Schema applied, types regenerated, audit vocab extended, SDK client + OAuth + signature-verification primitives live, e2e stub ready. User-story work can begin.

---

## Phase 3: User Story 1 — Connect the salon to Square (Priority: P1) 🎯 MVP

**Goal**: Owner clicks Connect Square in settings, signs in to Square in a hosted flow, returns to settings showing the salon's paired terminal devices, renames one, marks it default, and can disconnect. Daily token refresh keeps the connection alive.

**Independent Test**: With nothing connected, click Connect Square, complete the sandbox OAuth flow, return to settings, see at least one terminal device listed, rename it, mark default, reload to confirm persistence, then disconnect and confirm the Card option in checkout becomes unavailable.

### Tests for User Story 1

- [X] T015 [P] [US1] Write `tests/e2e/square-oauth.spec.ts` covering the full US1 journey: start unconnected → click Connect Square → complete the stubbed OAuth flow (Square stub returns a synthetic merchant id + 2 devices) → settings shows "Connected to <merchant>" + the 2 devices → rename device 1 to "Front desk" → mark it default → reload, confirm persistence → click Disconnect → confirm settings shows the unconnected CTA and `select count(*) from public.square_oauth` returns 0. Use the audit-cursor convention (`newAuditCursor()` / `getAuditLogRowsSince()` from `tests/e2e/_db.ts`) to assert the four verbs from `contracts/audit.contract.md` (`integration.square_connected`, `integration.square_device_renamed`, `integration.square_device_default_set`, `integration.square_disconnected`) appear in that order. `describe` block named `US1: Connect Square` so `-g "US1"` matches.

### Implementation for User Story 1

- [X] T016 [P] [US1] Create `lib/square/terminal.ts` exporting `listDevices(): Promise<TerminalDevice[]>` only (US1 only needs the listing call; US2 will extend this file). Returns `{ squareDeviceId, providedName, status }[]` from Square's `terminals.devices.list`. Side effect: UPSERTs into `public.square_devices` (insert new rows with `friendly_name = providedName`; update `last_seen_at` on existing rows). Tested implicitly by T015's e2e.
- [X] T017 [P] [US1] Create error classes in `app/(studio)/settings/square/_errors.ts` per `contracts/server-actions.md` § "Error class layout": `SquareNotConnectedError`, `SquareReconnectRequiredError`, `InvalidDeviceNameError`, `DeviceNotFoundError`. Each carries a stable `code` string.
- [X] T018 [US1] Create `app/(studio)/settings/square/actions.ts` with Server Actions per `contracts/server-actions.md`: `connectSquareStart()`, `disconnectSquare()`, `renameDevice(deviceId, newName)`, `setDefaultDevice(deviceId | null)`. Each follows the shared prelude (`requireStudioSession()` → validate → mutate via service-role → `recordAudit`). The set-default action is a two-step transaction (clear existing default, set new). Use the error classes from T017 and the audit verbs from T008.
- [X] T019 [US1] Create `app/(studio)/settings/square/callback/route.ts` as a GET route handler per `contracts/server-actions.md` § "OAuth callback route handler": verify state JWT (CSRF nonce + freshness ≤ 10 min), exchange code via `lib/square/oauth.ts:exchangeCodeAndPersist`, fetch merchant profile, perform initial `listDevices` UPSERT, emit `integration.square_connected` audit, redirect to `/settings/square?connected=1` on success; on each error path redirect with `?error=<code>` (invalid_state / oauth_exchange_failed / vault_misconfigured). Never returns 5xx for a known failure mode — always redirects.
- [X] T020 [P] [US1] Create `components/lacquer/settings/square/connect-card.tsx` (Server Component) with two states: unconnected → "Connect Square" button + sandbox/production hint; connected → "Connected to {merchant_name}" header + Disconnect button. Adapts the existing `app/(studio)/settings/staff/` card pattern. All values resolve to tokens in `styles/tokens.css`.
- [X] T021 [P] [US1] Create `components/lacquer/settings/square/device-list.tsx` (client island) rendering the paired-device rows: friendly-name inline-edit input, default radio (controlled by `setDefaultDevice`), and a soft "last seen Xm ago" indicator computed from `square_devices.last_seen_at`. Each input/radio change calls the corresponding server action and surfaces errors via the existing `sonner` toaster.
- [X] T022 [P] [US1] Create `components/lacquer/settings/square/reconnect-banner.tsx` (Server Component) shown only when `square_oauth.refresh_failed_at IS NOT NULL`. Copy: "Square connection needs attention — the daily token refresh failed. Reconnect to keep accepting cards." with a CTA that re-runs the OAuth flow.
- [X] T023 [US1] Create `app/(studio)/settings/square/page.tsx` as a Server Component: read `square_oauth` + `square_devices` via `lib/db/admin.ts`; call `lib/square/terminal.listDevices()` to refresh `last_seen_at` only when connected; render the three components from T020–T022 plus a flash-toast handler for the `?connected=1` / `?error=...` query params (use `sonner`). Also create `app/(studio)/settings/square/square-settings.client.tsx` as the small client island that handles the Disconnect confirm dialog (a `radix-ui` Dialog).

### Daily token-refresh cron (US1 acceptance scenario 4)

- [X] T024 [P] [US1] Write `tests/unit/square/refresh-token-route.test.ts` covering all four branches from `contracts/api-routes.contract.md` § 2: missing/wrong `Authorization: Bearer ${CRON_SECRET}` → 401; no `square_oauth` row → 200 `{ ok: true, skipped: "not_connected" }`; expires_at ≥ now() + 7d → 200 `{ ok: true, skipped: "not_due" }`; refresh succeeds → 200 `{ ok: true, refreshed: true }` + new encrypted tokens persisted + `last_refreshed_at` set + `integration.square_token_refreshed` audit row with `ok: true`; refresh fails 3 times → 200 `{ ok: false, error }` + `refresh_failed_at` set + audit row with `ok: false`.
- [X] T025 [US1] Create `app/api/square/refresh-token/route.ts` implementing the cron handler per `contracts/api-routes.contract.md` § 2. Make T024 green. Always return 200 on completion (success or persistent failure) so Vercel Cron does not re-trigger; the data state on `refresh_failed_at` is the durable signal.

### Phase 3 scoped gate

- [X] T026 [US1] Run scoped gate: `npx playwright test tests/e2e/square-oauth.spec.ts -g "US1"` (must pass) + `npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)` + `npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)` + `npm run typecheck` + `npm test`. Dispatch the `speckit-design-auditor` agent against `components/lacquer/settings/square/` and `app/(studio)/settings/square/page.tsx` to confirm token-only styling.

**Checkpoint**: US1 ships independently — owner can connect, name, default, and disconnect. Token refresh keeps the connection alive. Card payments still are not yet possible (US2 ships that path).

---

## Phase 4: User Story 2 — Take a card payment from a customer (Priority: P1)

**Goal**: At checkout, front desk picks Card (or the only-card Charge default), the chosen terminal cloud-prompts the customer for tap/insert + tip, and the cart automatically advances to Done when the webhook fires (or polling observes success within 10s if the webhook is delayed).

**Independent Test**: With Square connected from US1 and a paired sandbox terminal, start a ticket, add a service, pick Card, the e2e Square stub returns a `SUCCEEDED` checkout, simulate the webhook arrival, confirm the cart screen flips to Done with the captured tip recorded on the payment row.

### Tests for User Story 2

- [X] T027 [P] [US2] Write `tests/unit/square/terminal-checkout.test.ts` covering `terminal.createCheckout` idempotency key shape (must equal `${ticket_id}:${payment_id}` exactly per R1); `terminal.getCheckout` correctly maps Square's `PENDING|IN_PROGRESS|COMPLETED|CANCELED|CANCEL_REQUESTED` to our domain status set. Red before T031 lands.
- [X] T028 [P] [US2] Write `tests/unit/square/retry-creates-new-row.test.ts` covering the per-attempt-row contract (FR-015, clarification Q1): given a `failed` payment row, calling `sendCardToTerminal` again does NOT mutate the failed row; it INSERTs a fresh `pending` row with a brand-new `payment_id`; both rows persist; the idempotency key passed to the stubbed Square SDK differs between the two attempts. Red before T034 lands.
- [X] T028a [P] [US2] Write `tests/unit/square/webhook-replay-idempotent.test.ts` covering FR-019 / SC-005 directly: given a `pending` payment row, invoke `handleTerminalCheckoutUpdated` twice with the same `terminal.checkout.updated → SUCCEEDED` event (same `event_id`, same `square_terminal_checkout_id`, same `payment_ids[]`) → assert exactly ONE payment-row mutation (`status='succeeded'` once, `tip_cents` set once), exactly ONE ticket transition to `paid`, exactly ONE `payment.captured` audit row, exactly ZERO additional rows. Also assert that a second INSERT attempting `status='succeeded'` with the same `square_terminal_checkout_id` would fail on the unique partial index `payments_unique_succeeded_terminal_checkout_idx` (defense-in-depth). Red before T031 lands.
- [X] T029 [P] [US2] Write `tests/e2e/card-payment-happy.spec.ts` covering the US2 happy path: connect Square via the stub → open ticket → add service → pick Card → e2e stub primes `createCheckout(returnStatus='pending')` and then `simulateWebhook({type:'terminal.checkout.updated', status:'COMPLETED', tip_money:{amount:800}})` after a 500ms delay → cart advances to Done within 1s of the webhook → DB shows `payments.status='succeeded'`, `payments.tip_cents=800`, `payments.raw IS NOT NULL`, `tickets.status='paid'`; audit row `payment.captured` with `payload.method='card'` exists. `describe` named `US2: Take a card payment` so `-g "US2"` matches.
- [X] T029a [P] [US2] Write `tests/e2e/card-payment-polling-fallback.spec.ts` covering SC-004 directly: connect Square via the stub → open ticket → add service → pick Card → e2e stub primes `createCheckout(returnStatus='pending')` AND `getCheckout(returnStatus='COMPLETED', tip_money:{amount:500})` BUT never invokes `simulateWebhook` → assert the waiting screen advances to Done within 10 seconds of the customer-side success (via the 5s polling loop, max 2 polls) → assert `payments.status='succeeded'`, `payments.tip_cents=500`, `tickets.status='paid'`. Also under `describe` US2 so `-g "US2"` matches.

### Implementation for User Story 2

- [X] T030 [P] [US2] Extend `lib/square/terminal.ts` (created in T016) with `createCheckout({ticketId, paymentId, amountCents, deviceId, referenceId})`, `getCheckout(checkoutId)`, and `cancelCheckout(checkoutId)`. Each call uses the deterministic idempotency key `${ticketId}:${paymentId}` for `createCheckout`; `getCheckout` and `cancelCheckout` use the Square SDK's standard parameters. Make T027 green.
- [X] T031 [US2] Extend `lib/square/webhooks.ts` (created in T014) with `parseEvent(jsonString): SquareWebhookEvent | null` and `handleTerminalCheckoutUpdated(event, opts: {db})`. The handler routes per `contracts/webhooks.contract.md` § 3 event matrix: `PENDING|IN_PROGRESS|CANCEL_REQUESTED` → no-op (200); `COMPLETED` → lookup payment by `square_terminal_checkout_id`, call `pos_record_card_payment(paymentId, 'succeeded', tipCents, squarePaymentId, raw, null)`; `CANCELED` → call same RPC with `'failed'` + `failure_reason='cancelled_by_operator'`. Reject (return 401) when `event.merchant_id` ≠ `square_oauth.merchant_id`. Idempotency invariants from § 4 enforced by the RPC's `status='pending'` predicate (already in T004) — the handler itself just dispatches.
- [X] T032 [US2] Create `app/api/webhooks/square/route.ts` as a POST handler: read raw body via `await request.text()`, call `lib/square/webhooks.verifySignature(rawBody, request.headers.get('x-square-hmacsha256-signature'), process.env.SQUARE_WEBHOOK_SIGNATURE_KEY!, request.url)` → 401 on false; parse JSON; route via `handleTerminalCheckoutUpdated`; return 200 `{ok:true}` (or `{ok:true, ignored:true}` for unknown/unsupported). Log per `contracts/webhooks.contract.md` § 6.
- [X] T033 [P] [US2] Create `app/api/square/terminal-checkout/[id]/route.ts` (GET) per `contracts/api-routes.contract.md` § 1 — auth via `requireStudioSession()`; load `payments` row; if `pending` AND `created_at < now() - interval '5 minutes'` call `pos_record_card_payment(... 'failed', 0, null, '{"kind":"polling_expired"}', 'expired')` first; return the `PollResponse` shape with `Cache-Control: no-store`. (The lazy-expiration test is T039; this task ships the route; T039 turns red on a stub before T039's fix lands.)
- [X] T034 [US2] Extend `app/(studio)/checkout/_errors.ts` per `contracts/server-actions.md` § "Error class layout" with `TerminalDeviceRequiredError`, `SquareCheckoutCreateFailedError`, `PaymentNotFoundError`, `PaymentNotCancellableError`. Extend `app/(studio)/checkout/actions.ts` with `sendCardToTerminal(ticketId, deviceId?)` per `contracts/server-actions.md`: validate ticket open + no unpriced lines + total > 0 + Square connected + not in `refresh_failed_at` state + resolve deviceId (arg > default > single-device fallback); INSERT a fresh `pending` Payment row (always — never reuse a failed row); call `lib/square/terminal.createCheckout`; UPDATE the row with the returned `square_terminal_checkout_id`; on Square failure UPDATE the row to `failed` with `failure_reason='square_unreachable'` then throw `SquareCheckoutCreateFailedError`. Make T028 green.
- [X] T035 [P] [US2] Create `lib/realtime/payments.ts` exporting `subscribePaymentChanges(ticketId, callback): () => void` per research R6. Wraps `supabase.channel(...).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments', filter: 'ticket_id=eq.${ticketId}' }, callback).subscribe()`. Returns an `unsubscribe()` function (not the raw channel — research R10 invariant). JSDoc the cleanup contract.
- [X] T036 [P] [US2] Create `components/lacquer/checkout/card-waiting.tsx` adapted verbatim from `design-system/prototypes/transaction/FlowSingle.jsx:127–148` — same SquareTerminalIcon glyph, same `<DotPulse/>`, same copy "Hand the terminal to your client" and "Waiting for payment confirmation…", same "Cancel and pick a different method" link. Props: `amountCents: number`, `deviceFriendlyName: string`, `onCancel: () => void`. All values resolve to tokens in `styles/tokens.css`; currency uses tabular numerals.
- [X] T037 [US2] Modify `components/lacquer/checkout/payment-tiles.tsx` so the Card tile is enabled when `squareConnected && devicesAvailable >= 1`; otherwise disabled with explanatory tooltip ("Connect Square in settings to accept cards" or "No Square Terminal paired — pair one in the Square Dashboard"). Add a "Send to Square Terminal · $X" CTA when Card is the picked method (or when it's the only available method).
- [X] T038 [US2] Modify `app/(studio)/checkout/[ticketId]/page.tsx` to pass new props to `checkout-screen.client.tsx`: `squareConnected: boolean`, `defaultDeviceId: string | null`, `pairedDevices: TerminalDevice[]`, `requiresReconnect: boolean`. Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` to add the Card path: on "Send to Square Terminal · $X" tap call `sendCardToTerminal(ticketId, deviceId?)` → transition to `<CardWaiting/>` stage; open the Realtime subscription via `lib/realtime/payments.ts`; also start a 5-second poll of `/api/square/terminal-checkout/[paymentId]` as the fallback; on either signal observing `status='succeeded'` advance to `<DoneScreen/>`; on `status='failed'` show inline retry/pick-another-method UI; ensure both the Realtime channel and polling timer are torn down on unmount/cancel/advance (research R10).

### Phase 4 scoped gate

- [X] T039 [US2] Run scoped gate: `npx playwright test tests/e2e/card-payment-happy.spec.ts -g "US2"` (must pass) + scoped prettier + scoped eslint + `npm run typecheck` + `npm test`. Dispatch `speckit-design-auditor` against `components/lacquer/checkout/card-waiting.tsx` and the modified `payment-tiles.tsx` to confirm fidelity to `FlowSingle.jsx:127–148`.

**Checkpoint**: US2 ships independently — front desk can take a card payment end-to-end. The cancel/recovery surface is functional only insofar as cancel returns to picker (no Square cancel call yet — that's US3). MVP scope is now complete.

---

## Phase 5: User Story 3 — Cancel or recover from a card payment in progress (Priority: P2)

**Goal**: Front desk can cancel a pending payment from the waiting screen; declines/device errors land on a clear failure screen with retry; cancel-vs-success races settle "Square wins" per FR-016a.

**Independent Test**: With a checkout sent to a stubbed terminal, before tapping a card, click Cancel and pick a different method — terminal stop is requested, cart returns to picker, choose Cash for same ticket and complete. Separately, simulate a decline → "Try again or pick different method" UI. Separately, simulate cancel followed by a delayed `SUCCEEDED` webhook → cart advances to Done with a "card was charged before cancel reached the terminal" notice.

### Tests for User Story 3

- [X] T040 [P] [US3] Write `tests/unit/square/cancel-vs-succeed-race.test.ts` covering the FR-016a invariant per research R2: given a `pending` payment row, `cancelTerminalPayment` calls `terminals.cancelCheckout` and the Square stub returns `{status: 'COMPLETED', tip_money: 500}` → the RPC settles the row to `succeeded` with `tip_cents=500`; the audit log carries both `payment.cancelled` (operator intent, `resolved_status: 'race_succeeded'`) AND `payment.captured` (RPC outcome). Red before T044 lands.
- [X] T041 [P] [US3] Write `tests/unit/square/expired-payment.test.ts` covering the FR-021a invariant per research R5: a `pending` row created at `now() - interval '5 minutes 1 second'` polled via the helper returns `failed/expired` and persists the transition + audit row; a `pending` row at `now() - interval '4 minutes 59 seconds'` returns `pending` and does not mutate. (The polling route was created in T033; this test exercises its expiration logic; expect it to fail if the route's `created_at < now() - interval '5 minutes'` branch is missing or off-by-one.)
- [X] T041a [P] [US3] Write `tests/unit/square/expired-then-succeeded.test.ts` covering the FR-021a + FR-016a escape hatch in `data-model.md` § 4 RPC: given a payment row that has already been marked `failed (failure_reason='expired')` by the polling endpoint, invoke `handleTerminalCheckoutUpdated` with a late `terminal.checkout.updated → SUCCEEDED` event for the same `square_terminal_checkout_id` → assert the row flips to `succeeded` (Square wins), the ticket flips to `paid`, the audit log carries `payment.captured` AFTER the prior `payment.failed (expired)`, and the row's `failure_reason` is cleared. Also assert that any OTHER `failed` reason (e.g., `'declined'`, `'cancelled_by_operator'`) does NOT receive this override — a late SUCCEEDED for a declined row is a no-op (the RPC's escape hatch is scoped narrowly to `expired`).
- [X] T042 [P] [US3] Write `tests/e2e/card-payment-cancel.spec.ts` with two scenarios: (a) US3a — checkout sent → before card-tap, click Cancel and pick a different method → stub asserts `cancelCheckout` was called → cart returns to picker → choose Cash → ticket flips paid via cash flow; (b) US3b — Square stub primes `getCheckout` to return `{status: 'CANCELED', failure: 'card_declined'}` → waiting screen advances to inline failure → Try again button creates a new pending row (per FR-015) → second attempt stubs SUCCEEDED → Done. `describe` named `US3: Cancel and recover` so `-g "US3"` matches.
- [X] T043 [P] [US3] Write `tests/e2e/card-payment-race.spec.ts` covering FR-016a end-to-end: checkout sent → tap Cancel → 200ms later `simulateWebhook({status:'COMPLETED', tip_money:600})` → Done screen appears showing the tip + the notice text "Card was charged before cancel reached the terminal." Audit log carries both `payment.cancelled` (`resolved_status: 'race_succeeded'`) and `payment.captured`. Also under `describe` US3.

### Implementation for User Story 3

- [X] T044 [US3] Extend `app/(studio)/checkout/actions.ts` (modified in T034) with `cancelTerminalPayment(paymentId)` per `contracts/server-actions.md`: validate row is card-method + status pending; call `lib/square/terminal.cancelCheckout(squareCheckoutId)`; inspect Square's response → `CANCELED` → call RPC with `failed`+`cancelled_by_operator` → return `{ resolvedStatus: 'cancelled' }`; `COMPLETED` → call RPC with `succeeded` + tip → return `{ resolvedStatus: 'race_succeeded' }` (this is the Square-wins path); unreachable → return `{ resolvedStatus: 'still_pending' }` and let polling/webhook resolve. Always emit `payment.cancelled` audit (operator intent) regardless of resolved status. Make T040 green.
- [X] T045 [US3] Modify `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx` (modified in T038) so the waiting screen's Cancel link invokes `cancelTerminalPayment(paymentId)`: on `cancelled` → return to picker; on `race_succeeded` → advance to Done with a one-time toast "Card was charged before cancel reached the terminal. Showing the successful payment."; on `still_pending` → keep the waiting screen open and let the existing realtime/poll path handle it. Add the failure inline-screen variant for non-cancel failures: copy "Card declined" or "Device error" with two buttons "Try again" (calls `sendCardToTerminal` again, which inserts a fresh row per T034) and "Pick a different method" (returns to payment-tiles).

### Phase 5 scoped gate

- [X] T046 [US3] Run scoped gate: `npx playwright test tests/e2e/card-payment-cancel.spec.ts tests/e2e/card-payment-race.spec.ts -g "US3"` (both must pass) + scoped prettier + scoped eslint + `npm run typecheck` + `npm test`. Confirm Vitest suite includes T040 + T041 green. Dispatch `speckit-design-auditor` against the modified checkout-screen.client.tsx (the failure variant + the race-notice toast).

**Checkpoint**: US3 ships — the feature is now safe for live salon use. Cancel, decline, and the cancel-vs-success race are all handled correctly.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final integration verification, full gate, design-system pass, and the live-sandbox developer pass per `quickstart.md` § 13.

- [X] T047 [P] Run the full pre-push gate set per `CLAUDE.md` § Pre-push quality gates: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e`. All five must be green. (E2E runs the full suite, including the prior phases' specs, to catch regressions in cash-only and cart-polish flows.)
- [X] T048 [P] Dispatch `speckit-design-auditor` once over all touched UI files in this branch (`components/lacquer/checkout/card-waiting.tsx`, `components/lacquer/checkout/payment-tiles.tsx`, `components/lacquer/settings/square/*.tsx`, `app/(studio)/settings/square/page.tsx`, `app/(studio)/settings/square/square-settings.client.tsx`, `app/(studio)/checkout/[ticketId]/checkout-screen.client.tsx`). Confirm PASS on every value tracing to a token and every prototype mapping holding (`FlowSingle.jsx:127–148` for card-waiting; settings-staff/services shell for settings-square). <!-- Manual audit PASS (Phase 6, T048): all 11 files token-only; zero raw hex/rgb/px/rem values found by grep; FlowSingle.jsx:127–148 prototype mapping holds for card-waiting; Phase 3 fixes (Link2 size=16, maxWidth=calc(var(--space-16)*5)) verified in place. -->
- [X] T049 Update `docs/system-design.md` § Square integration details with two short addenda: (a) the auto-expire-on-poll behavior (5-minute lazy expiration, no cron — link this spec); (b) the `square_devices.is_default` field as the salon-default terminal mechanism. Keep the existing language about "no server-side cron sweep in v1" — it remains accurate.
- [ ] T050 Live Square Sandbox developer verification per `quickstart.md` § 13: one developer runs the full sandbox e2e on their machine (OAuth → card payment → cancel → decline using sandbox card `4000 0000 0000 0002`). Record the four ticks in the PR description: "Live sandbox e2e: OAuth ✓ / Card payment ✓ / Cancel ✓ / Decline ✓". <!-- T050: BLOCKED — requires developer-machine live Square Sandbox run (quickstart.md § 13). Cannot be performed by an automated subagent. -->
- [ ] T051 Open the PR. CI runs the same full gate set (T047) and the `db-migrate-preview` GitHub Action auto-applies `0008_square_terminal_payment.sql` to the preview Supabase project before the Vercel preview deploy runs. Confirm both succeed before merge. <!-- T051: BLOCKED on T050 — user must open PR after live verification. -->

## Phase 6 — supplemental fix (post-T047)

- [X] T047a (post-hoc) Fix pre-existing data hygiene bug in `tests/e2e/services.spec.ts:293` — the snapshot SELECT around the destructive `(f)` empty-state test did not include `services.presets`, so after the wipe+restore the Nail art row's quick-pick chips were lost and the subsequent `tests/e2e/checkout-variable-price.spec.ts` test failed when it ran later in the full suite. Added `presets` to the snapshot column list. Pre-existing since 013-cart-polish added the column.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** — no dependencies; start immediately. All three Setup tasks are `[P]`.
- **Foundational (Phase 2)** — depends on Setup. Blocks every user-story phase. T004 → T005 → T006 is sequential (migration → apply → typegen). T007 (Vault secret) and T012 (e2e stub) can run in parallel with the schema track. T009 (client factory) is `[P]`. T010 → T011 sequential (test → impl). T013 → T014 sequential (test → impl).
- **US1 (Phase 3)** — depends on Foundational. T015 (e2e test) is `[P]` with the implementation tasks but expected to fail until they land. T016/T017/T020/T021/T022 can run in parallel (different files). T018 depends on T016 + T017. T019 depends on T011 + T017 + T018. T023 depends on T018 + T020 + T021 + T022 + T019. T024 → T025 sequential (test → impl). T026 (gate) is last in the phase.
- **US2 (Phase 4)** — depends on Foundational; can be worked on in parallel with US1 if staffed, since it touches different surfaces. Within phase: T027/T028/T028a/T029/T029a (tests) all `[P]`. T030 extends T016's file (sequential after T016 lands). T031 extends T014's file (sequential after T014). T032 depends on T031. T033 is `[P]`. T034 depends on T030 + T031 (RPC contract). T035/T036 are `[P]`. T037 depends on T036 (uses the new component). T038 depends on T034 + T035 + T037. T039 (gate) is last.
- **US3 (Phase 5)** — depends on US2 (extends checkout actions and the waiting screen). Within phase: T040/T041/T041a/T042/T043 (tests) all `[P]`. T044 extends T034's file (sequential after T034). T045 modifies T038's file (sequential after T038 + T044). T046 (gate) is last.
- **Polish (Phase 6)** — depends on US1 + US2 + US3. T047 + T048 are `[P]`. T049/T050/T051 sequential at the end.

### Within each user story

- Tests are written first and expected to fail before implementation (per Constitution Principle IV, money critical path).
- Models / SQL functions before services that use them.
- Services / SDK wrappers before actions that call them.
- Actions before UI that invokes them.
- Per-phase scoped gate (`-g "USn"`, scoped prettier+eslint) MUST pass before the next phase starts (per `CLAUDE.md` § "Scoping intermediate phase gates").

### Parallel opportunities

- T001 + T002 + T003 (Setup) all in parallel.
- T004 (schema) + T007 (Vault secret) + T012 (e2e stub) + T009 (client factory) + T013 (webhook-sig test) + T010 (oauth-encryption test) in parallel; their sequential follow-ups (T005, T006, T011, T014) gate later phases.
- US1 and US2 can be developed in parallel by different developers once Foundational completes — they touch disjoint surfaces (US1: settings tab; US2: checkout + webhook handler).
- Within US1: T020/T021/T022 (three components) in parallel; T024 (refresh-token test) in parallel with everything else in US1.
- Within US2: T027/T028/T028a/T029/T029a (five tests) in parallel; T030/T031/T033/T035/T036 mostly in parallel (different files).
- Within US3: T040/T041/T041a/T042/T043 (five tests) in parallel.

---

## Parallel Example: User Story 2

After Foundational completes (T004–T014), one developer can run T027 + T028 + T029 + T030 + T035 + T036 simultaneously in a worktree (six different files, no overlap), then sequentially do T031 (extends T030's lib/square/terminal.ts is wrong — T031 extends T014's lib/square/webhooks.ts; T030 extends T016's terminal.ts), T032 (webhook route), T033 (polling route — `[P]` with T031/T032), T034 (action), T037 (modifies payment-tiles), T038 (modifies checkout-screen.client). Total wall-clock: roughly half the sequential time given six parallelizable tasks at the front.

---

## Implementation Strategy

- **Phase 1 + Phase 2 + Phase 3 (US1) is the first deliverable**. Owner-facing connect/disconnect flow plus daily token refresh. Ships as an independently-mergeable PR if needed.
- **Phase 4 (US2) is the MVP completion**. Front desk can take a card payment end-to-end. Failure recovery is minimal (cancel-to-picker only, no Square cancel call).
- **Phase 5 (US3) makes the feature production-safe**. Cancel + decline + race are all correctly handled. This is the minimum bar for live salon use.
- **Phase 6 (Polish)** is the final integration gate. The live-sandbox developer verification (T050) is the gate before merge — the stubbed e2e suite covers the logical paths, but only a live pass exercises Square's actual cloud-to-device flow and webhook signing.

**Total task count**: 54 (51 original + 3 coverage-gap tasks added after `/speckit-analyze`: T028a, T029a, T041a).
**Per user story**: US1 = 12 tasks (T015–T026); US2 = 15 tasks (T027–T039 plus T028a, T029a); US3 = 8 tasks (T040–T046 plus T041a).
**Setup/Foundational**: 14 tasks (T001–T014).
**Polish**: 5 tasks (T047–T051).
