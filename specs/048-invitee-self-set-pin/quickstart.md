# Quickstart: Verify the invitee-self-set-PIN flow

Manual walkthrough to confirm the feature works end to end. Assumes a local
Supabase stack (`supabase start`) and the app running (`npm run dev`).

## Prerequisites

- Local Supabase up; app on `http://localhost:3000`.
- Signed in to Settings as an owner (to issue invites).

## Scenario A — Quick-mode invitee sets their own PIN (User Story 1)

1. **Invite.** Settings → Onboarding → invite a new staff member in **quick
   mode** (no PIN), using a **password** invite method. Use an email you can
   read locally (Supabase Inbucket at `http://localhost:54324`).
2. **Accept.** Open the invite link from Inbucket. You land on
   `/reset-password?type=invite` ("Set your password").
3. **Set password.** Enter a password (≥ 8 chars) twice, submit.
4. **Expect the PIN step.** You are taken to **`/set-pin`**, not
   `/select-staff`. A "Set your PIN" keypad is shown.
5. **Set PIN.** Enter a 4-digit PIN, then re-enter it to confirm.
6. **Expect the staff picker.** You are taken to `/select-staff`. The new
   staff member now appears in the roster.
7. **Pin in.** Tap the new staff tile, enter the PIN you just chose — you are
   signed in as the operator.

✅ Pass: the invitee finished onboarding fully able to use the device, with a
PIN they chose themselves.

## Scenario B — Thorough-mode invitee skips the step (User Story 2)

1. **Invite with a PIN.** Settings → Onboarding → invite in **thorough mode**
   and set a PIN for the new staff member at invite time (password method).
2. **Accept + set password** as in Scenario A, steps 2–3.
3. **Expect NO PIN step.** After setting the password you go **straight to
   `/select-staff`** — `/set-pin` is not shown (it redirects through instantly
   because `pin_hash` is already set).
4. **Pin in** with the owner-set PIN.

✅ Pass: the owner-set PIN is honored; the invitee is not asked to set one.

## Scenario C — Recovery reset is unaffected (User Story 3)

1. **Forgot password.** From `/login`, use "Forgot password" for an existing
   staff member who already has a PIN.
2. **Open the recovery email**, land on `/reset-password` (recovery), set a new
   password.
3. **Expect NO PIN step.** You go straight to `/select-staff`. `/set-pin` is
   never reached.

✅ Pass: the PIN step is invite-only; recovery resets behave exactly as before.

## Edge checks

- **Direct navigation.** While signed in as an invitee who already has a PIN,
  open `/set-pin` directly → it redirects to `/select-staff` (no overwrite).
- **Invalid PIN shape.** The keypad only accepts 4 digits, so this is hard to
  hit from the UI; the server still rejects a non-4-digit `pin` with
  `/set-pin?error=invalid_pin_shape`.
- **Confirm mismatch.** On the confirm phase, enter a different PIN → inline
  error, keypad resets to the enter phase (no server round trip).
- **Audit.** After Scenario A, check `audit_log` for a `user.pin_set` row:
  `actor_user_id` = the invitee's auth uid, `acting_as_staff_id` = the
  invitee's `staff.id`, `payload = {"pin_set": true, "actor": "self"}`.
  Confirm the **raw PIN does not appear** anywhere in the row.

## Automated coverage

- **Unit** — `tests/unit/auth/set-pin.test.ts`: valid PIN writes the hash +
  audits with no raw PIN in the payload; bad shape → `?error=invalid_pin_shape`;
  no session → `?error=expired`; `pin_hash` already set → no overwrite,
  redirect `/select-staff`. Plus `tests/unit/auth/reset-password.test.ts`
  updated so the invite path now asserts a redirect to `/set-pin`.
- **E2E** — `tests/e2e/set-pin.spec.ts`: both branches (no PIN → step shown
  and completes → invitee on roster; PIN already set → step skipped). Imports
  `test` from `tests/e2e/_fixtures.ts` (it mutates `staff`).

## Final gate

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e
```

All five must be green before the feature is considered done (CLAUDE.md
"Pre-push quality gates").
