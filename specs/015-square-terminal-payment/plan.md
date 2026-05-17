# Implementation Plan: Square Terminal Card Payment

**Branch**: `015-square-terminal-payment` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-square-terminal-payment/spec.md`

## Summary

Add the salon's first non-cash payment method by wiring Square Terminal into the existing checkout. The owner connects the salon's Square account once via OAuth in settings, names paired devices, and marks a default. At checkout, front desk picks **Card**, the chosen terminal cloud-prompts the customer for tap/insert + tip, and the ticket flips to paid as soon as Square confirms — driven by a signature-verified webhook with a 5-second polling fallback. Cancel-vs-success races are resolved by Square winning (FR-016a); per-attempt Payment rows preserve audit history (FR-015); pending rows older than 5 minutes are opportunistically expired by the polling endpoint (FR-021a) so no background cron is added.

**Technical approach**: introduce four new server modules under `lib/square/` (`client`, `oauth`, `terminal`, `webhooks`) that wrap the existing `square@^44.0.1` SDK; tokens are encrypted in Postgres via `pgcrypto` with the key sourced from Supabase Vault and exposed as a session GUC (`app.square_oauth_key`), per Constitution § Secrets at Rest. Schema changes ship as `supabase/migrations/0008_square_terminal_payment.sql` — new `square_oauth` and `square_devices` tables; `payments` gains `square_payment_id`, `square_terminal_checkout_id`, `raw jsonb`, `failure_reason text`, and the `payment_method` enum gains `'card'`; the `payments.tip_cents` check constraint is relaxed from `=0` to `>=0`; a new atomic RPC `pos_record_card_payment(payment_id, status, tip_cents, raw)` performs the payment-update + ticket-paid-flip + audit-log in one transaction (mirroring `pos_take_cash`'s shape). Settings adds a tab at `/settings/square` (RSC + Server Actions) that lists devices, edits friendly names, sets the default, and connects/disconnects. Checkout (`app/(studio)/checkout/[ticketId]/`) gains a Card path: a new `sendCardToTerminal` action seeds a `pending` Payment row and creates the Square terminal checkout, then transitions the UI to the existing waiting stage adapted from `FlowSingle.jsx:127–148` into a new `components/lacquer/checkout/card-waiting.tsx`. The waiting page subscribes via Supabase Realtime to `payments.status` for the open ticket (the only Realtime channel in this phase) and falls back to 5s polling against `/api/square/terminal-checkout/[paymentId]`. Webhooks land at `app/api/webhooks/square/route.ts` and verify `x-square-hmacsha256-signature` against `SQUARE_WEBHOOK_SIGNATURE_KEY`; an unverifiable or unknown-checkout webhook returns appropriately (401 / 200-noop) per the spec's edge cases. A daily Vercel Cron at `/api/square/refresh-token` (the only cron added) refreshes tokens before expiry.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 24 (Next.js 16 App Router; Server Components + Server Actions; Vercel Functions on the Node.js runtime per `vercel:knowledge-update` defaults — no Edge functions).

**Primary Dependencies**: Next.js 16, React 19, `square@^44.0.1` (already in `package.json`), `@supabase/supabase-js` + the existing typed client wrappers in `lib/db/`, shadcn/ui (Radix primitives), Tailwind v4, `lucide-react` (icons), `zod` (Server Action input validation, in repo). No new runtime dependencies; only configuration changes (a single `vercel.json` entry for the daily cron, or a `vercel.ts` if/when the repo migrates).

**Storage**: Supabase Postgres (hosted preview + prod). Migration `0008_square_terminal_payment.sql` adds: two new tables (`square_oauth`, `square_devices`); five new columns and one new enum value on `payments`; one constraint relaxation; one new RPC; one new Postgres function for `pgcrypto` decryption that reads the key from the `app.square_oauth_key` session GUC. RLS for new tables follows the existing convention — single `select to authenticated using (true)` policy; all writes via the service-role client. Migrations auto-apply via the two GitHub Actions per CLAUDE.md / Constitution § Schema drift forbidden.

**Testing**: Vitest + Testing Library (unit) for the Square SDK wrappers (`oauth.ts`, `terminal.ts`, `webhooks.ts` — including signature verification with valid/invalid/missing-signature fixtures), the `pos_record_card_payment` RPC tested through its calling action with a mocked Square SDK, the 5-min expiration helper, and the idempotency logic (replayed webhook produces no second mutation). Playwright (e2e) against a seeded local Supabase + a stubbed Square HTTP fixture (`tests/e2e/_square-stub.ts`) for the four user-story slices: US1 connect, US2 happy-path card payment, US3 cancel + decline recovery, and the cancel-vs-success race. Audit-log cursors per the e2e convention (`newAuditCursor()` / `getAuditLogRowsSince()` from `tests/e2e/_db.ts`). Square SDK calls are stubbed at the HTTP layer (intercepting `connect.squareupsandbox.com`); no live Square calls in CI.

**Target Platform**: Studio web shell on desktop browsers (Chromium/Safari/Firefox latest) for the checkout and settings flows; Vercel Functions (Node.js runtime, default 300s timeout, ample headroom) for `/api/webhooks/square`, `/api/square/terminal-checkout/[id]`, and `/api/square/refresh-token`. Webhooks tunneled via `cloudflared tunnel` in local dev per `docs/system-design.md`.

**Project Type**: Web application — single Next.js app (no separate backend repo). Files live under `app/(studio)/settings/square/`, `app/api/webhooks/square/`, `app/api/square/`, `app/(studio)/checkout/`, `components/lacquer/checkout/`, `components/lacquer/settings/`, `lib/square/`, `supabase/migrations/`, and `tests/`.

**Performance Goals**: From "Send to Square Terminal" tap to terminal-prompt visible on the device within 3s (Square cloud-push latency). From customer-tap-succeeded to Done screen advance within 1s when the webhook arrives directly (Realtime push), within 10s when the webhook is delayed/dropped (5s polling cadence × 2 polls worst case) — satisfies SC-003 and SC-004. Settings list of devices renders within 500ms after Square `listDevices` returns (cached for 60s within the request).

**Constraints**:
- **Constitution Principle I** — the new waiting screen and Square OAuth settings tab are token-only; the waiting screen adapts `FlowSingle.jsx` lines 127–148 verbatim (same SquareTerminalIcon glyph, same DotPulse, same copy "Hand the terminal to your client"); the settings tab follows the existing settings-tab pattern (`app/(studio)/settings/staff`, `app/(studio)/settings/services`).
- **Constitution Principle II** — every Square call is server-side; OAuth tokens, webhook signature key, and the pgcrypto decryption key never reach the browser. The OAuth callback is a route handler running on the server.
- **Constitution Principle III (NON-NEGOTIABLE)** — idempotency keys are deterministic: `${ticket_id}:${payment_id}` for `terminals.createCheckout`. Webhook processing is idempotent: replayed events update no row a second time (enforced by `status = 'pending'` predicate in the update + a unique partial index on `(square_terminal_checkout_id) WHERE status = 'succeeded'`). Every state-changing action records `actor_user_id` + `acting_as_staff_id` to `audit_log` via `lib/auth/audit.ts`; new verbs (`payment.failed`, `payment.cancelled`, `integration.square_connected`, `integration.square_disconnected`, `integration.square_token_refreshed`, `integration.square_device_renamed`, `integration.square_device_default_set`) are added to `AuditAction` and routed by `deriveEntityType`. Tip is captured from Square's response (never invented) and persisted on the Payment row; the existing `payments.tip_cents = 0` check constraint is relaxed to `>= 0` (cash-only callers are unaffected since they already pass `tip_cents = 0`).
- **Constitution Principle IV** — money critical path. Vitest unit on signature verification (valid / tampered / missing header / wrong algorithm), the per-attempt-row retry contract (red: assert old row left `failed`, new row created `pending`), the cancel-vs-success race resolver (red: assert succeeded webhook wins over local cancel), and the 5-min lazy-expiration helper. Playwright e2e on US2 happy path with stubbed Square + simulated webhook arrival, US3 cancel + decline, and a dedicated "cancel + late SUCCEEDED" spec. All red-first per the constitution.
- **Constitution Principle V** — out-of-scope items from the spec (gift cards, split tender, refunds, selling gift cards, manual entry, reporting/settlement) are honored. The system-design § "Square integration details" already documents this exact phase's approach — webhook + 5s polling, no server cron sweep — so this plan does not introduce a sweep cron. The opportunistic 5-min expiration happens **only** inside the polling endpoint when a request lands; rows belonging to closed tabs sit `pending` indefinitely per system-design. The only cron added is the documented daily token refresh.

**Scale/Scope**: One new schema migration (2 tables + 5 payments columns + 1 new RPC + 1 decryption SQL function). One new settings route group (`/settings/square` + `/settings/square/callback`). Three new API routes (webhook, polling, token-refresh cron). Four new `lib/square/` files (~700 LOC of typed wrappers + tests). ~6 new components under `components/lacquer/` (settings tab + checkout card path). ~7 new test files. Estimated ~1500–1900 LOC net change including migration and tests; this is the largest single phase in the v1 build and matches the user's framing of it as "the single biggest integration phase."

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.0.3.

| Principle | Status | How this plan satisfies it |
|-----------|--------|----------------------------|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | PASS | The card-waiting screen is adapted from `design-system/prototypes/transaction/FlowSingle.jsx:127–148` verbatim (SquareTerminalIcon, DotPulse, "Hand the terminal to your client" copy, the muted "Waiting for payment confirmation…" subtext, the "Cancel and pick a different method" link). The settings tab follows the established Lacquer settings-tab shell (`app/(studio)/settings/staff/page.tsx` is the pattern). All visual values resolve to tokens in `styles/tokens.css`. Icons are Lucide at 1.5px stroke; the SquareTerminalIcon glyph comes from the prototype (already in `design-system/`). Tabular numerals on every currency render. The post-design auditor (`speckit-design-auditor`) runs after any phase that touches `components/` or `app/`. |
| **II. Server-Authoritative Architecture** | PASS | Every mutating action is a Server Action: `connectSquareStart`, `disconnectSquare`, `renameDevice`, `setDefaultDevice`, `sendCardToTerminal`, `cancelTerminalPayment`. The OAuth callback handler at `app/(studio)/settings/square/callback/route.ts` exchanges the code on the server and never returns the access/refresh tokens to the browser. The webhook handler runs in a Node Vercel Function with the signature key read from `process.env.SQUARE_WEBHOOK_SIGNATURE_KEY`. The polling endpoint reads from Postgres (not Square — it returns the local payment row's current status, which the realtime channel and webhook both update). The Square SDK client is constructed inside `lib/square/client.ts` and is never imported from a client component (Vitest test enforces this with a static import-graph check). |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | PASS | Idempotency: `terminals.createCheckout` uses `${ticket_id}:${payment_id}` exactly as named in the Constitution and `docs/system-design.md` § Square integration details. Webhook processing is idempotent: the update predicate is `status = 'pending'` so a replayed `SUCCEEDED` event finds nothing to update and returns 200 with no-op; a `failed` row is never reverted; a `succeeded` row never re-flips a ticket. Square-wins (FR-016a): the update predicate matches `pending` AND any cancel-pending state — a late `SUCCEEDED` event wins over a local cancel because the cancel does not transition the row out of `pending` until Square confirms. Per-attempt rows (FR-015): the `sendCardToTerminal` action always INSERTs a fresh Payment row; failed rows are never mutated back to `pending`. Atomic capture: the `pos_record_card_payment` RPC performs payment-update + (if total covered) ticket-paid flip + audit-log insert in one transaction — failure of any rolls back all (mirrors `pos_take_cash`'s shape exactly, including `security definer` + service-role-only grant). Snapshot: the raw webhook payload is persisted to `payments.raw jsonb` for permanent audit trace. Tokens at rest: `square_oauth.access_token_encrypted` and `square_oauth.refresh_token_encrypted` are `bytea` columns written via `pgp_sym_encrypt(plain, current_setting('app.square_oauth_key'))`; the GUC is set from Supabase Vault at session start by the `lib/square/oauth.ts` helper. A raw `pg_dump` does not reveal plaintext tokens (verified by a unit test that connects without the GUC set and confirms decryption fails). The plaintext key never reaches the application except as a transient session-local Postgres setting. |
| **IV. Test-First for Critical Paths** | PASS | All four critical-path tests are red-first before implementation: (a) Vitest on `lib/square/webhooks.ts:verifySignature` with valid/tampered/missing-header/wrong-algorithm cases; (b) Vitest on the per-attempt-retry contract — `sendCardToTerminal` against an already-failed Payment row asserts a new row is inserted; (c) Vitest on the cancel-vs-success race — replay a `SUCCEEDED` webhook against a row whose local state is "cancel-requested" and assert it settles `succeeded`; (d) Vitest on the 5-min expiration helper — pending row older than 5 min returns `expired`, pending row at 4:59 returns the original status. Playwright e2e: `square-oauth.spec.ts` (US1 — full connect, list devices, rename, disconnect), `card-payment-happy.spec.ts` (US2 — pick Card, simulated webhook arrival, Done screen), `card-payment-cancel.spec.ts` (US3 — cancel before tap returns to picker; decline shows failure + Try Again), `card-payment-race.spec.ts` (cancel followed immediately by simulated `SUCCEEDED` webhook — Done screen wins). |
| **V. Scope Discipline & Cost Restraint** | PASS (with one tracked extension — see Complexity Tracking) | Out-of-scope items from the spec are honored. The Realtime channel is the FIRST Realtime channel added to the app (system-design § Files to create #14–15 keeps Realtime scoped narrowly until cart/checkout); this plan adds it ONLY for `payments.status` on the open ticket viewed from the waiting screen — no broader payment-table subscription. No background cron sweep for stuck-pending rows (system-design § Square integration details: "no server-side cron sweep in v1"); the spec's FR-021a 5-minute auto-expiration is satisfied opportunistically by the polling endpoint, not by a dedicated background job. The only cron added is the daily token refresh (`/api/square/refresh-token`) explicitly named in system-design § Square integration details. No new runtime dependencies beyond `square@^44.0.1` which is already in `package.json`. Cost envelope: Vercel Functions stay on Hobby (300s default; this feature's longest function is the webhook at ~100ms p99); Supabase usage adds two small tables and a small JSONB column on `payments`; no impact on the free-tier projection. |

**Initial gate: PASS.** Re-checked after Phase 1 design — see "Post-design Constitution Re-check" below.

## Project Structure

### Documentation (this feature)

```text
specs/015-square-terminal-payment/
├── plan.md                           # This file
├── research.md                       # Phase 0 — decisions (idempotency, race resolver, encryption key plumbing, polling endpoint shape, Realtime channel scope, token refresh, expired-payment policy, sandbox setup, test fixtures)
├── data-model.md                     # Phase 1 — square_oauth, square_devices, payments column additions, RPC contract, enum + constraint changes
├── contracts/
│   ├── server-actions.md             # Phase 1 — connectSquareStart, disconnectSquare, renameDevice, setDefaultDevice, sendCardToTerminal, cancelTerminalPayment
│   ├── webhooks.contract.md          # Phase 1 — signature verification rules, event handling matrix, idempotency invariants, response codes
│   ├── api-routes.contract.md        # Phase 1 — /api/square/terminal-checkout/[id] (polling), /api/square/refresh-token (cron)
│   └── audit.contract.md             # Phase 1 — new AuditAction verbs (payment.failed, payment.cancelled, integration.square_connected, etc.) + deriveEntityType update
├── quickstart.md                     # Phase 1 — developer setup: Square Sandbox creds in .env.local, cloudflared tunnel, dev OAuth, simulating a successful checkout, e2e Square stub
├── checklists/
│   └── requirements.md               # Spec quality checklist (from /speckit-specify)
└── spec.md                           # /speckit-specify output (post-/speckit-clarify)
```

### Source Code (repository root)

```text
supabase/
└── migrations/
    └── 0008_square_terminal_payment.sql          # NEW — square_oauth, square_devices; payments column additions (square_payment_id, square_terminal_checkout_id, raw, failure_reason); payment_method += 'card'; tip_cents constraint relaxed; pos_record_card_payment RPC; pgcrypto decryption helper SQL function

