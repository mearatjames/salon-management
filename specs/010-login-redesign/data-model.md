# Data Model — Login UI/UX Redesign

This feature introduces **no new tables, columns, indexes, or
constraints**. The data surface is entirely existing infrastructure
from `003-login-flow` (`auth.users`, `auth.identities` from Supabase
Auth; `public.audit_log` from
`supabase/migrations/0001_auth_schema.sql`).

This document records (1) the **read** patterns the new code
touches, (2) the **single application-level union extension** to
the `audit_log.action` controlled vocabulary, and (3) the
**operational invariant** on `auth.users.email_confirmed_at`
required for Google identity auto-linking to fire safely.

## Entities (read-only changes only)

### `auth.users` (Supabase-managed)

No schema change. The two columns this feature reads/depends on:

| Column | Type | Purpose for this feature |
|---|---|---|
| `id` | `uuid` | The `device user id` recorded into `audit_log.actor_user_id` on a successful password reset (FR-017(d)). |
| `email_confirmed_at` | `timestamptz` | **MUST be non-null** for the seeded owner so that auto-linking by verified email fires when the owner signs in with Google for the first time (FR-022, research R4). The dev seed (`supabase/seed.sql:21,43`) already satisfies this; the production bootstrap doc in `quickstart.md` reiterates it. |

State transitions: none. Supabase Auth owns the lifecycle.

### `auth.identities` (Supabase-managed)

No schema change. Read for verification only (SC-010). After a
Google sign-in for an existing email/password owner, the table
holds two rows for the same `user_id`:

| `user_id` | `provider` | `identity_data->>email` |
|---|---|---|
| `<owner id>` | `email` | `tang.owner@example.com` |
| `<owner id>` | `google` | `tang.owner@example.com` |

The `data-model.md` for `003-login-flow` had no need to reference
`auth.identities`; this feature only reads it for the SC-010
verification test (which is a Vitest fixture against the preview
project, not a DB migration).

### `public.audit_log` (introduced by 003)

No schema change. This feature adds **one new value** to the
`action` controlled vocabulary, enforced at the TypeScript layer in
`lib/auth/audit.ts`. The DB column itself is `text` with no enum
constraint, so the change is a one-line union edit:

```ts
export type AuditAction =
  | "device.signed_in"
  | "device.signed_out"
  | "device.password_reset"   // ← NEW in 010-login-redesign
  | "staff.signed_in"
  | "staff.pin_failed"
  | "staff.switched"
  | "staff.added"
  | "staff.updated"
  | "staff.pin_set"
  | "staff.deactivated"
  | "staff.reactivated"
  | "staff.removed"
  | "service.added"
  | "service.updated"
  | "service.archived"
  | "service.restored";
```

The existing `deriveEntityType()` dispatch
(`lib/auth/audit.ts:49-62`) routes anything that doesn't start
with `service.` or one of the six `staff.*` mutation verbs to
`entity_type = "auth"` — so `device.password_reset` picks up
`entity_type: "auth"` with zero further code change.

#### Audit row written by this feature

Written exactly once per successful password reset, inside the
`/reset-password` Server Action immediately after a successful
`supabase.auth.updateUser({ password })`:

| Column | Value |
|---|---|
| `action` | `"device.password_reset"` |
| `actor_user_id` | The Supabase `user.id` returned by the PKCE-exchange in `/auth/callback`. |
| `acting_as_staff_id` | `null` (no operator at this point — the reset link bypasses the staff-PIN gate). |
| `entity_type` | `"auth"` (derived) |
| `entity_id` | `null` |
| `payload` | `{ "method": "recovery" }` — distinguishes from a future Settings-driven password change which would carry `{ "method": "self_service" }`. |
| `created_at` | `now()` (default) |

Additionally, `device.signed_in` is written by the existing
`/auth/callback` handler when the PKCE code is exchanged
(extended in this feature to set `method: "recovery"` for the
recovery flow — see contracts/audit.contract.md). So a full
reset produces **two** audit rows in sequence:

1. `device.signed_in` with `payload: { "method": "recovery" }`
   — written by `/auth/callback` on PKCE exchange.
2. `device.password_reset` with `payload: { "method": "recovery" }`
   — written by `/reset-password` on `updateUser` success.

This sequence is verifiable in SC-009.

## Application-level invariants

### Invariant A — Confirmed email for auto-linking

Every `auth.users` row whose email matches a `google` identity
the owner intends to also use for sign-in MUST have
`email_confirmed_at IS NOT NULL`. Otherwise Supabase refuses to
auto-link the Google identity (to defeat takeover via OAuth on an
unconfirmed email) and the user ends up with two separate rows.

Enforcement points:

- **Dev seed** — already satisfied
  (`supabase/seed.sql:21,43` sets `email_confirmed_at` to
  `now()`).
- **Production bootstrap** — documented in
  `quickstart.md § Production bootstrap`; the operator running
  the first-owner SQL in Supabase Studio MUST include
  `email_confirmed_at => now()` (or any non-null timestamp) in
  the `auth.users` insert.
