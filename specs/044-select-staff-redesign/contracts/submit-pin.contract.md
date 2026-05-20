# Contract — `submitPin` Server Action

**Module**: `app/(device)/select-staff/actions.ts` (moved from
`app/(auth)/select-staff/actions.ts`)

**Type**: Next.js Server Action (`"use server"`), invoked imperatively by the client
keypad inside the PIN-entry modal.

This contract **supersedes** the `submitPin` description in
`specs/003-login-flow/contracts/server-actions.contract.md` for the failure path only.
Inputs, the success path, cookie issuance, `next` sanitization, and audit semantics are
otherwise unchanged.

---

## Signature

```ts
type SubmitPinResult = { ok: false };

export async function submitPin(formData: FormData): Promise<SubmitPinResult>;
```

The success path never resolves the promise — it throws Next's `redirect()` control
signal. The only resolved value is `{ ok: false }`, returned on a failed attempt.

## Inputs (`FormData` fields)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `staffId` | string (uuid) | yes | The tapped roster tile's `staff.id`. |
| `pin` | string | yes | The completed 4-digit PIN buffer. Never logged, never echoed. |
| `next` | string | no | Post-sign-in destination; sanitized via `sanitizeNext`. Empty string allowed. |

## Behavior

### 1. Device session check (unchanged)

Resolve the Supabase Auth user. If there is no device user → `redirect("/login?next=…")`.
This is a navigation, not a PIN-failure result.

### 2. Resolve the staff row

Select `id, pin_hash, active` for `staffId`. If the row is missing, `active !== true`,
or `pin_hash` is null:

- `await recordAuth("staff.pin_failed", deviceUserId, staffId ?? null, { reason: "invalid_target" })`
- **return `{ ok: false }`** — *(was: `redirect("/select-staff?error=pin_failed&next=…")`)*

### 3. Verify the PIN

`verifyPin(pin, row.pin_hash)` — bcrypt; verification rules, cost, and the
no-throttle / no-lockout policy are **unchanged** (FR-024). On mismatch:

- `await recordAuth("staff.pin_failed", deviceUserId, staffId, { reason: "mismatch" })`
- **return `{ ok: false }`** — *(was: `redirect("/select-staff?error=pin_failed&next=…")`)*

### 4. Success (unchanged)

On a correct PIN:

1. Read any existing `acting_as_staff_id` cookie to capture `previous_staff_id` for the
   audit payload (tampered/expired cookie → treated as "no previous operator").
2. `signOperatorCookie({ sid: staffId, iat })` and set the `acting_as_staff_id` cookie —
   `httpOnly`, `secure`, `sameSite: "lax"`, `path: "/"`, `maxAge` 43 200 s (12 h).
3. `await recordAuth("staff.signed_in", deviceUserId, staffId, previousSid ? { previous_staff_id: previousSid } : {})`.
4. Best-effort clear `staff.pin_reset_admin_at` for `staffId` (service-role; failure is
   non-fatal and does not block sign-in — FR-021).
5. `redirect(sanitizeNext(next))`.

## Guarantees

- **Exactly one `audit_log` row per completed attempt** — success → `staff.signed_in`,
  failure → `staff.pin_failed`. The `recordAuth` write is `await`ed before the action
  returns or redirects (FR-020, SC-007).
- **No audit row for an abandoned partial entry** — `submitPin` is only invoked on a
  full 4-digit buffer.
- **Idempotent failure** — returning `{ ok: false }` performs no navigation and no
  cookie mutation, so the client modal stays open for an immediate retry (FR-017).
- **Identical treatment of `invalid_target` and `mismatch`** — both return `{ ok: false }`;
  the client surfaces one error state and does not distinguish the reason to the user
  (the distinction lives only in the audit `payload.reason`).

## Client handling (PIN-entry modal)

1. On the 4th digit the keypad calls `submitPin(formData)` inside `startTransition`.
2. **Resolves `{ ok: false }`** → paint the error state on the 4-dot indicator, clear
   the PIN buffer, keep the modal open (FR-017).
3. **Throws `NEXT_REDIRECT`** (success) → the Next client runtime navigates to the
   sanitized `next`; the modal unmounts with the page (FR-016, FR-025).
4. Dismissing the modal (backdrop / close control / `Escape`) before 4 digits never
   calls `submitPin` — no audit row, no failed attempt (FR-018, spec edge cases).

## Out of scope / unchanged

- PIN length (4), `verifyPin` rules, bcrypt cost, no-throttle/no-lockout policy.
- The operator cookie shape, TTL, and attributes.
- `recordAuth` action vocabulary and payload keys.
- `sanitizeNext` behavior and the default landing surface.