lib/square/
├── client.ts                                     # NEW — singleton SquareClient factory using SQUARE_ENVIRONMENT, lazily constructed per-request with the salon's decrypted access token (read via lib/square/oauth.ts)
├── oauth.ts                                      # NEW — startOAuth(returnUrl) → authorization URL; exchangeCode(code) → encrypted persist; readDecryptedTokens() (server-only); refreshIfNeeded(); revokeAndDelete(); the GUC plumbing for app.square_oauth_key
├── terminal.ts                                   # NEW — createCheckout({ticketId, paymentId, amountCents, deviceId, referenceId}); getCheckout(checkoutId); cancelCheckout(checkoutId); listDevices()
└── webhooks.ts                                   # NEW — verifySignature(rawBody, signatureHeader, signatureKey); parseEvent(jsonString); handleTerminalCheckoutUpdated(event, opts) → idempotent DB application

app/(studio)/settings/square/
├── page.tsx                                      # NEW — RSC: reads connection state + devices via lib/square + lib/db; renders the settings tab
├── actions.ts                                    # NEW — Server Actions: connectSquareStart, disconnectSquare, renameDevice, setDefaultDevice
├── callback/
│   └── route.ts                                  # NEW — GET handler: receives OAuth code, calls exchangeCode, redirects to /settings/square with a flash toast
└── square-settings.client.tsx                    # NEW — client island for inline rename, default-device radio, and the Disconnect confirm dialog

