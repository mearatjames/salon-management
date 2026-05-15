# Data Model: Login Flow

**Feature**: 003-login-flow
**Date**: 2026-05-15
**Migration**: `supabase/migrations/0001_auth_schema.sql`

This document captures everything this feature persists or transmits as data:
two Postgres tables, one signed cookie payload, and the in-memory composite
types the session helper returns. All decisions trace to `spec.md` (Functional
Requirements + Key Entities) and the system-design schema in
`docs/system-design.md` § Data model.

## 1. Postgres tables (introduced by this feature)

### 1.1 `staff`

Represents a salon employee. May or may not be tied to a Supabase Auth user
(owners and managers usually are; technicians may not be). The `pin_hash` is
what `/select-staff` validates against.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PRIMARY KEY DEFAULT `gen_random_uuid()` | Surrogate key — referenced by the operator cookie payload |
| `user_id` | `uuid` | NULL; REFERENCES `auth.users(id)` ON DELETE SET NULL | Null for PIN-only staff; partial unique index where not null |
| `display_name` | `text` | NOT NULL | Shown on the roster tile and the operator chip |
| `role` | `text` | NOT NULL; CHECK (`role IN ('owner','manager','technician','front_desk')`) | Drives Server-Action authorization in later features (not enforced by this feature) |
| `pin_hash` | `text` | NULLABLE; CHECK (`pin_hash IS NOT NULL OR user_id IS NOT NULL`) | bcrypt hash; null only for staff who sign in directly without PIN selection (not used in v1 — kept nullable for forward compat) |
| `color_token` | `text` | NOT NULL | A Lacquer palette token name (e.g. `--accent-rose`, `--accent-amber`); used by the avatar and operator chip. |
| `active` | `boolean` | NOT NULL DEFAULT `true` | Inactive staff are filtered out of the `/select-staff` roster |
| `created_at` | `timestamptz` | NOT NULL DEFAULT `now()` | Audit |

**Indexes**:
- `staff_pkey` on `(id)` — implicit
- `staff_user_id_unique` — partial unique on `(user_id)` WHERE `user_id IS NOT NULL`
- `staff_active_role_idx` on `(active, role)` — speeds the roster query

**RLS** (enabled):
- `staff_select_authenticated`: `SELECT` allowed for `authenticated` role on
  any row.
- No `INSERT`/`UPDATE`/`DELETE` policies — owners edit staff via the future
  Settings → Staff feature using the service-role client.

**Lifecycle**: created in `supabase/seed.sql` for dev (3 staff with PINs
`1234`, `5678`, `9999`); created in production via SQL/Studio until Settings
→ Staff is built. `active=false` removes a staff member from the roster
without deleting their `audit_log` history.

### 1.2 `audit_log`

Append-only event log for everything that touches identity (this feature) and
later money/state (subsequent features).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PRIMARY KEY DEFAULT `gen_random_uuid()` | |
| `ts` | `timestamptz` | NOT NULL DEFAULT `now()` | |
| `actor_user_id` | `uuid` | NULLABLE | The Supabase device user that submitted the request; null for the very first `device.signed_in` write where the user is just being established |
| `acting_as_staff_id` | `uuid` | NULLABLE; REFERENCES `staff(id)` ON DELETE SET NULL | The operator at the device; null when not yet pinned in (e.g., `device.signed_in`) |
| `action` | `text` | NOT NULL | One of `device.signed_in`, `device.signed_out`, `staff.signed_in`, `staff.pin_failed`, `staff.switched` (this feature) — see `contracts/audit.contract.md` for the controlled vocabulary |
| `entity_type` | `text` | NULLABLE | Always `'auth'` for events from this feature; future features pass `'appointment'`, `'payment'`, etc. |
| `entity_id` | `uuid` | NULLABLE | The targeted/affected entity id; for `staff.pin_failed` it's the targeted `staff_id` (mirrors the payload field for query convenience) |
| `payload` | `jsonb` | NOT NULL DEFAULT `'{}'::jsonb` | Event-specific context — see per-action shapes in `contracts/audit.contract.md` |

