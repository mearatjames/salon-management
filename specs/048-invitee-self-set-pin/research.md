# Phase 0 Research: Invitee self-sets their PIN

All unknowns were resolved by reading the existing codebase — there are no open
`NEEDS CLARIFICATION` items. Each decision below records what was chosen, why,
and what was rejected.

## D1 — No schema migration is required

**Decision**: Ship this feature with zero changes to `supabase/migrations/**`.

**Rationale**:
- `audit_log.action` is plain `text`. `supabase/migrations/0003_services_catalog.sql`
  states: *"audit_log — intentionally untouched. `action` remains plain `text`"*.
  Adding a new `action` value (`user.pin_set`) is therefore a TypeScript-union
  change only — the DB accepts any string.
- `staff.pin_hash` already exists and is nullable.
- The `staff_pin_or_user` CHECK (`supabase/migrations/0001_auth_schema.sql`
  lines 28–29) is `check (pin_hash is not null or user_id is not null)`. An
  invite-flow staff row always has `user_id IS NOT NULL`, so it satisfies the
  CHECK while `pin_hash IS NULL`, and still satisfies it after `pin_hash` is
  set (both columns non-null).

**Alternatives considered**: A DB-side controlled-vocabulary CHECK or enum on
`audit_log.action` — rejected because the repo deliberately keeps `action` as
free text, and adding a constraint now is out of scope and would risk schema
drift on existing rows.

## D2 — `/set-pin` is the single gate; `updatePassword` change is one line

**Decision**: `updatePassword` redirects every invite-method user to `/set-pin`
unconditionally (`redirect(method === "invite" ? "/set-pin" : "/select-staff")`).
The `/set-pin` page reads the invitee's own `staff.pin_hash` and decides:
`pin_hash IS NULL` → render the keypad; `pin_hash` already set → redirect
straight to `/select-staff`.

**Rationale**: One `pin_hash` check on the page serves three purposes at once —
(1) US2: a thorough-mode invitee with an owner-set PIN is bounced past the step;
(2) the direct-navigation guard (someone opening `/set-pin` after already having
a PIN); (3) the edge case where a PIN appears between password-set and the step.
`updatePassword` stays a trivial, low-risk change and does not need to query
`staff` at all.

**Alternatives considered**: Branch inside `updatePassword` (query `pin_hash`
there, redirect to `/set-pin` only when null). Rejected — it duplicates the
`pin_hash` check (the page still needs its own direct-nav guard) and makes the
higher-traffic `updatePassword` action heavier. The extra server-side redirect
hop for a thorough-mode invitee is invisible to the user and costs nothing
measurable, so SC-002 ("zero extra steps") still holds.

## D3 — New audit action: `user.pin_set`

**Decision**: Add `"user.pin_set"` to the `AuditAction` union in
`lib/auth/audit.ts`. Use it for the invitee's self-set PIN.

**Rationale**: Neither existing action fits. `staff.pin_set` is the
settings-panel action a manager triggers (operator cookie present);
`user.pin_reset` is the owner-initiated admin recovery. An invitee choosing
their own PIN during onboarding is a third, distinct event. The repo's naming
convention is `<entity>.<verb>`; feature 012 onboarding events are all `user.*`;
`deriveEntityType` already maps any `user.*` action to entity type `"user"`
(`audit.ts` line 119), so no helper change is needed beyond the union entry.

**Audit payload**: `{ pin_set: true, actor: "self" }`. The boolean witness
mirrors `inviteUser`'s `pin_set` flag; `actor: "self"` distinguishes it from
the admin paths' `actor: "admin"`. The raw PIN is passed only to `hashPin()`
and never enters the payload (FR-011, SC-005, Constitution III).

**Alternatives considered**: Reusing `staff.pin_set` — rejected, it would
conflate a manager action with a self-service one and muddy any audit query
that distinguishes operator-initiated from invitee-initiated changes.

## D4 — Relocate the keypad reducer to `lib/auth/pin-keypad.ts`

**Decision**: Move the pure reducer in
`app/(studio)/settings/staff/_pin-keypad-state.ts` (`pinKeypadInit`,
`pinKeypadSubmit`, the `PinKeypadState`/`PinKeypadResult` types) to
`lib/auth/pin-keypad.ts`. Update the single existing importer
(`components/lacquer/staff/change-pin-modal.client.tsx`).

**Rationale**: The new `SetPinForm` (in the `(auth)` group) needs the same
two-phase enter/confirm reducer the `(studio)` change-PIN modal uses. The file
is `_`-prefixed — folder-private by convention — so importing it from another
route group would violate that convention. The reducer is a pure function with
no React and no route-group coupling; `lib/auth/` is its natural home next to
`pin.ts`. The move touches exactly one existing import and is verified by
typecheck.