app/(studio)/checkout/
├── actions.ts                                    # MODIFY — add sendCardToTerminal(ticketId, deviceId), cancelTerminalPayment(paymentId); both wrap lib/square/terminal + audit
└── [ticketId]/
    ├── page.tsx                                  # MODIFY — pass square-connection state + default device + paired devices to checkout-screen.client
    └── checkout-screen.client.tsx                # MODIFY — Card payment tile flow: tap "Send to Square Terminal · $X" → call action → transition to <CardWaiting/> stage → on payment.status changes, advance to <DoneScreen/>; uses Realtime channel + 5s polling fallback

app/api/
├── webhooks/square/
│   └── route.ts                                  # NEW — POST handler: read raw body, verify signature (401 on fail), parse event, route to handleTerminalCheckoutUpdated, return 200
└── square/
    ├── terminal-checkout/[id]/
    │   └── route.ts                              # NEW — GET handler: returns the local payment row's current status; performs lazy 5-min expiration on `pending` rows older than 5 min before returning
    └── refresh-token/
        └── route.ts                              # NEW — GET handler (Vercel Cron, daily): calls lib/square/oauth.refreshIfNeeded(); records audit on success/failure

components/lacquer/checkout/
├── card-waiting.tsx                              # NEW — adapted from design-system/prototypes/transaction/FlowSingle.jsx:127-148; props: amountCents, deviceFriendlyName, onCancel; renders the SquareTerminalIcon glyph + DotPulse + copy
└── payment-tiles.tsx                             # MODIFY — Card tile becomes active when Square connected + ≥1 device paired; disabled with explanatory tooltip otherwise

