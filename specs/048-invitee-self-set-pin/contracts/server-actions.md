# Phase 1 Contracts: Server Actions & Routing

This feature exposes one new server action and changes one redirect in an
existing action. No HTTP API, no public library surface — these are Next.js
Server Actions invoked from forms.

---

## 1. `setOwnPin(formData)` — NEW

**Location**: `app/(auth)/set-pin/actions.ts`

**Signature**: `export async function setOwnPin(formData: FormData): Promise<void>`
(returns `void`; all outcomes are a `redirect()`).

**Caller**: the hidden `<form action={setOwnPin}>` inside
`components/lacquer/set-pin-form.client.tsx`, submitted by the keypad's
confirm phase.

### Input

| Field | Source | Notes |
|-------|--------|-------|
| `pin` | `formData.get("pin")` | The 4-digit PIN the invitee entered and confirmed. The keypad guarantees 4 digits and that entry == confirmation before submit; the action re-validates shape server-side. |

### Preconditions

- A valid Supabase auth session for the invitee (established when they set
  their password moments earlier). Verified via `supabase.auth.getUser()`.

### Behavior (branch matrix)

| Condition | Outcome |
|-----------|---------|
| `pin` fails `validatePinShape` (not `/^\d{4}$/`) | `redirect("/set-pin?error=invalid_pin_shape")` — no write, no audit. |
| No valid session (`getUser()` returns no user) | `redirect("/set-pin?error=expired")` — no write, no audit. |
| Session valid, but no `staff` row for `user_id` | `redirect("/select-staff")` — defensive; nothing to set. No write, no audit. |
| Session valid, staff row found, `pin_hash` **already non-null** | `redirect("/select-staff")` — idempotent skip; **no overwrite**, no write, no audit. |
| Session valid, staff row found, `pin_hash IS NULL` | Hash the PIN, write it, record the audit row, then `redirect("/select-staff")`. |

### Success-path effects (in order)

1. Resolve the invitee's `staff` row: `SELECT id, pin_hash FROM staff WHERE
   user_id = <session user id>` (authenticated server client).
2. `const pinHash = await hashPin(pin)` — `lib/auth/pin.ts`, bcrypt cost 11.
3. `UPDATE staff SET pin_hash = <pinHash> WHERE id = <staffId> AND user_id =
   <session user id>` — **service-role client** (`lib/db/admin.ts`); the
   `AND user_id` clause guarantees the write can only touch the caller's own
   row (FR-006, FR-007).
4. `recordAudit("user.pin_set", <sessionUserId>, <staffId>, { pin_set: true,
   actor: "self" }, <staffId>)` — audit BEFORE the redirect.
5. `redirect("/select-staff")`.

### Invariants

- **The raw `pin` value is passed only to `hashPin()`** and never to a logger,
  `console.*`, or the audit payload (FR-011, SC-005, Constitution III).
- The audit row carries the device user (`actor_user_id`) and the operator
  (`acting_as_staff_id`, here the invitee's own staff id) — Constitution III.
- A `NEXT_REDIRECT` thrown by an inner `redirect()` is re-thrown, not swallowed
  (follow the `isNextRedirectError` pattern already in
  `reset-password/actions.ts`).

### Error surfaces

`?error=` values consumed by `app/(auth)/set-pin/page.tsx`:

| `?error=` | Page renders |
|-----------|--------------|
| `invalid_pin_shape` | The keypad with an inline "Enter a 4-digit PIN" message. |
| `expired` | An invite-expired card (mirrors `/reset-password`'s expired state) directing the invitee to ask the owner for a fresh invite or to set the PIN. |

---

## 2. `updatePassword(formData)` — MODIFIED

**Location**: `app/(auth)/reset-password/actions.ts`

**Change**: the **final redirect only**. Today the action ends with an
unconditional `redirect("/select-staff")` (line 110). It becomes:

```ts
redirect(method === "invite" ? "/set-pin" : "/select-staff");
```

- `method` is the already-normalized `"recovery" | "invite"` value derived
  from the form's hidden `method` field (existing code, line 45).
- Everything earlier in the action is unchanged: password validation, session
  probe, `supabase.auth.updateUser`, and
  `recordAuth("device.password_reset", userId, null, { method })`.

**Consequences**:

- `method === "invite"` → `/set-pin`, which then gates on `pin_hash`
  (skip-vs-show — see the `/set-pin` page contract below).
- `method === "recovery"` → `/select-staff`, **unchanged** (FR-013, SC-006:
  recovery resets are unaffected and never see the PIN step).

---

## 3. `/set-pin` page — NEW (routing contract)

**Location**: `app/(auth)/set-pin/page.tsx` — React Server Component, rendered
inside `app/(auth)/layout.tsx` (`AuthShell`).

**Query params**: `?error=invalid_pin_shape | expired` (optional).

### Render/redirect matrix

| Condition | Result |
|-----------|--------|
| No valid Supabase session | Render the expired-state card (or `redirect("/login")` if that is the established pattern for a missing session in `(auth)`). |
| Session valid, no `staff` row for `user_id` | `redirect("/select-staff")`. |
| Session valid, staff row `pin_hash` **already non-null** | `redirect("/select-staff")` — US2 skip + direct-nav idempotency guard. |
| Session valid, staff row `pin_hash IS NULL` | Render `<SetPinForm />` (+ any `?error=` message). |

### `<SetPinForm />` — client component contract

**Location**: `components/lacquer/set-pin-form.client.tsx`

- Wraps the existing `NumericKeypad` (`components/lacquer/numeric-keypad.client.tsx`)
  and drives it with the relocated pure reducer `pinKeypadInit` /
  `pinKeypadSubmit` from `lib/auth/pin-keypad.ts`.
- Two phases: **enter** (fill a 4-digit buffer) → **confirm** (re-enter). On a
  confirm match it `requestSubmit()`s a hidden `<form action={setOwnPin}>`
  carrying `pin`. On a confirm mismatch it flashes an inline error and resets
  to the enter phase — **entirely client-side, no server round trip**.
- All visual values (spacing, radius, type, color) resolve to design-system
  tokens; no new component library (Constitution I).

---

## Audit contract summary

| Action string | When | `actor_user_id` | `acting_as_staff_id` | `entity_id` | `payload` |
|---------------|------|-----------------|----------------------|-------------|-----------|
| `user.pin_set` (NEW) | Invitee self-sets their PIN via `setOwnPin` | invitee auth uid | invitee `staff.id` | invitee `staff.id` | `{ pin_set: true, actor: "self" }` |

The raw PIN never appears in `payload` or any log. `entity_type` derives to
`"user"` automatically from the `user.` prefix.