**Alternatives considered**: (a) Import the `_`-prefixed file across route
groups — rejected, breaks the folder-private convention. (b) Duplicate the
~30-line reducer — rejected, two copies of PIN-entry logic is a real
correctness hazard for an auth path. (c) Leave it and reimplement entry/confirm
inline in `SetPinForm` — rejected, same duplication risk.

## D5 — `/set-pin` lives in the `(auth)` route group; no middleware change

**Decision**: New files `app/(auth)/set-pin/page.tsx` and
`app/(auth)/set-pin/actions.ts`. The route renders inside the existing
`(auth)/layout.tsx` `AuthShell`.

**Rationale**: At the PIN step the invitee holds only a Supabase auth session
(established when they set their password) — no operator cookie. The `(studio)`
group calls `requireStudioSession()`, which checks the operator cookie and would
reject them. The `(device)` group is the full-bleed counter UI. The `(auth)`
group is exactly the right home: it already hosts `/reset-password` (same
session shape, same invite-only nature) and its `AuthShell` two-panel
centered-card layout fits a single focused step. There is no `middleware.ts` in
the repo (confirmed: `middleware-manifest.json` is empty) — session enforcement
is done in-page via `supabase.auth.getUser()`, exactly as `/reset-password/page.tsx`
does. So no middleware change is needed.

**Alternatives considered**: A second step inside the existing `/reset-password`
form (the issue left route-vs-step to the implementer). Rejected — a distinct
URL is cleaner to guard, to test, to deep-link for the direct-nav idempotency
case, and to extend later (see D6). It also keeps the password form single-
purpose.

## D6 — Magic-link (passwordless) invites are out of scope

**Decision**: This feature covers only the **password** invite path
(`/reset-password?type=invite` → `updatePassword`). A magic-link invite
(`acceptInvite` with `method === "magic_link"`, which redirects straight to
`/select-staff`) is **not** routed through `/set-pin` by this feature.

**Rationale**: Issue #122 explicitly scopes the desired behavior to *"after an
invited user sets their password (`updatePassword`, the `type=invite` path)"*.
A magic-link invitee never sets a password, so there is no equivalent hook in
that flow. The spec's FR-001 is correspondingly password-tied.

**Known boundary / recommended follow-up**: A magic-link **quick-mode**
(no-PIN) invitee has the *same* underlying defect — they land on `/select-staff`
and are absent from the roster. Because `/set-pin` is built as a self-standing
route guarded only by "valid session + own `staff` row has `pin_hash IS NULL`"
(D2), closing that gap later is a one-line change: redirect the magic-link
branch of `acceptInvite` to `/set-pin` instead of `/select-staff`. This is left
as a follow-up issue rather than silently widening #122's scope.

## D7 — PIN-shape validation reuses `validatePinShape`; client keypad enforces shape

**Decision**: `setOwnPin` validates the submitted PIN with the existing
`validatePinShape` (`app/(studio)/settings/onboarding/_validation.ts`, regex
`/^\d{4}$/`). The `NumericKeypad` UI only ever produces a 4-digit buffer, so a
shape failure should be unreachable from the real UI — the server check is
defense-in-depth.

**Rationale**: FR-004 mandates reusing the existing shape rule rather than
inventing a new one. `validatePinShape` throws `ValidationError("invalid_pin_shape")`;
`setOwnPin` catches it and redirects to `/set-pin?error=invalid_pin_shape`,
mirroring how onboarding actions surface `?error=invalid_*`. Confirm-mismatch
(entered PIN ≠ confirmation PIN) is handled entirely client-side by the keypad
reducer's confirm phase — no server round trip.

**Alternatives considered**: A bespoke validator — rejected by FR-004.

## D8 — Reading the invitee's own `staff` row

**Decision**: Both the `/set-pin` page (`pin_hash` gate) and `setOwnPin` (the
pre-write "already set?" guard + resolving the staff `id`) read the staff row
with `WHERE user_id = <session user id>`. The PIN write itself uses the
service-role client.

**Rationale**: `staff` has exactly one RLS policy — `staff_select_authenticated
... using (true)` — and **no** `authenticated` INSERT/UPDATE policy
(`0001_auth_schema.sql`); the migration comments state all writes go through the
service-role client. So: an authenticated `SELECT` of the invitee's own row is
permitted and used for the read-side checks; the `pin_hash` UPDATE must use
`createSupabaseServiceRoleClient()` (`lib/db/admin.ts`), exactly as `inviteUser`,
`resetUserPin`, and `setStaffPin` already do. The write is constrained to
`WHERE id = <staffId> AND user_id = <sessionUserId>` so it can only ever touch
the caller's own row (FR-006, FR-007).

**Alternatives considered**: A new `authenticated` UPDATE RLS policy scoped to
`auth.uid() = user_id` — rejected; it would diverge from the repo's
"all writes via service-role" architecture (Constitution II) for no benefit,
and widen the RLS surface.