components/lacquer/settings/square/
├── connect-card.tsx                              # NEW — "Connect Square" CTA + sandbox-vs-production hint; or "Connected to {merchant_name}" header + Disconnect
├── device-list.tsx                               # NEW — paired device rows: friendly-name input, default radio, last-seen indicator
└── reconnect-banner.tsx                          # NEW — shown when token refresh has failed; CTA to re-run OAuth

lib/auth/
└── audit.ts                                      # MODIFY — extend AuditAction with: "payment.failed", "payment.cancelled", "integration.square_connected", "integration.square_disconnected", "integration.square_token_refreshed", "integration.square_device_renamed", "integration.square_device_default_set". Extend deriveEntityType to map "integration.*" → "integration" (new entity_type value added to the return-type union).

lib/db/
└── types.ts                                      # MODIFY — regenerate from updated schema (convention: produced by `supabase gen types typescript`).

lib/realtime/
└── payments.ts                                   # NEW — subscribe(ticketId, callback) helper; wraps the supabase-js Realtime client; the only Realtime subscriber in v1

.env.example                                      # MODIFY — add SQUARE_OAUTH_KEY_VAULT_NAME (Supabase Vault secret name used as the pgcrypto key) and CRON_SECRET (Vercel Cron auth header); confirm SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET, SQUARE_ENVIRONMENT, SQUARE_WEBHOOK_SIGNATURE_KEY already present (verified — they are)

