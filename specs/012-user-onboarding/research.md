# Research — User Onboarding & Offboarding

The spec was clarified to four resolved questions in session 2026-05-16
(see `spec.md § Clarifications`). The remaining open technical
questions are recorded below with the decision, rationale, and what
was considered and rejected. Each entry is keyed `R<n>` so contracts
and the plan can back-reference.

## R1 — Supabase invite mechanism per method

**Decision**:
- **Magic-link invite (Quick mode, default for both modes)** →
  `supabase.auth.admin.createUser({ email, email_confirm: false,
  user_metadata: { display_name, role, invited_by } })` *then*
  `supabase.auth.admin.generateLink({ type: 'magiclink', email,
  options: { redirectTo: '<origin>/auth/callback' } })`. The first
  call creates the row in `auth.users` (so our `staff.user_id` FK
  resolves); the second call returns the action link (24h validity)
  and triggers Supabase to send the magic-link email via the standard
  template.
- **Password-setup invite (Thorough mode → "Set up a password")** →
  `supabase.auth.admin.inviteUserByEmail(email, { redirectTo:
  '<origin>/auth/callback?type=invite', data: { display_name, role,
  invited_by } })`. This is Supabase's canonical "invite" path —
  creates the user + sends the invite template (7-day default
  validity) + returns the user object. The callback's `type=invite`
  branch (R8) forwards to `/reset-password?type=invite` so the user
  sets a first-time password using the existing reset form.

**Rationale**: `inviteUserByEmail` is purpose-built for the password
flow but doesn't return the action link separately, so it can't power
the "Copy invite link" row action — we'd lose the URL. For the magic-link
path, `generateLink` returns the action link directly (we save it
implicitly via the `auth.users` row's last-issued token and re-derive on
demand for "Copy link" by calling `generateLink` again — which rotates
the token, matching FR-032's "Resend invalidates the prior" requirement).
Splitting on method keeps each path simple and aligned with Supabase's
documented usage.

**Alternatives considered**:
- *Use `inviteUserByEmail` for both* — Rejected: doesn't return the
  action link, breaking "Copy invite link" (FR-032).
- *Use `generateLink({ type: 'invite' })` for both* — Rejected:
  `generateLink({ type: 'invite' })` does not auto-send the email; we'd
  have to wire a custom SMTP path, violating Principle V (no new
  infrastructure for free).
- *Custom token table* — Rejected: spec assumption explicitly says
  "Supabase Auth `inviteUserByEmail` and `generateLink({ type: 'magiclink' })`
  are the canonical invite mechanisms; no custom mail flow is built."

## R2 — Lifecycle state representation on `staff`

**Decision**: Add `staff.state text` with a CHECK constraint
`state in ('active','invited','offboarded')`, default `'active'`.
Keep the existing `active boolean` as a *fast-path* filter for
`/select-staff`'s hot query (which already uses
`WHERE active=true AND removed_at IS NULL`); set `active=false` for
every `invited` and `offboarded` row so the existing query continues
to work unchanged. The Onboarding page reads `state` directly to bin
rows into the three sections.

