# Quickstart — User Onboarding & Offboarding

Operator + developer setup for the `012-user-onboarding` feature. Read this before running `/speckit-tasks` or starting implementation.

## Dependencies (one-time)

```bash
# In the worktree root
cd /Users/mearathou/Dev/salon-management/.worktrees/012-user-onboarding

# shadcn primitives — sheet (3 sheets), dialog (Reset PIN), dropdown-menu (row menus)
npx shadcn@latest add sheet dialog dropdown-menu
```

No new npm packages. No new environment variables. The existing
`SUPABASE_SERVICE_ROLE_KEY` (already used by `lib/db/admin.ts` for
audit writes) powers every Supabase admin API call in this feature.

## Local Supabase

The existing `npm run db:reset` / `npm run db:seed` flow (set up in 003) covers everything this feature needs. Make sure the local Supabase stack is running and `supabase migration up` has applied `0004_user_onboarding.sql`:

```bash
cd /Users/mearathou/Dev/salon-management/.worktrees/012-user-onboarding
supabase status  # confirm running
supabase migration up  # apply 0004 + any prior un-applied migrations
```

After migration, every existing staff row has `state='active'` (backfill is idempotent — re-running the migration is safe).

## Email capture (Inbucket)

Magic-link and invite emails land in the existing local Inbucket inbox (port `54324` by default; check `supabase status` for the resolved URL). The e2e suite already polls Inbucket via the helpers set up in 003 for magic-link and extended in 010 for recovery — the new invite template lands in the same inbox under the same recipient address.

To verify locally:

1. Run `npm run dev`.
2. Sign in as the seeded owner (Priya).
3. Go to `/settings/onboarding` → click `Onboard user`.
4. In Quick mode, enter a name + a unique email + role, click `Send invite`.
5. Open Inbucket (`http://127.0.0.1:54324` or whatever `supabase status` shows under "Inbucket URL").
6. Click the new email → click the magic link → land on `/select-staff` signed in as the invitee.

## Production bootstrap (no change from 010)

This feature uses the same Supabase auth infrastructure 010 wired up. Specifically:

- The **Site URL allowlist** must include `<origin>/auth/callback` so that magic-link and recovery emails redirect correctly. This was added to both preview and prod Supabase projects in `010-login-redesign` (per its `quickstart.md`). No change needed for this feature.
- The **redirect URL allowlist** must also include `<origin>/reset-password` (for the password-method invite leg). Already configured by 010.
- No new SMTP setup — the Supabase default sender carries invites in production.

If a new operator is bootstrapping the production Supabase project from scratch, see `specs/010-login-redesign/quickstart.md § Production bootstrap` for the SQL recipe to seed the first owner with `email_confirmed_at = now()`. This feature inherits that requirement (no extra steps).

## Running the tests

Per CLAUDE.md "Pre-push quality gates" (constitution v1.0.3):

```bash
# Cheap gates first
npm run format:check
npm run lint
npm run typecheck

# Unit tests
npm test

# E2E (parallel by default; set PLAYWRIGHT_PROD=1 for prebuilt prod build)
npm run test:e2e
```

For intermediate phase verification during `/speckit-implement`, use the scoped commands from CLAUDE.md "Scoping intermediate phase gates" — e.g.

```bash
# Verifying US3 after its phase
npx playwright test tests/e2e/onboarding.spec.ts -g "US3"

# Lint + format only the files changed in the phase
npx prettier --check $(git diff --name-only --diff-filter=ACMR HEAD)
npx eslint $(git diff --name-only --diff-filter=ACMR HEAD | grep -E '\.(ts|tsx|js|jsx)$' || echo .)
```

The final phase always runs the full suite end-to-end before merging.

## Manual smoke test (post-implementation)

For a 10-minute verification before opening the PR:

1. **Quick invite** — Onboard a fictional tech with a magic-link invite. Open Inbucket; click the link; confirm the row moves from Pending → Active in real time after the page reloads.
2. **Thorough invite (password)** — Onboard a fictional front-desk user via Thorough → password method. Open Inbucket; click the invite link; confirm you land on `/reset-password?type=invite` with the "Set your password" heading; set a password ≥ 8 chars; confirm you land on `/select-staff`; sign in with the same email+password (sign out + back in) to prove the password works.
3. **Reset PIN** — Click ⋯ on the seeded tech row → Reset PIN → enter two matching 4-digit PINs → save. Sign out, sign in as that tech, confirm the `/select-staff` banner says "Your PIN was reset by an owner" and clears after a successful PIN.
4. **Soft offboard** — Offboard the same tech with reason "Performance". Confirm the row leaves Active, appears in Offboarded with the reason. Try to sign back in as that user — you should get the standard invalid-credentials error.
5. **Reactivate** — From Offboarded, click ⋯ → Reactivate. Confirm the row moves to Pending; the user receives a fresh invite; clicking it signs them back in.
6. **Hard remove** — From Offboarded (a different user), click ⋯ → Remove permanently → check both acks, type the full name → confirm. Row disappears; subsequent invite to the same email succeeds.
7. **Last owner** — try to offboard the only owner (yourself); the Offboard menu item should be replaced with the explanatory line. Try to call the action via DevTools form-post against another owner's row when there is only one — confirm `?error=last_owner`.
8. **Search** — type a fragment of a name; all three sections filter live; clear the search; sections reappear.

## Operator notes

- Pending invites do NOT count toward the salon's "active staff" total in any reports — they appear in the page only.
- Offboarded users continue to be attributed on past appointments and tickets — their tip splits and commission history remain intact.
- Hard-removed users' past tickets show "Former staff #N" as the technician name. Owners reviewing historical reports see this placeholder instead of the original name; the original name + email survive only in the `audit_log` row written at remove time.
- The audit log is not surfaced in the UI in this feature; an owner who needs to investigate (e.g. "who reset Maya's PIN last week?") queries the `audit_log` table directly via Supabase Studio.

## What's not in scope

- No CSV / bulk invite.
- No edit-an-already-sent invite (cancel + re-invite instead).
- No custom invite email templates (uses Supabase default).
- No SSO, SCIM, domain claim, or organization-level features.
- No per-staff fine-grained permissions beyond the four roles.
- No audit-log viewer / search UI.
- No support for users with multiple emails / identities (Supabase identity linking from 010 is unchanged; this feature operates on the primary email).