vercel.json                                       # NEW — register the daily cron entry for /api/square/refresh-token (the repo does not yet use vercel.ts; staying on vercel.json keeps the change minimal)

tests/
├── unit/
│   └── square/
│       ├── webhook-signature.test.ts             # NEW — verifySignature with valid / tampered / missing-header / wrong-algorithm fixtures
│       ├── terminal-checkout.test.ts             # NEW — createCheckout idempotency-key shape; getCheckout maps statuses correctly
│       ├── oauth-encryption.test.ts              # NEW — round-trip encrypt/decrypt; decrypt without GUC fails
│       ├── retry-creates-new-row.test.ts         # NEW — sendCardToTerminal against a `failed` payment inserts a fresh `pending` row
│       ├── cancel-vs-succeed-race.test.ts        # NEW — succeeded webhook against a cancel-requested row settles `succeeded`
│       └── expired-payment.test.ts               # NEW — lazy 5-min expiration helper
└── e2e/
    ├── square-oauth.spec.ts                      # NEW — US1: connect → list devices → rename → set default → disconnect
    ├── card-payment-happy.spec.ts                # NEW — US2: pick Card → terminal-stub returns SUCCEEDED → Done screen
    ├── card-payment-cancel.spec.ts               # NEW — US3a: cancel before customer taps → returns to picker; US3b: decline → "Try again or pick different method"
    └── card-payment-race.spec.ts                 # NEW — cancel + delayed SUCCEEDED → Done screen wins (FR-016a)