**Rationale**: A dedicated `state` column matches the spec's data
model verbatim (`Lifecycle states: invited / active / offboarded`)
and gives us a single column to filter on for the Pending and
Offboarded sections. Overloading the `active` boolean (e.g.
`active=false AND removed_at IS NULL` meaning "either invited or
offboarded") would force every site that reads `active=false` to also
check `state`, creating drift risk. Keeping `active` as a derived
mirror avoids a flag-day rewrite of every reader query.

**Invariant**: every transition between `state` values updates
`active` in the same UPDATE statement (`'active'` → `active=true`;
`'invited'`/`'offboarded'` → `active=false`). The 0004 migration
includes a backfill that sets `state='active'` for every existing
row (which all have `active=true` and `removed_at IS NULL` from
006-staff-management).

**Alternatives considered**:
- *Replace `active` with `state` everywhere* — Rejected: touches
  `/select-staff`, the calendar, the operator menu, every "active
  techs" query. Out of scope and risks regressing 003/006/007/008.
- *Use only `active` + a `removed_at`-style nullable `invited_at`* —
  Rejected: an explicit `state` column is more legible in audit-log
  reviews and a CHECK constraint prevents impossible combinations
  (e.g. `state='offboarded' AND offboarded_at IS NULL`).

## R3 — "Email already exists" conflict detection

**Decision**: Before any invite action runs the admin-API call, query
`public.staff` for any row (including offboarded and removed) whose
`email` matches case-insensitively (`lower(email) = lower(:input)`).
If a match exists, return one of four conflict codes mapped to
inline copy:

| `staff.state` of match | Code | Inline message |
|---|---|---|
| `invited` | `already_invited` | "Already invited. Resend the link from Pending invites." |
| `active` | `already_active` | "Already on the team. Edit them in Staff." |
| `offboarded` | `was_offboarded` | "Was offboarded. Reactivate from Offboarded instead." |
| Row removed (display_name starts with "Former staff #") | `was_removed_email_freed` | Pass through to invite — Supabase will accept the email since the prior auth user was deleted. |

For the fourth case (removed user), the staff row's `email` column is
NULL after anonymization (FR-052) so it doesn't match the input —
the query returns no rows and the invite proceeds normally. The
conflict matrix is therefore reduced to the three live states.

**Rationale**: A single `lower(email)` lookup is cheap (we'll add
a partial index `staff_email_active_idx` filtering on
`email IS NOT NULL`) and gives a precise inline error per spec edge
case "Email already exists". Querying `auth.users` directly via the
admin API would add a roundtrip and duplicate the source of truth
(the spec's invariant is "Paired 1:1 with a Staff record", so `staff`
is sufficient).

**Alternatives considered**:
- *Let Supabase reject the duplicate at the admin API* — Rejected:
  the error surface is opaque (`User already registered` for some
  variants, silent success for others) and we'd lose the state
  context needed to give the user a useful next action.

## R4 — Hard-remove anonymization counter

**Decision**: Postgres SEQUENCE `staff_anon_counter` created in
migration 0004. The `removeUser` action calls
`SELECT nextval('staff_anon_counter')` inside the same transaction as
the staff UPDATE, formats the result as `"Former staff #${n}"`, and
writes it to `staff.display_name`.

**Rationale**: Sequences are session-safe and concurrency-safe by
design — `nextval()` is the canonical mechanism for monotonic counters
in Postgres. Two simultaneous removes can never collide. The counter
is per-salon implicitly because this is a single-tenant database.

**Alternatives considered**:
- *SELECT max(...) + 1* — Rejected: race condition between two
  concurrent removes (both read the same max, both write the same
  next value).
- *Random suffix* — Rejected: spec is explicit ("Former staff #NNN
  where NNN is a monotonically increasing per-salon counter").
- *UUID truncation* — Rejected: not human-readable, not what the
  spec asked for.

## R5 — Last-owner protection enforcement

**Decision**: Reuse the existing `staff_assert_owner_present_trg`
trigger from migration 0002 verbatim. Both `offboardUser` and
`removeUser` UPDATE the staff row; the trigger fires on UPDATE and
raises `check_violation` (errcode `23514`) or `raise_exception`
(P0001) when the action would reduce the active-owner count below 1.
The actions map both codes to `?error=last_owner` (same pattern as
`staff/actions.ts:isLastOwnerTriggerError`).

The Server Action also performs a pre-flight count query so the
inline message can be shown before the destructive button submits —
matches the spec's preference for "Promote another owner first"
copy rather than a post-submit toast.

**Rationale**: Zero new DB code; the trigger is already battle-tested
in 006. The pre-flight check is for UX only (the trigger is the
trust boundary).

**Alternatives considered**:
- *Add a second `last_owner` check inside the application* — Rejected:
  one source of truth is better than two; the trigger is authoritative.
- *Remove the trigger and rely on the application check* — Rejected:
  would re-open the race condition the trigger was added to close.

## R6 — Soft-offboard session invalidation (SC-003)

**Decision**: `offboardUser` calls `supabase.auth.admin.signOut(
target_user_id, 'global')` after the staff UPDATE. This invalidates
every refresh token issued to the target user and forces re-auth on
the next refresh cycle (Supabase access-token TTL is 1 hour by
default, refresh on every request via `@supabase/ssr`). Combined with
`active=false` (which excludes the staff row from `/select-staff`
hot query) this satisfies SC-003 "within 5 seconds" because the
middleware's session refresh on the next request fails immediately.

**Rationale**: `signOut(user_id, 'global')` is the documented Supabase
admin API for this. The 1-hour access-token TTL means a hostile
holder of a live token has at most one hour of access — but they
cannot regenerate via refresh, and their session is fully revoked
within seconds. For the salon's threat model (a recently-fired
employee), this is sufficient.

**Alternatives considered**:
- *Delete the auth user* — Rejected: soft offboard is supposed to be
  reversible (FR-061 reactivate); deleting auth.users breaks that.
- *Shorten access-token TTL globally* — Rejected: would increase
  refresh load across every authenticated request for every user;
  way out of scope.

## R7 — Owner-initiated password reset audit tagging (FR-037, FR-038)

**Decision**: The Active row's "Send password reset" action calls
`supabase.auth.resetPasswordForEmail(target_email, { redirectTo })`
directly (not through the 010 `sendPasswordReset` form action),
writes `device.password_reset` with payload
`{ method: 'recovery', actor: 'admin', by: <owner_user_id> }`. The
existing self-serve path in 010 continues to write the payload
without `actor` or `by` (defaults to `actor: 'user'`); a Vitest
test fixes this distinction.

The audit row from `/reset-password` (written by the existing
`updatePassword` action when the user submits the new password)
remains unchanged — the `actor=admin` flag lives only on the
*request* audit row, not the *completion* row. This matches the
spec's "actor=admin distinguishes owner-initiated from self-serve"
phrasing (FR-038 is about who *initiated*, not who *submitted*).

**Rationale**: Tagging the initiator at the request site is more
forensically useful than tagging the completion site (an admin-initiated
reset is identical in effect to a self-serve reset; only the trigger
differs). The audit schema is unconstrained text + JSONB so adding
`actor` and `by` to the payload is a zero-migration change.

**Alternatives considered**:
- *Define a new audit event `user.password_reset_initiated`* —
  Rejected: needless verb proliferation; the JSONB payload is the
  right place for actor metadata.
- *Add `actor` to every audit row* — Rejected: only meaningful when
  the actor differs from the acting staff (i.e. only on
  admin-initiated paths).

## R8 — `/reset-password?type=invite` reuse (FR-030a)

**Decision**: Three small surgical changes:

1. **`app/auth/callback/route.ts`** — extend `methodFromCallback` and
   the redirect switch to recognize `type=invite`:
   ```ts
   if (type === "invite") return "invite";
   …
   if (type === "invite") {
     redirect("/reset-password?type=invite");
   }
   ```
   The audit row for the PKCE exchange tags `method: "invite"` so it
   is distinguishable from `method: "magic_link"` (which it is
   technically, since invite links are also magic links under the
   hood — but they semantically represent a different event).

2. **`app/(auth)/reset-password/page.tsx`** — read `?type` from
   searchParams, switch the page heading and the form's submit-button
   copy:
   - `type=invite` → "Set your password" + "Continue"
   - `type=recovery` (default) → "Reset password" + "Update password"
   - The expired-state card uses different copy too:
     - invite → "Invite link expired. Ask the owner to resend."
     - recovery → existing "Reset link expired" copy.

3. **`app/(auth)/reset-password/actions.ts`** — `updatePassword` is
   already symmetric (it does not care whether the session was
   created by a recovery or invite link). The audit payload's
   `method` field becomes the dynamic value passed via a hidden
   `<input name="method">` in the form (defaults to `"recovery"`).

No new file is created; three files modified by < 30 lines each.

**Rationale**: Spec FR-030a is explicit: "Reuse the existing
/reset-password route from spec 010 with a `type` mode switch
(recovery vs. invite). View copy and post-submit redirect adapt
to the mode; PKCE exchange and `updateUser({ password })` logic
are identical to recovery."

**Alternatives considered**:
- *Create a separate `/accept-invite` route* — Rejected: duplicates
  the entire PKCE + updateUser flow, drifts independently from
  `/reset-password`. Spec explicitly rejects this.

## R9 — "PIN reset by owner" notice on `/select-staff` (FR-035)

**Decision**: Add `staff.pin_reset_admin_at timestamptz`. The
`resetUserPin` action (Onboarding row menu) sets it to `now()` along
with the new PIN hash. The `/select-staff` page reads it; when
non-null AND > the last `last_sign_in_at` (or `last_sign_in_at` is
NULL), the operator chip for that user shows a small `<Info />`
badge with the tooltip "Your PIN was reset by an owner." When the
user successfully PIN-ins (in the existing `selectStaff` action),
the action clears `pin_reset_admin_at` to NULL.

**Rationale**: One nullable column, one read in the existing
`/select-staff` query, one clear in the existing successful-PIN
action. Lightest possible mechanism; satisfies the spec's "a notice
MUST surface on the user's next /select-staff sign-in".

**Alternatives considered**:
- *Use a session/cookie banner shown only on first sign-in* —
  Rejected: harder to test, fragile across browsers.
- *Defer the notice to a follow-up feature* — Rejected: FR-035 is
  explicit; the column is one line of SQL.

## R10 — `last_sign_in_at` source of truth

**Decision**: Add `staff.last_sign_in_at timestamptz` (null by default).
Extend `app/auth/callback/route.ts` after `recordAuth("device.signed_in", …)`
to UPDATE the matching staff row's `last_sign_in_at = now()` and flip
`state='invited' → state='active'` (and `active=true`) idempotently:

```ts
await admin.from("staff").update({
  last_sign_in_at: new Date().toISOString(),
  state: "active",
  active: true,
}).eq("user_id", userId);
```

The `state` flip is only meaningful for invited rows; for already-active
rows the UPDATE is a no-op. This single UPDATE per sign-in is the
cheapest place to capture both the audit signal and the state transition.

**Rationale**: The spec's Assumptions section names `last_sign_in_at`
as if it already exists; it doesn't. Adding it now lets the
Onboarding page show "Last sign-in Today / Yesterday / 3 days ago"
metadata for Active rows (per the prototype's `metaText`
in `UserRow`). The callback is the natural choke point — every
sign-in goes through it.

**Alternatives considered**:
- *Derive last sign-in from the audit log* — Rejected: requires a
  subquery on every roster fetch; cheap to maintain a denormalized
  column.

## R11 — Pre-create staff row at invite time

**Decision**: `inviteUser` runs in this order:
1. Validate inputs.
2. Conflict check (R3).
3. `supabase.auth.admin.createUser` / `inviteUserByEmail` per method
   (R1) — gets back `auth.users.id`.
4. INSERT into `staff` with `user_id`, `display_name`, `role`,
   `color_token`, `pin_hash` (NULL for Quick / set for Thorough),
   `email`, `state='invited'`, `active=false`, `invited_at=now()`,
   `invited_by=<owner_user_id>`, `invite_method`.
5. `recordAudit("user.invited", …)`.

If step 4 fails after step 3 succeeded, the action calls
`admin.deleteUser(authUserId)` to roll back and surfaces a
`?error=invite_failed`. The staff `pin_hash | user_id` CHECK from
0001 is automatically satisfied because we always have a `user_id`
from step 3.

**Rationale**: Pre-creating both rows lets every subsequent action
(`resend`, `cancel`, `offboard`, `reactivate`, `remove`, `setPin`)
operate on a stable `staff.id` known from the moment the invite
is sent. The roster query never has to JOIN with `auth.users` for
basic fields. The audit log carries a consistent `entity_id` = `staff.id`
across the user's entire lifecycle.

**Alternatives considered**:
- *Create staff row on first sign-in* — Rejected: the Pending
  section would need to source rows from `auth.users` (admin-only,
  awkward to RLS), and audit rows for invite/resend/cancel would
  have no `entity_id`.

## R12 — `shadcn/ui` primitives needed

**Decision**: Install three new shadcn primitives via the standard
CLI:
```bash
npx shadcn@latest add sheet dialog dropdown-menu
```

- `sheet` — the right-side Onboard / Offboard / Remove sheets.
- `dialog` — the Reset PIN modal (centered, two-pass keypad).
- `dropdown-menu` — the per-row action menus on each user row.

These are the only new primitives. Existing
`button`, `input`, `label`, `alert`, `tabs`, `badge` already cover
the rest of the surface.

**Rationale**: Principle I forbids a second component library; the
prototype's `sheet-*`, `dialog`-like modal, and per-row menu all
have canonical shadcn analogues. The `sheet` and `dropdown-menu`
primitives are documented in shadcn's docs and ship with Lacquer
token compatibility (they use `var(--background)`, `var(--border)`,
etc.) — no token deviations.

**Alternatives considered**:
- *Build sheets and menus by hand* — Rejected: ~600 LOC to replicate
  accessible focus traps, keyboard nav, ESC handling, and outside-click
  semantics that shadcn already gets right.

## R13 — Roster fetch shape

**Decision**: A single Server Component fetch in
`app/(studio)/settings/onboarding/page.tsx`:
```ts
const { data } = await admin
  .from("staff")
  .select("id, user_id, display_name, email, role, color_token, " +
          "state, pin_hash, invited_at, invited_by, invite_method, " +
          "offboarded_at, offboarded_by, offboard_reason, " +
          "last_sign_in_at")
  .is("removed_at", null);
```
The `_sort.ts` helper splits the result into `pending`, `active`,
`offboarded` arrays and sorts each per FR-004 (active: role priority
then alphabetical; pending and offboarded: most-recent-first by
`invited_at` / `offboarded_at`). The current-owner's `is_you` flag
is computed from the `viewer.deviceUserId` match.

**Rationale**: One query, three buckets, no pagination needed
(team size ≤ 25). The `removed_at IS NULL` filter keeps hard-removed
rows out of the page (they show their anonymized form only inside
audit-log queries).

**Alternatives considered**:
- *Three separate queries* — Rejected: extra roundtrips, no perf
  benefit at this scale.

## R14 — Email-conflict check race

**Decision**: The conflict check (R3) is informational, not a trust
boundary. The hard guard is a unique partial index added in 0004:
```sql
CREATE UNIQUE INDEX staff_email_lower_unique
  ON public.staff (lower(email))
  WHERE email IS NOT NULL AND removed_at IS NULL;
```
Two concurrent invites with the same email then race the INSERT,
not the SELECT — Postgres rejects the second with `unique_violation`
(errcode `23505`), which the action maps to `already_invited` (the
race is effectively "you both just invited the same email; the other
won").

**Rationale**: Defense in depth — the SELECT check gives a precise
error message in the common case; the unique index covers the race.
The `removed_at IS NULL` partial index condition lets hard-removed
rows free their email for reuse (FR-052's last AC).

**Alternatives considered**:
- *Application-level mutex* — Rejected: doesn't survive process
  restarts and adds latency.

## Summary of "NEEDS CLARIFICATION" resolution

The spec's clarifications (session 2026-05-16) resolved the four
product-design questions. All remaining technical unknowns are
addressed by R1–R14 above:

- R1 ↔ FR-030 (invite delivery)
- R2 ↔ FR-004 (state sections), Key Entities
- R3 ↔ Edge case "Email already exists"
- R4 ↔ FR-052 (anonymization counter), Edge case "Anonymized record collision"
- R5 ↔ FR-044, FR-053, Edge case "Last owner protection"
- R6 ↔ SC-003 (5-second offboard)
- R7 ↔ FR-037, FR-038
- R8 ↔ FR-030a
- R9 ↔ FR-035 (PIN reset notice)
- R10 ↔ FR-004 metadata "Last sign-in Today"
- R11 ↔ Key Entities (User ↔ Staff pairing)
- R12 ↔ Principle I (shadcn primitives only)
- R13 ↔ FR-004 (three-section list)
- R14 ↔ Edge case "Concurrent edits"

No open `NEEDS CLARIFICATION` markers remain.
