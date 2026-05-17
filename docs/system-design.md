# Tang Nails — System Design (v1)

> Status: approved 2026-05-12. Source of truth for v1 build.

## Context

We're building **Tang Nails**, a web-based salon management app for a single nail salon (Tang Nails). It will run on staff laptops, technician iPads, a front-desk POS, and a customer-facing iPad kiosk for walk-in sign-in. The visual design and component library are the **Lacquer** design system (vendored at `design-system/` in this repo, also in handoff zip in `~/Downloads`): shadcn/ui + Tailwind (OKLCH tokens) + Lucide + Inter, with full HTML/JSX prototypes for Calendar, Clients, Checkout, Walk-in, and End-of-Day surfaces.

**Why now:** the design is ready and the salon needs a single integrated tool that replaces the patchwork of paper, Square POS-only workflows, and ad-hoc client lists. **Constraint:** keep cloud cost to near-zero on free tiers, scaling to ~$25–45/mo only as backup/uptime needs demand. **Out of scope for v1:** a customer-facing self-booking app, SMS/email reminders, and multi-tenant SaaS — all deferred to later phases.

## Scope (v1)

In:
- **Calendar + Appointments** (drag/drop on the day/week view, per technician; soft-warn on tech overlap)
- **Services & Staff catalog** (services with default price/duration + per-tech duration overrides; staff with roles, schedules, and which services they perform)
- **Salon hours + closures** (weekly recurring open hours and one-off holiday/closure dates)
- **Clients (CRM)** with history, notes, tags, photos
- **Checkout / POS** with **Square Terminal** for cards, **Square Gift Card redemption** for e-gift, in-app cash handling, **split tender**, **voids**, and **refunds** (manager-PIN inline override)
- **Walk-in / Waitlist + iPad kiosk** with phone-number lookup (phone + name required; always creates/resolves a client)
- **End of Day** report + salon-wide cash drawer reconciliation + tip-allocation review
- **Auth**: device login (email/password or Google) + per-staff PIN "act-as" overlay (the *operator* at the device); the staff who *performed* a transaction is selected per-line in the Checkout avatar picker
- **Realtime sync** across devices for walk-ins, calendar, and ticket status
- **Installable PWA** (home-screen icon, full-screen) — no offline writes; service worker scope is `/(studio)` only

Out (deferred):
- Customer self-booking app (the Lacquer design system has a "Lacquer Book" mobile UI kit we can adopt later)
- Email/SMS reminders, marketing
- Multi-tenant / multi-salon
- Inventory management & product sales (`ticket_items.kind='product'` not in v1)
- Selling/issuing gift cards (redemption only in v1)
- Tax computation (schema reserves `tax_cents` + `services.taxable` + a settings row; no compute or UI in v1)
- Payroll/commissions reporting (read-only commission calc only)
- Native iOS/Android wrappers

## Design system — source of truth