**Indexes**:
- `audit_log_pkey` on `(id)` — implicit
- `audit_log_ts_idx` on `(ts DESC)` — drives chronological queries
- `audit_log_actor_idx` on `(actor_user_id, ts DESC)` — drives "what did
  this user do?" queries
- `audit_log_action_idx` on `(action, ts DESC)` — drives "show me all PIN
  failures" type queries

**RLS** (enabled):
- `audit_log_select_authenticated`: `SELECT` allowed for `authenticated` role,
  but the `payload` column is granted only to `service_role` (per the system
  design's "audit_log.payload never readable by ordinary authenticated
  clients"). Implementation: `REVOKE SELECT (payload) FROM authenticated;
  GRANT SELECT (payload) TO service_role;`
- No `INSERT`/`UPDATE`/`DELETE` policies for `authenticated` — all writes go
  through `lib/auth/audit.ts` using the service-role client.

**Lifecycle**: append-only. No `UPDATE` or `DELETE` policy. Future retention
work is out of scope (spec assumption — not addressed in v1).

## 2. Operator cookie payload (transmitted, not persisted)

The `acting_as_staff_id` cookie carries the operator identity between
requests. It is the only piece of state that `/select-staff` produces and
that `requireStudioSession()` reads.

### 2.1 Cookie attributes

| Attribute | Value | Source |
|-----------|-------|--------|
| Name | `acting_as_staff_id` | FR-008 |
| `HttpOnly` | true | FR-008 |
| `Secure` | true | FR-008 |
| `SameSite` | `Lax` | FR-008 |
| `Path` | `/` | Default — needed for middleware on every studio path |
| `Max-Age` | `43200` (seconds = 12 h) | FR-008 — hard, no sliding extension |
| Value format | `<base64url(header)>.<base64url(payload)>.<base64url(signature)>` (compact JWT) | R2 |

### 2.2 Cookie payload (JWT claims)

| Claim | Type | Notes |
|-------|------|-------|
| `sid` | `string` (uuid) | The selected `staff.id`. The only piece of data we need server-side. |
| `iat` | `number` (unix seconds) | Issued-at; verified server-side against `iat + 43200` so a tampered or extended `Max-Age` is rejected |

**Signing**: HS256 via `jose.SignJWT` over a 32-byte secret stored in the
`AUTH_COOKIE_SECRET` env var (server-only, never sent to the client).
**Verification**: `jose.jwtVerify` on every request that resolves the
operator (i.e., every studio render and Server Action).

**Exclusions** (intentional):
- No `display_name`, `role`, or `color_token` — these are looked up
  server-side per request from the `staff` row so deactivation takes effect
  on the next request.
- No `device.user_id` — the device user is identified by the Supabase
  session cookies, which are independent of this cookie.

## 3. In-memory composite types (returned by `lib/auth/session.ts`)

These are TypeScript types used by Server Components and Server Actions.
They are not persisted; they are the runtime shape of "who is acting".

### 3.1 `StudioViewer`

```ts
export type StudioRole = 'owner' | 'manager' | 'technician' | 'front_desk';

export type StudioViewer = {
  deviceUserId: string;          // Supabase auth.uid()
  staff: {
    id: string;                  // staff.id (matches the cookie's `sid`)
    display_name: string;        // staff.display_name
    role: StudioRole;            // staff.role
    color_token: string;         // staff.color_token (Lacquer token name)
  };
};
```

Returned by `requireStudioSession()` on the happy path. Throws
`AuthRedirectError` on any unresolved layer (no Supabase session, no/expired
operator cookie, deactivated staff).

### 3.2 `DegradedSession`

```ts
export type DegradedSession = {
  degraded: true;
  cookieStaffId: string | null;  // last-known staff id from the cookie if present and parseable; null otherwise
};
```

Returned by `getStudioSessionOrDegraded()` when Supabase is unreachable. Only
the studio shell layout calls this variant — Server Actions always call
`requireStudioSession()` and let the redirect propagate (Constitution III's
auditability requirement: no write proceeds against a stale connection).

### 3.3 `AuthRedirectError`

```ts
export class AuthRedirectError extends Error {
  constructor(public target: '/login' | '/select-staff', public next: string | null) {
    super(`auth-redirect:${target}`);
  }
}
```

Thrown by the session helper when the gate cannot be cleared. Caught by
middleware and Server-Action plumbing, which translate it into a Next.js
`redirect()` call to `target?next=<sanitized(next)>`.

## 4. Relationships

```
auth.users ─── 0..1 ──┐
                      ▼
                   staff ─── 0..* ─── audit_log (acting_as_staff_id)
                                            │
                                            └── actor_user_id ──► auth.users (logical, not FK)
```

- One `auth.users` row → at most one `staff` row (partial unique index on
  `staff.user_id`).
- One `staff` row → many `audit_log` rows.
- `audit_log.actor_user_id` is **not** an FK — we want to retain the audit
  row even if the Supabase auth user is later deleted. The column is
  documentation-grade only.

## 5. Validation rules (cross-table)

These are enforced at the application layer (Server Actions), not by Postgres:

- **PIN validation** (FR-007): `verifyPin(input, staff.pin_hash)` — bcrypt
  constant-time compare. Returns boolean.
- **Operator must be active** (FR-002, FR-015): `requireStudioSession()`
  fails the redirect path if `staff.active = false` (or the cookie's `sid`
  no longer matches a row).
- **`?next=` whitelist** (R6): `sanitizeNext()` returns a path under the
  `(studio)` route group or `/dashboard` as the default.
- **Cookie freshness** (FR-008): `verifyOperatorCookie()` rejects a cookie
  whose `iat + 43200 < now()`, even if the browser still presents it.
- **Audit invariants** (FR-016): every successful `recordAuth(...)` call
  includes `ts`, `action`, and at least one of `actor_user_id` /
  `acting_as_staff_id`.

## 6. State transitions

The "session state" of a request is the cross-product of (device session)
and (operator cookie):

| Device session | Operator cookie | State | Middleware behavior |
|----------------|-----------------|-------|---------------------|
| absent | absent | unauthenticated | redirect to `/login?next=<path>` |
| absent | present | inconsistent (ignore cookie) | redirect to `/login?next=<path>` |
| present | absent | pinned-out | redirect to `/select-staff?next=<path>` |
| present | expired (per `iat`) | pinned-out | redirect to `/select-staff?next=<path>`, clear cookie |
| present | present + valid + staff active | resolved | proceed |
| present | present + valid + staff deactivated | inconsistent | redirect to `/select-staff?next=<path>`, clear cookie |
| present | present + Supabase unreachable | **degraded** | studio shell renders via `getStudioSessionOrDegraded`; Server Actions short-circuit (FR-015a) |

The transitions on user action:

```
  ┌──────────────────┐  signInWithPassword/OAuth/Magic   ┌──────────────────┐
  │  unauthenticated │──────────────────────────────────▶│   pinned-out     │
  └──────────────────┘                                    └────────┬─────────┘
                                                                   │ submitPin
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │     resolved     │◀───┐
                                                          └────────┬─────────┘    │
                                                                   │              │ submitPin (new operator)
                                                          switchStaff │            │
                                                                   ▼              │
                                                          ┌──────────────────┐    │
                                                          │   pinned-out     │────┘
                                                          └────────┬─────────┘
                                                                   │ signOut
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │  unauthenticated │
                                                          └──────────────────┘
```

Each transition arrow corresponds to one Server Action and writes one
`audit_log` row (see `contracts/audit.contract.md` for the action mapping).

## 7. Seed data (dev only, in `supabase/seed.sql`)

Three staff are seeded for development so the flow is testable end-to-end
without a Settings UI:

| `display_name` | `role` | `color_token` | PIN | Linked `auth.users`? |
|----------------|--------|---------------|-----|----------------------|
| Maya Patel | `owner` | `--accent-rose` | `1234` | yes (linked to seed user `owner@tangnails.dev`) |
| Jordan Lee | `manager` | `--accent-amber` | `5678` | yes (linked to seed user `manager@tangnails.dev`) |
| Sam Chen | `technician` | `--accent-violet` | `9999` | no (PIN-only) |

PINs are hashed with bcrypt cost 11 at seed time (the seed file embeds the
pre-computed hashes — re-generated only when the canonical PINs change).
Production never runs `seed.sql`; the very first owner is bootstrapped
manually via SQL/Studio per the spec assumption.