- **Future self-signup** (out of scope per FR-025) — would
  satisfy this automatically because Supabase populates the
  column on email-confirmation click.

Enforcement is operational (a doc + a seed file), not enforced by
a DB constraint, because the column belongs to Supabase Auth's
internal schema and is not ours to constrain.

### Invariant B — Exactly one PKCE exchange per recovery link

Supabase issues a single-use PKCE code on each
`resetPasswordForEmail` call. The first GET to
`/auth/callback?code=<...>&type=recovery` exchanges and
invalidates it; any subsequent GET (e.g. second browser tab
opening the same link) fails the exchange and the existing
`error=oauth_failed` redirect kicks in.

Enforcement: built into Supabase's PKCE implementation.
`/reset-password` MUST surface the calm "This link has expired or
has already been used." state when `/auth/callback` redirects
with `?error=oauth_failed` AND `type=recovery` is detectable in
the referrer or via a fresh query param like
`?reset_expired=1` — see contracts/routes.contract.md for the
exact wire-up.

### Invariant C — No application enumeration of email existence

`sendPasswordReset(email)` MUST behave identically (same redirect,
same status code, same elapsed time within a few-millisecond
window) whether or not the email is registered. Wraps Supabase's
already-safe behaviour in the same swallow pattern used by
`signInWithMagicLink` (research R5).

Enforcement: code review checklist (contracts/server-actions.contract.md)
+ a Vitest test that asserts the same redirect target on both
paths.

## State diagrams

### View-state machine (UI-level, not DB)

```
                           ┌─────────────┐
       ┌──── back ─────────│   signin    │──── forgot link ──────┐
       │                   │ (default)   │                       │
       │                   └─────────────┘                       ▼
       │                          ▲                       ┌─────────────┐
       │                          │ back                  │   forgot    │
       │                          │                       └──────┬──────┘
       │                          │                              │ submit
       │                   ┌─────────────┐                       ▼
       │                   │   magic     │                ┌─────────────┐
       └────── magic link ─│ (or magic-  │                │ forgot-sent │
                           │  intent=1)  │                └──────┬──────┘
                           └──────┬──────┘                       │
                                  │ submit                       │ send another
                                  ▼                              ▼
                           ┌─────────────┐                ┌─────────────┐
                           │ magic-sent  │                │   forgot    │
                           └──────┬──────┘                └─────────────┘
                                  │ send another
                                  ▼
                           ┌─────────────┐
                           │   magic     │
                           └─────────────┘
```

This is a pure UI state machine — not persisted server-side.
Source-of-truth for which view to render is the URL query string
on each GET (research R1).

### Password-reset data flow (DB + service)

```
[ User on /login (signin view) ]
   │
   │ clicks "Forgot password?"
   ▼
[ /login?reset_intent=1 (forgot view) ]
   │
   │ submits email → sendPasswordReset action
   ▼
supabase.auth.resetPasswordForEmail(
  email,
  { redirectTo: '<origin>/auth/callback' }
)
   │
   │ Supabase sends recovery email
   ▼
[ /login?reset_sent=<email> (forgot-sent view) ]
   │
   │ user opens email link from inbox
   ▼
GET /auth/callback?code=<pkce>&type=recovery
   │
   │ supabase.auth.exchangeCodeForSession(code)
   │ → session cookies set
   │ → recordAuth("device.signed_in", userId, null,
   │             { method: "recovery" })
   ▼
[ /reset-password (page with new-password form) ]
   │
   │ submits new + confirm password → updatePassword action
   │   validates: passwords match + ≥ 8 chars
   │   calls supabase.auth.updateUser({ password })
   │   recordAuth("device.password_reset", userId, null,
   │             { method: "recovery" })
   ▼
[ /select-staff (operator selection — existing flow) ]
```

## Indexes / queries

No new indexes are required. The `audit_log.action` text column
is already indexed by the migration introduced in
`003-login-flow`; queries filtering on
`action = 'device.password_reset'` reuse the same index.

## Migration footprint

**Zero**. No `supabase/migrations/**` change. No `supabase db push`
required. CI's `db-migrate-preview` and `db-migrate-prod` workflows
have nothing to apply for this feature.

## Verification

- Invariant A — verified by reading `supabase/seed.sql` and by
  the SC-010 end-to-end test (which exercises the link).
- Invariant B — verified by the e2e test "reset link expired or
  already used" (spec edge case, contracts/routes.contract.md
  § Recovery error states).
- Invariant C — verified by Vitest unit tests for
  `sendPasswordReset` asserting identical redirect targets on
  registered-vs-unknown emails (covered in plan.md Testing
  section).
- Audit row — verified by an e2e assertion against
  `audit_log WHERE action = 'device.password_reset' ORDER BY
  created_at DESC LIMIT 1` immediately after a successful
  reset (SC-009).