The visual language, tokens, components, and reference layouts live in [`design-system/`](../design-system/) — a vendored copy of the [Claude Design project](https://claude.ai/design/p/019e0124-88cc-7ec5-b59a-055dd1301a03). The repo's `CLAUDE.md` enforces these rules; they're restated here so the spec is self-contained.

- **Tokens only.** `design-system/colors_and_type.css` is copied verbatim into `styles/tokens.css`. Every color, spacing, radius, shadow, and font value comes from a token. No raw hex codes, no off-scale spacing.
- **Components.** shadcn/ui primitives in `components/ui/*` composed into project-specific components in `components/lacquer/*`. No second component library.
- **Type.** Inter only, weights 400/500/600. Tabular numerals on every numeric column, time, and currency. Body 14px / 1.5.
- **Color.** Neutral foundation + `--primary` (Lacquer Rose) accent. Semantic colors muted. No gradients in chrome.
- **Spacing.** 4px base; only the scale `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- **Radii.** `4` inputs, `6` buttons, `8` chips, `12` cards, `16` sheets/dialogs, `999` pills.
- **Animation.** 150ms hover/press, 200ms popovers, 300ms sheets/dialogs, ease-out-expo. No bounce/spring/scale.
- **Icons.** Lucide only, 1.5px stroke, sized 16/20/24. No emoji in chrome.
- **Copy.** Calm, specific, second-person, sentence case, numerals always (`3 services`, `$45`). See `design-system/README.md` § "Content fundamentals."

**Workflow when implementing a UI surface:**
1. Find the matching prototype under `design-system/ui_kits/` or `design-system/prototypes/` (mapping below in § "Reuse from the design system handoff").
2. Adapt the JSX layout — do not redraw. Replace mock data with Supabase queries / Server Actions.
3. Verify every value traces to a token by comparing against `design-system/preview/*.html`.
4. Mark UI work complete only after this side-by-side check.

**Keeping in sync.** When the live Claude Design project changes, re-export the handoff zip and replace `design-system/` in a single commit. Tokens, prototypes, and `colors_and_type.css` are the only artifacts that must propagate; downstream files (`styles/tokens.css`, `components/lacquer/*`) are updated to match in the same commit.

## Architecture

**Stack:** Next.js 16 (App Router, RSC + Server Actions) on Vercel, Supabase (Postgres + Auth + Realtime + Storage), Square SDK on the server, shadcn/ui + Tailwind + Lucide.

```
                   ┌────────────────────────────┐
                   │    Vercel (Next.js 16)     │
   Browser ────────│   App Router · RSC · SA    │──── Square Node SDK ──► Square Terminal API
 (iPad/laptop)     │   API routes (webhooks)    │                         Square Gift Cards API
                   │   Edge: middleware/auth    │◄─── Square webhooks ───
                   └─────────────┬──────────────┘
                                 │ HTTPS / pg-style RPC
                   ┌─────────────▼──────────────┐
                   │          Supabase          │
                   │  Postgres (RLS) · Auth     │
                   │  Realtime (WebSocket)      │
                   │  Storage (photos)          │
                   │  Daily backups (PITR @Pro) │
                   └────────────────────────────┘
```

- **Frontend** is server-rendered Next.js. Data fetching for read-heavy pages (Calendar, Clients) happens in **React Server Components** against Supabase. Mutations use **Server Actions** that wrap Supabase calls. Client interactivity (drag/drop, dialogs, optimistic POS) uses **TanStack Query** for cache + invalidation and **Zustand** for ephemeral UI state.
- **Realtime** is a thin client-side subscription per surface (`/walkin`, `/calendar`, `/checkout`) using `supabase-js` channels — `postgres_changes` triggers TanStack Query invalidation.
- **Square integration** is fully server-side. Card-present is a 3-step dance: Server Action initiates a `Terminal Checkout` → Square pushes the device → on completion a webhook hits `/api/webhooks/square` → we update the ticket and Realtime broadcasts to the POS UI.
- **Auth** has two layers: (1) a long-lived **Supabase Auth session** for the *device user* (email/password or Google), and (2) a signed cookie `acting_as_staff_id` — the **operator** at the device — set after a staff member taps their name + PIN. The operator is *who pressed the buttons*; the tech who actually performed a service (and earns its tip/commission) is selected per-transaction via the avatar picker in Checkout and stored on `appointment.staff_id`, `payments.taken_by_staff_id`, and `tip_splits.staff_id`. Every write records both the device user and the operator in `audit_log`.
- **Authorization** lives in the **app layer** (Server Actions check `staff.role` for the current `acting_as_staff_id`); Postgres RLS just blocks anonymous access. Privileged actions (refunds, voids, settings edits) require a fresh **manager-PIN inline override** at the moment of the action.
- **Kiosk** is a separate route `/kiosk/[pairing_token]`. Pairing: an authenticated owner generates a token in Settings → types it into the kiosk → kiosk gets a long-lived JWT (until an owner sets `kiosk_sessions.revoked_at`) scoped to a single capability: write `walk_ins`. RLS enforces the rest.
- **Webhook fallback.** If a Terminal completion webhook is missed, the open Checkout page polls `/api/square/terminal-checkout/{id}` every 5s while any payment is `pending`. If the tab is closed, the payment stays pending until the ticket is reopened (acceptable for a single-salon workload — no server cron in v1).

## Repo layout

```
salon-management/
├── app/
│   ├── (auth)/
│   │   ├── login/                    # Supabase Auth UI
│   │   └── select-staff/             # PIN keypad to "act as"
│   ├── (studio)/
│   │   ├── layout.tsx                # App shell: 56px topbar, 240px sidebar
│   │   ├── calendar/                 # Day/week view, drag/drop appointments
│   │   ├── clients/                  # List, detail, history, notes
│   │   ├── checkout/[ticketId]/      # POS / ticket builder
│   │   ├── walkin/                   # Staff waitlist
│   │   ├── end-of-day/               # Cash drawer + day report
│   │   └── settings/                 # Services, staff, hours, Square OAuth, kiosk pairing
│   ├── kiosk/[token]/                # Customer-facing iPad UI (no shell)
│   └── api/
│       ├── webhooks/square/route.ts  # Signature-verified Square webhooks
│       └── square/                   # Server endpoints invoked by Server Actions
├── components/
│   ├── ui/                           # shadcn primitives
│   └── lacquer/                      # Project-specific composed components
├── lib/
│   ├── db/                           # Typed Supabase client + query helpers
│   ├── square/                       # Square SDK wrappers (terminal, gift cards, oauth)
│   ├── auth/                         # PIN, acting-as cookies, kiosk pairing
│   └── realtime/                     # Channel subscription helpers
├── styles/
│   ├── globals.css                   # Lacquer tokens (from design system zip)
│   └── tokens.css                    # OKLCH variables, font-face
├── supabase/
│   ├── migrations/                   # SQL migrations
│   └── seed.sql                      # Demo data for dev
└── public/
    ├── manifest.webmanifest          # PWA install
    └── icons/                        # App + kiosk icons
```

## Data model

```
auth.users (Supabase managed)
└─ staff (id, user_id?, display_name, role, pin_hash, color_token, active)
        role ∈ {owner, manager, technician, front_desk}
        user_id null = no email login (PIN-only staff)
        color_token references a Lacquer palette token (no free hex)

services (id, name, duration_min, price_cents, color_token, category, taxable, active)
        taxable: reserved for future tax computation; no effect in v1
staff_services (
  staff_id, service_id,
  duration_min_override?,                          -- nullable; falls back to services.duration_min
  PRIMARY KEY (staff_id, service_id)
)
staff_schedule (staff_id, weekday, start_time, end_time)
schedule_exceptions (staff_id, date, start_time?, end_time?, off boolean)

salon_hours (weekday PRIMARY KEY, open_time, close_time)   -- weekly recurring
salon_closures (id, date UNIQUE, reason)                   -- one-off holidays/closures

clients (id, phone, name, email, photo_url, notes, tags text[], created_at)
        UNIQUE (phone, name)                       -- phones stored as E.164; same phone allowed for different names (household)

appointments (
  id, client_id NOT NULL, staff_id, start_at, end_at,
  status,                                          -- booked | checked_in | in_service | completed | cancelled | no_show
  source,                                          -- booked | walk_in
  notes, created_by_user_id, created_by_staff_id, created_at
)
appointment_services (appointment_id, service_id, price_cents_snapshot, duration_min_snapshot)

walk_ins (
  id, client_id NOT NULL,
  requested_service_id?, requested_staff_id?,
  status,                                          -- waiting | seated | cancelled | no_show
  signed_in_at, seated_at, seated_appointment_id?
)

tickets (
  id, appointment_id?, walk_in_id?, status,        -- open | paid | partially_refunded | refunded | void
  subtotal_cents, tip_cents, discount_cents, tax_cents, total_cents,
  opened_by_staff_id, closed_by_staff_id, closed_at
)
        tax_cents reserved; always 0 in v1
ticket_items (
  id, ticket_id, kind,                             -- service | discount
  ref_id?, name_snapshot, qty, unit_price_cents,
  discount_pct?                                    -- when kind=discount and percent-style
)
payments (
  id, ticket_id, method,                           -- cash | square_card | square_egift
  kind,                                            -- payment | refund
  refunds_payment_id?,                             -- when kind=refund, points at the original payment
  amount_cents, tip_cents,
  square_payment_id?, square_terminal_checkout_id?, square_refund_id?,
  status,                                          -- pending | succeeded | failed
  processed_at, taken_by_staff_id,
  authorized_by_staff_id?,                         -- manager who PIN-approved a refund/void
  raw jsonb
)
tip_splits (id, payment_id, staff_id, amount_cents)
        sum of tip_splits.amount_cents per payment = payment.tip_cents
        seeded by auto-allocation (proportional to each staff's service revenue on the ticket);
        editable from the Checkout completion dialog and the End-of-Day Tips tab until the day is closed

gift_cards (id, square_gan UNIQUE, balance_cents_cached, last_synced_at)
        cache only — Square is source of truth; we never create GANs in v1

cash_drawer_sessions (
  id, opened_by_staff_id, opened_at, opening_cents,
  closed_by_staff_id?, closed_at?,
  expected_cents?, counted_cents?, variance_cents?, notes
)
        invariant: at most one session is open at a time, enforced by a partial unique index where closed_at IS NULL

audit_log (
  id, ts, actor_user_id, acting_as_staff_id,
  action,                                          -- controlled enum: appointment.created, payment.captured, refund.issued, void.issued, settings.updated, …
  entity_type, entity_id, payload jsonb
)

kiosk_sessions (id, token_hash, issued_by_user_id, issued_at, last_seen_at, revoked_at?)
        long-lived until revoked_at set by an owner in Settings

square_oauth (id, merchant_id, access_token_encrypted, refresh_token_encrypted, expires_at)
        encryption: pgcrypto symmetric; key stored in Supabase Vault and exposed to Postgres as GUC
        app.square_oauth_key, read only by lib/square/oauth.ts

settings (key text PRIMARY KEY, value jsonb)
        seeded rows include:
          salon.timezone           e.g. "America/New_York" (also mirrored in SALON_TZ env var)
          tax.enabled              false in v1
          tax.rate_bps             0
          discount.manager_threshold_cents   null (no threshold in v1)
```

**Snapshotting:** every `ticket_items` row and `appointment_services` row carries a price/duration snapshot, so editing a service later doesn't rewrite history.

**Authorization posture (single tenant):** authorization lives in the **app layer**, not RLS. RLS is enabled on every table with two minimal policies:

1. Any authenticated Supabase user can read all rows except `square_oauth.*_encrypted` and `audit_log.payload`.
2. The kiosk JWT can insert into `walk_ins` and read its own row; nothing else.

All business rules — refund authority, settings edits, manager thresholds — are enforced inside Server Actions, which read `staff.role` for the current `acting_as_staff_id`. The audit log records the device user and operator for every mutation; privileged actions also record the `authorized_by_staff_id` (the manager who PIN-approved).

## Domain flows

**Calendar — book/move appointment**
1. RSC loads `appointments + staff + services` for the visible day/week.
2. Drag-drop calls a Server Action `moveAppointment(id, staff_id, start_at)`.
3. Server validates: staff is on schedule, no overlap, services known. Updates DB.
4. Realtime `postgres_changes` event → all open Calendar tabs invalidate their query.

**Walk-in — kiosk to seated**
1. Customer types phone on `/kiosk/[token]`. Server Action `kioskLookupByPhone(phone)` returns either:
   - `match`: a list of `{client_id, first_name}` for every client sharing that phone (household phones may resolve to several names), or
   - `unknown`: empty list.
2. Kiosk shows a name picker ("Welcome back — who is this?") for known phones, or a "What's your name?" field for unknown phones. Customer picks/enters their name; the server resolves or creates the matching `clients` row. **No anonymous walk-ins** — every walk-in references a real `client_id`.
3. Customer picks a service; submits. Server inserts `walk_ins` row with the resolved `client_id`, status `waiting`.
4. Realtime broadcast → staff `/walkin` waitlist updates instantly.
5. Staff taps "Seat" → Server Action creates an `appointment` (source `walk_in`, status `checked_in`), links `walk_ins.seated_appointment_id`, sets walk-in status `seated`.

**POS — services, discounts, split tender, voids, refunds**
1. From an appointment or walk-in, staff opens `/checkout/[ticketId]` (creates ticket if absent).
2. Add items (services from `appointment_services` snapshots, optional discount as `ticket_items.kind='discount'`). For each service line, the avatar picker assigns the tech who actually performed it (defaults to `appointment.staff_id`). No products in v1.
3. Stage one or more **payments** that together cover `tickets.total_cents` (split tender supported). Each payment names its method:
   - **Cash**: Server Action records a `payments` row directly with `status='succeeded'`, increments the open cash drawer's expected balance.
   - **Square card**: Server Action calls Square `terminals.createCheckout({device_id, amount_money, reference_id: ticket_id})`. UI shows "Tap card on terminal." Webhook `terminal_checkout.updated` → update `payments.status='succeeded'`, broadcast to UI. While status is `pending`, the page polls `/api/square/terminal-checkout/{id}` every 5s as a webhook-miss fallback.
   - **E-gift card**: Server Action calls Square `giftCards.retrieveGiftCardFromGAN`, then creates a Square `payment` with `source_id: gift card id`. Same webhook completion path.
4. Tip enters on each payment. Once all payments succeed, the **tip-split dialog** auto-allocates the combined tip proportionally to each tech's service revenue on the ticket. Staff confirms or adjusts; rows are written to `tip_splits`. Splits remain editable from the End-of-Day Tips tab until the day is closed.
5. Receipt rendered in-browser from live ticket data; printable via browser print / AirPrint. (No stored receipt artifact.)
6. **Void** (same-day, ticket not yet closed for the day): manager-PIN inline override → ticket.status='void', each completed `payments` row gets a corresponding `kind='refund'` payment that calls Square `refunds.create` (card) or reverses cash drawer (cash). `audit_log` records both operator and authorizing manager.
7. **Refund** (any time after close): manager-PIN inline override → creates one or more `payments` rows with `kind='refund'`, `refunds_payment_id` pointing at the original. Square `refunds.create` issued for card payments; cash refunds adjust whichever cash drawer session is currently open. Ticket status → `partially_refunded` or `refunded` depending on remaining balance.

**End of Day**
1. Owner/manager opens `/end-of-day`.
2. Aggregates `payments` for the day grouped by method, by staff, with tips. Refunds netted into the totals.
3. **Tip allocation review**: lists multi-tech tickets with their current `tip_splits`; manager can revise. Once the day is closed, splits are locked.
4. **Cash drawer reconciliation**: prompts for counted cash, computes `variance = counted - (opening + cash_payments_today - cash_refunds_today)`. Stores `cash_drawer_sessions` close.
5. Print export of day report (HTML print stylesheet — no PDF lib needed).

## Square integration details

- **OAuth setup once**: Settings → "Connect Square" → standard OAuth. Tokens encrypted at rest via `pgcrypto` symmetric key stored in Supabase Vault and exposed to Postgres as the GUC `app.square_oauth_key` (read only by `lib/square/oauth.ts`). Refresh handled by a daily Vercel Cron.
- **Terminal device IDs**: list devices via `terminals.listDevices`, persist user-friendly names. Choose device per checkout. The `square_devices.is_default` boolean marks the salon-default terminal (enforced one-true-row per salon by a partial unique index); `sendCardToTerminal` falls back to this row when the caller doesn't pass an explicit `deviceId`, so the typical single-terminal salon never has to pick a device on every charge. Set via Settings → Square → tile radio.
- **Gift cards (redeem only)**: balance lookup via `giftCards.retrieveGiftCardFromGAN`; create a Square `payment` with `source_id: gift card id`. We never issue GANs or sell gift cards in v1.
- **Webhook security**: verify `x-square-hmacsha256-signature` against the `SQUARE_WEBHOOK_SIGNATURE_KEY`. Reject otherwise.
- **Webhook fallback**: open Checkout pages poll `/api/square/terminal-checkout/{id}` every 5s while any payment is `pending`. If staff closes the tab, the payment remains `pending` until someone reopens the ticket. No server-side cron sweep in v1. Stale `pending` rows are aged out **lazily** by the same polling endpoint: when a poll lands on a row whose `created_at` is more than 5 minutes old AND Square still reports `PENDING/IN_PROGRESS`, the route flips the row to `failed (failure_reason='expired')` and emits a `payment.failed` audit. A late-arriving SUCCEEDED webhook for an already-expired row is honored — the RPC's narrow escape hatch flips it back to `succeeded` (Square wins). See `specs/015-square-terminal-payment/` for the full state machine.
- **Sandbox in dev**: every developer uses Square Sandbox; webhooks tunneled with `cloudflared tunnel` (free) to `localhost:3000/api/webhooks/square`.
- **Idempotency**: every Square call passes a deterministic `idempotency_key`. Terminal checkouts: `${ticket_id}:${payment_id}` (one per `payments` row). Refunds: `${payment_id}:refund:${refund_payment_id}`.

## Auth: device login + acting-as PIN

- `staff` rows can exist with or without a `user_id` (Supabase auth user). Owners and managers usually have one; technicians may not.
- After Supabase login, middleware redirects to `/select-staff` if no `acting_as_staff_id` cookie. The user picks a staff name and types a PIN. Server validates against `pin_hash` (bcrypt) and sets a signed httpOnly cookie with a **12-hour hard TTL** (no sliding extension). On expiry, the next Server Action redirects back to `/select-staff`.
- **Operator vs tech attribution.** `acting_as_staff_id` identifies the *operator* — whoever is physically at the device. The staff who performed a service (and earns its tip/commission) is selected per line via the Checkout avatar picker and persisted on `appointment.staff_id`, `payments.taken_by_staff_id`, and `tip_splits.staff_id`. The operator is *who pressed the buttons*; the tech is *who did the work*.
- **Switch staff** (shift change) is a button in the studio app shell that clears the cookie and returns to `/select-staff`. No mid-flow re-PIN is required for ordinary work — only for privileged actions.
- **Manager-PIN inline override** is the pattern for refunds, voids, settings edits, and other owner/manager-only actions: anyone can initiate, but at the moment of submission a PIN dialog asks for an owner/manager PIN. The authorizing manager is recorded as `payments.authorized_by_staff_id` (or in the relevant entity) and in `audit_log`.
- Every Server Action reads both `auth.uid()` (device) and `acting_as_staff_id` (cookie) and writes both to the audit trail.
- **No PIN lockout.** Device login is the security boundary; PIN is identity selection. Failed PIN attempts are logged to `audit_log` but never lock a staff tile. (See "Risks" — easy to add later if needed.)
- Kiosk uses a separate route + JWT issued at pairing; bypasses the staff PIN entirely. The kiosk session is long-lived until an owner sets `kiosk_sessions.revoked_at`.

## Realtime channels

| Surface       | Channel / source                  | Trigger        |
|---------------|-----------------------------------|----------------|
| Calendar      | `postgres_changes` on `appointments` filtered by day | INSERT/UPDATE/DELETE |
| Walk-in       | `postgres_changes` on `walk_ins`  | INSERT/UPDATE  |
| Checkout      | `postgres_changes` on `payments` filtered by ticket  | UPDATE         |
| End of Day    | none — page is point-in-time      | n/a            |

`supabase-js` subscriptions invalidate the corresponding TanStack Query keys; React re-renders.

## PWA

- `public/manifest.webmanifest` with `display: standalone`, theme color from Lacquer tokens, icons in 192/512.
- Service worker scope is **only** `/(studio)` — registered from the studio layout, not from `/kiosk` or `/(auth)`. The kiosk runs without a service worker so a token revoke is picked up on next load.
- The studio SW caches the app shell + static assets only. **No offline data writes** — if the network is gone, the studio shows a top banner ("Reconnecting…" using the Lacquer `notice` token) and queues nothing.
- Install prompt: a small banner on Settings page for owners; manual "Add to Home Screen" instructions for kiosk.

## Files to create (ordering for the plan)

1. `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts` — scaffolding
2. `styles/tokens.css`, `styles/globals.css` — copy Lacquer design tokens verbatim
3. `components/ui/*` — `npx shadcn add` for button, card, dialog, sheet, input, table, tabs, dropdown-menu, popover, select, calendar, command, tooltip, toast, badge, avatar
4. `supabase/migrations/0001_init.sql` — full schema above (incl. `salon_hours`, `salon_closures`, `tip_splits`, `settings`) + minimal RLS policies (authenticated-read, kiosk-insert-walk_ins)
5. `lib/db/server.ts`, `lib/db/browser.ts` — typed Supabase clients
6. `lib/time/*` — UTC ↔ `SALON_TZ` formatting helper used by every formatter
7. `lib/auth/*` — login, select-staff, kiosk pairing, manager-PIN override helper
8. `app/(auth)/login`, `app/(auth)/select-staff`, middleware (12h hard expiry)
9. `app/(studio)/layout.tsx` — shell from design system + "Switch staff" button + "Reconnecting…" banner
10. `app/(studio)/settings/{services,staff,onboarding,hours,closures,square,kiosk}` — admin first (data prerequisite). The `onboarding` tab is owner-only and runs the invite / offboard / hard-remove lifecycle for staff who can sign in by email (see `specs/012-user-onboarding/`).
11. `app/(studio)/calendar` — depends on staff/services + hours/closures
12. `app/(studio)/clients` — independent
13. `app/(studio)/walkin` + `app/kiosk/[token]` — pair feature (phone + name kiosk flow)
14. `lib/square/*` — Terminal, Gift Cards (redeem only), OAuth, webhooks
15. `app/(studio)/checkout/[ticketId]` + `app/api/webhooks/square` — POS with split tender, voids, refunds, tip-split dialog
16. `app/(studio)/end-of-day` — last; consumes everything else (incl. tip allocation review)
17. `public/manifest.webmanifest`, service worker (scope `/(studio)`), icons

## Reuse from the design system handoff

The handoff zip ships JSX prototypes that map almost 1:1 to v1 surfaces. Adapt them rather than redrawing:

- `ui_kits/studio/CalendarScreen.jsx` → `app/(studio)/calendar/page.tsx`
- `ui_kits/studio/ClientsScreen.jsx` → `app/(studio)/clients/page.tsx`
- `ui_kits/studio/CheckoutScreen.jsx` → `app/(studio)/checkout/[ticketId]/page.tsx`
- `ui_kits/studio/Components.jsx` → `components/lacquer/*`
- `prototypes/transaction/EndOfDay.jsx`, `DayReport.jsx` → `app/(studio)/end-of-day/page.tsx`
- `prototypes/walkin/StaffWaitlist.jsx` → `app/(studio)/walkin/page.tsx`
- `prototypes/walkin/KioskSignIn.jsx` → `app/kiosk/[token]/page.tsx`
- `prototypes/walkin/PhoneWaitlist.jsx` → `app/(studio)/walkin/phone-view.tsx`
- `colors_and_type.css` → `styles/tokens.css` (verbatim)

These prototypes are static / data-mocked. We replace the mock data with Supabase queries and Server Actions; layout and styling stay.

## Cost projection

| Item                         | Free tier covers MVP?       | Paid tier when needed         |
|------------------------------|------------------------------|-------------------------------|
| Vercel Hobby                 | Yes (1 salon)                | Pro $20/mo if traffic > limits |
| Supabase Free                | Yes (500 MB DB, no PITR)     | **Pro $25/mo** for PITR + 8 GB |
| Domain                       | n/a                          | ~$12/yr                       |
| Sentry / Logtail             | Free tier sufficient         | $0                            |
| Square fees                  | Per Square — no infra cost   | (paid from salon revenue)     |
| **Total infra**              | **$0/mo** during build       | **~$25–45/mo** in production  |

## Verification (how we'll know v1 works)

End-to-end smoke test in Square Sandbox + Supabase staging project:
1. Sign in as owner (Google) → `/select-staff` PIN → land on Calendar.
2. Settings → add 3 services (one with a per-tech `duration_min_override`), 2 technicians, salon hours, one closure date; connect Square Sandbox; pair a kiosk.
3. Open `/kiosk/[token]` in a second browser → walk in with phone `+15555550123` and name "Test" → confirm a new `clients` row is created → pick service → submit.
4. Original window: walk-in appears in `/walkin` within ~1s (realtime). Tap "Seat".
5. Seat opens Checkout. Add services from both techs (use the avatar picker to attribute one to each), $10 total tip, **split tender** ($20 cash + remainder card) → simulate Terminal completion → ticket flips to **paid**; tip-split dialog auto-allocates proportionally to each tech's service revenue and is editable.
6. Repeat once with **Gift Card** redemption against a Sandbox GAN with funded balance.
7. Issue a **partial refund** on the first ticket — manager-PIN override required; ticket flips to `partially_refunded`; Square refund recorded; `payments.authorized_by_staff_id` populated.
8. Confirm booking on a `salon_closures` date is blocked; confirm overlapping a tech's appointment shows the soft-warning dialog and permits on confirm.
9. End of Day → review tip-splits and adjust one, counted cash matches expected (accounting for the cash refund) → close session → day report shows totals by method and staff. Verify splits are locked after close.
10. Confirm `audit_log` rows include both device user and operator for each write, with controlled-vocab `action` values (`appointment.created`, `payment.captured`, `refund.issued`, etc.).

Tests: per-feature Playwright end-to-end against a seeded local Supabase (`supabase start`), run in CI on every PR. Unit tests for Square wrappers, PIN/auth helpers, tip-split math, and refund accounting (Vitest).

## Risks / open items for phase 2+

- **Customer self-booking app**: separate Next.js route or separate app? The Lacquer design system already ships a `book/` UI kit we can adopt. Decide when adding.
- **Tax computation**: schema reserves `tickets.tax_cents`, `services.taxable`, and a `settings` row, but no compute path or UI in v1. When lit up, expect to populate `tax_cents` from Square Terminal responses (Square computes it when configured in Seller Dashboard).
- **Product sales + inventory**: out of v1. Add a `products` table and re-introduce a `'product'` ticket-item kind when needed.
- **Selling gift cards**: redeem-only in v1. Sale path needs a new ticket-item kind that calls Square's gift card create API and writes a new `gift_cards` row.
- **Commission reporting**: `payments.taken_by_staff_id` and `tip_splits` capture the raw data; ad-hoc SQL until a UI is built.
- **Multi-location / SaaS**: would require swapping the implicit single-tenant assumption for `org_id`/`location_id` columns and tightening RLS. Designed-for, not built.
- **Square webhook reliability**: open Checkout pages poll every 5s as a fallback. If staff closes the tab while a payment is `pending`, the payment stays pending until the ticket is reopened. If this becomes a real problem in practice, add a Vercel Cron sweep against `payments` older than ~5 min.
- **PIN convenience over security**: there's no PIN lockout in v1 — device login is the security boundary. If shared-iPad theft becomes a concern, add a soft lockout (`staff.failed_attempts`, `staff.locked_until`).
- **Calendar concurrent edits**: last-write-wins on `appointments`; realtime invalidation makes conflicts visible but not prevented. Worth revisiting if two front-desk staff regularly trip over each other.