CLAUDE.md                                         # MODIFY — point the SPECKIT marker to specs/015-square-terminal-payment/plan.md
```

**Structure Decision**: Single Next.js project — same Option-1 layout used by every prior phase. No new top-level directories. The Square integration sits in three established lanes — `lib/square/` (server-side SDK wrappers), `app/(studio)/settings/square/` (owner-facing tab), and `app/api/...` (webhook + polling + cron) — and the checkout changes layer on top of the existing `app/(studio)/checkout/[ticketId]/` surface. The `lib/realtime/` directory is new but trivially scoped (one file, one subscription).

## Phase 0 — Research

See [research.md](./research.md). Topics resolved:

- R1 — Idempotency key for `terminals.createCheckout` and the consequence for retry semantics (validated against spec FR-015 + FR-021).
- R2 — Cancel-vs-success race resolution (FR-016a): how the SQL predicate enforces "Square wins" without a status-machine library.
- R3 — Pgcrypto encryption-at-rest plumbing for OAuth tokens, including the Supabase Vault → GUC handoff (Constitution § Secrets at Rest).
- R4 — Webhook signature verification: header name, body normalization, constant-time compare, why we MUST use the raw request body (not a parsed JSON re-stringify).
- R5 — Polling endpoint shape: returns local DB state (not a fresh Square API call); the polling endpoint also enforces lazy 5-min expiration so spec FR-021a is satisfied without a background cron (Constitution § Scope Discipline).
- R6 — Realtime channel scope: a single per-ticket subscription on `payments.status`; no broader broadcast in this phase.
- R7 — Daily token-refresh cron: schedule, retry policy, what to do when refresh fails persistently.
- R8 — Square Sandbox developer setup with `cloudflared tunnel` (already documented in system-design; this records the exact commands).
- R9 — E2E Square stub strategy: intercepting the SDK's HTTP layer to deterministically return statuses without live Square calls in CI.
- R10 — Realtime subscription cleanup: the waiting screen's channel must be torn down on navigation / cancel / unmount; documented as a cleanup invariant.

## Phase 1 — Design & Contracts

**Prerequisites:** `research.md` complete.

Generated artifacts:

- [data-model.md](./data-model.md) — new tables, column additions, constraint changes, the new RPC contract, and the pgcrypto SQL helper. Includes the unique partial index on `(square_terminal_checkout_id) WHERE status = 'succeeded'` that enforces webhook idempotency at the database level.
- [contracts/server-actions.md](./contracts/server-actions.md) — typed signatures, error classes, audit verbs emitted, and the shared prelude. New error classes live in `app/(studio)/checkout/_errors.ts` and `app/(studio)/settings/square/_errors.ts`.
- [contracts/webhooks.contract.md](./contracts/webhooks.contract.md) — handler shape, signature-verification rules, the `terminal.checkout.updated` event matrix, response codes, and the idempotency invariants the handler MUST satisfy.
- [contracts/api-routes.contract.md](./contracts/api-routes.contract.md) — `/api/square/terminal-checkout/[id]` (polling, gated by authenticated studio session) and `/api/square/refresh-token` (cron, header-protected with `CRON_SECRET` per Vercel convention).
- [contracts/audit.contract.md](./contracts/audit.contract.md) — new `AuditAction` verbs, `deriveEntityType` extension to include `"integration"`, and the per-verb payload shape.
- [quickstart.md](./quickstart.md) — step-by-step developer setup: Square Sandbox application, .env.local entries, Supabase Vault secret creation, the cloudflared tunnel command, running the OAuth flow against the local dev server, simulating a successful checkout via the e2e Square stub, and the verification checklist before any UI work is considered complete (per `design-system/SKILL.md` + this plan).

**Agent context update**: the `<!-- SPECKIT START -->` ... `<!-- SPECKIT END -->` block in `CLAUDE.md` is updated to point at `specs/015-square-terminal-payment/plan.md`.

### Post-design Constitution Re-check

Re-evaluated against v1.0.3 after Phase 1 artifacts were generated:

- **Principle I** — `card-waiting.tsx`'s adapted layout is preserved verbatim from `FlowSingle.jsx:127–148`. Settings tab follows the existing `app/(studio)/settings/staff/page.tsx` shell. No new tokens introduced. PASS.
- **Principle II** — every contract entry has a server-side enforcement point. The OAuth callback handler is a route handler (server only), not a client component. The polling endpoint reads only local DB state. PASS.
- **Principle III** — the data-model contract's unique partial index on `(square_terminal_checkout_id) WHERE status = 'succeeded'` provides a database-level idempotency guarantee in addition to the application-level `status='pending'` predicate. The audit contract names exactly the verbs the implementation will emit; nothing is silently logged or silently un-logged. The RPC contract mirrors `pos_take_cash`'s shape, preserving the atomic-transaction guarantee. PASS.
- **Principle IV** — every contract entry has a corresponding test file in the project structure. Test files are listed in the structure above with their red-first expectations called out in the Constitution Check table. PASS.
- **Principle V** — no scope addition between Phase 0 and Phase 1. The lazy-expiration design specifically avoids adding a cron (FR-021a + system-design constraint reconciled per R5). PASS.

**Post-design gate: PASS.**

## Complexity Tracking

> Filled because the plan introduces one new entity-type value to the audit-log vocabulary, one schema-constraint relaxation, and the first Realtime subscription channel in the app. Each is a small structural change to a constitution-blessed surface; each warrants an explicit justification.

| Change | Why needed | Simpler alternative rejected because |
|--------|------------|-------------------------------------|
| New `entity_type = "integration"` for `integration.square_*` audit verbs | Square connect/disconnect/token-refresh events do not fit any existing entity (auth = user/device sessions; staff = staff CRUD; service = catalog; ticket/payment = sales). Folding them under `auth` would muddy "who signed in" queries. | Folding under `auth`: rejected — audit queries on `entity_type='auth'` would then mix sign-ins with merchant-account connections, breaking the prefix-equals-meaning convention. Adding a per-verb-list to `deriveEntityType` instead of a new prefix: rejected — the existing convention is prefix-dispatch (verb prefix → entity_type); adding `integration` as a new prefix keeps the dispatch shape consistent. |
| Relaxing `payments.tip_cents` check from `= 0` to `>= 0` | The cash-only phase intentionally hard-coded `tip_cents = 0` because cash tips were out of scope (no tip dialog). Card tips are mandatory in this phase (FR-012); the constraint must allow positive values. | Adding a new `card_tip_cents` column: rejected — splits tip across two columns based on method, breaking the money-invariant query in Principle III (`tip_splits sum to payment.tip_cents`). Removing the check entirely: rejected — `>= 0` retains the non-negative invariant; `> 0` would forbid tip-zero card payments which are legitimate. |
| First Realtime subscription channel added to the app | The waiting-screen UX requires near-instant advance when the webhook fires (sub-second feel); polling every 5s is the fallback for missed webhooks, not the primary path. | Polling-only (5s cadence) for the primary path: rejected — fails SC-003's "perceived instant" feel and feels slower than Square's existing POS UX. Polling at 1s instead: rejected — that's effectively a busy loop with no DB-side scalability win, and an idle waiting screen would hammer the polling endpoint. |
