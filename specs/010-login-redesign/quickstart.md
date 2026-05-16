# Quickstart — Login UI/UX Redesign

Operator + developer setup for spec
[010-login-redesign](./spec.md). The redesign is **mostly
in-code** (a re-skin of `/login` + a new `/reset-password` page).
Two operator actions are required: one Supabase Auth config tweak
per project, and a one-time confirmation of how the production
owner row was seeded.

## TL;DR

| What | Who | When | Action |
|---|---|---|---|
| Add `<origin>/reset-password` to Supabase Site URL allowlist (preview + prod) | Operator | Before the first preview deploy of this branch | Supabase Dashboard → Authentication → URL Configuration → Add to Site URL / Redirect URLs |
| Confirm prod owner row has `email_confirmed_at` set | Operator | One-time, before the first owner attempts a Google sign-in | `select id, email, email_confirmed_at from auth.users where email = '<owner-email>'` — must be non-null |
| Enable Google as a provider in Supabase | Operator | Before exercising "Continue with Google" | Supabase Dashboard → Authentication → Providers → Google → paste OAuth client ID + secret |
| `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` on Vercel | Operator | When the Google provider is live | Vercel Dashboard → Project → Settings → Environment Variables |
| Run the gate set | Developer | Before pushing this branch | `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:e2e -- --workers=1` |

## 1. Supabase Auth — Site URL allowlist (research R3)

`resetPasswordForEmail({ redirectTo })` is validated server-side
against the project's Site URL + Additional Redirect URLs
allowlist. Without an entry, the call succeeds but the emailed
link is rejected on click.

### Preview project

In **Supabase Dashboard → Preview project → Authentication →
URL Configuration**:

- **Site URL**: keep at `https://salon-management-git-main-mearatjames.vercel.app`
  (or whatever the preview's stable URL is).
- **Additional Redirect URLs**: add
  `https://salon-management-git-*-mearatjames.vercel.app/auth/callback`
  (already present from `003-login-flow` — verify) AND
  `https://salon-management-git-*-mearatjames.vercel.app/reset-password`
  (NEW — needed for the recovery email link).

The wildcard pattern (`*`) is supported by Supabase and covers
every preview deploy.

### Production project

In **Supabase Dashboard → Production project → Authentication →
URL Configuration**:

- **Site URL**: keep at `https://salon-management.vercel.app`
  (or your custom domain).
- **Additional Redirect URLs**: add
  `https://salon-management.vercel.app/auth/callback` (verify
  — should already be present from `003-login-flow`) AND
  `https://salon-management.vercel.app/reset-password` (NEW).

Click **Save**. No re-deploy required — Supabase honours the
new allowlist on the next request.

## 2. Confirm production owner has confirmed email (data-model.md Invariant A)

Google identity auto-linking by verified email (research R4)
only fires when the existing user's `email_confirmed_at` is
non-null. The dev seed already satisfies this; verify production:

```sql
-- Run in Supabase Dashboard → Production project → SQL Editor
select id, email, email_confirmed_at
from auth.users
where email = '<your owner email>';
```

If `email_confirmed_at IS NULL`, fix with:

```sql
update auth.users
set email_confirmed_at = now()
where email = '<your owner email>'
  and email_confirmed_at is null;
```

This is a one-time bootstrap fix. Any future owner seeded via
Settings → Staff (out of scope, future feature) will go through
Supabase's standard email-confirmation flow and populate the
column automatically.

## 3. Google OAuth — enable in Supabase + flip the env var

(Optional but recommended — unlocks the "Continue with Google"
button.)

### a) Create OAuth client in Google Cloud Console

1. https://console.cloud.google.com → APIs & Services →
   Credentials → Create Credentials → OAuth client ID.
2. Application type: Web application.
3. Authorized redirect URIs:
   - `https://<preview-supabase-project-ref>.supabase.co/auth/v1/callback`
   - `https://<production-supabase-project-ref>.supabase.co/auth/v1/callback`
4. Save and copy the Client ID + Client Secret.

### b) Paste into Supabase

In Supabase Dashboard → Authentication → Providers → Google:

- Toggle **Enabled**.
- Paste **Client ID** and **Client Secret**.
- Save.

Repeat for both preview + prod Supabase projects.

### c) Flip the Vercel env var

In Vercel Dashboard → Project → Settings → Environment
Variables:

- Add `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` for both Preview
  and Production environments.
- Trigger a redeploy (or wait for the next push to `main`).

The "Continue with Google" button + the "OR" divider above it
appear once the env var is `true`. With the env unset or `false`,
the button + divider hide cleanly (US5 acceptance scenario 3).

## 4. Local development

No setup changes required for this feature. The existing
`npm run dev:supabase` + `npm run dev` flow from
`003-login-flow` already includes Inbucket for SMTP capture of
auth emails (used by the magic-link e2e and now reused by the
reset-password e2e — research R9).

To eyeball the redesign:

```sh
npm run dev:supabase   # local Supabase + Inbucket on http://localhost:54324
npm run dev            # Next.js on http://localhost:3000
```

Then in a browser:

- http://localhost:3000/login — the new two-panel shell.
- http://localhost:3000/login?reset_intent=1 — jumps straight
  to the forgot view (URL-seeded; useful for visual review).
- http://localhost:3000/login?reset_sent=test@example.com —
  jumps to the forgot-sent confirmation.
- http://localhost:3000/login?magic_intent=1 — jumps to the
  magic-link view.
- http://localhost:3000/login?magic_sent=test@example.com —
  jumps to the magic-sent confirmation.

Trigger a real reset against the seeded
`owner@tangnails.dev`: type the email on the forgot view,
submit, then open http://localhost:54324 and click the most
recent email's link. It lands on `/reset-password` with a
session established; set any 8+ character password and you're
redirected to `/select-staff`.

## 5. Verify the redesign before pushing

Run the full local gate set in order (matches CI):

```sh
npm run format:check
npm run lint
npm run typecheck
npm test                          # Vitest unit suite
npm run test:e2e -- --workers=1   # Playwright; --workers=1 to avoid
                                  # audit_log truncate races across spec files
```

All five MUST be green. Per
`feedback_run_full_gate_set_before_push` and Constitution v1.0.3
§ Development Workflow & Quality Gates.

If any step bounces, fix locally before pushing — CI will
otherwise bounce the PR for the same reason.

## 6. Verify in a browser (Principle I — non-negotiable)

UI tasks are not complete until you have:

1. Opened http://localhost:3000/login in a browser at
   ≥ 720px width, compared the rendered output side-by-side
   with `design-system/prototypes/auth/Login Screen.html`
   (open both in separate tabs), and confirmed every value
   matches.
2. Resized the browser to < 720px (640, 480, 360 — any will
   do) and confirmed the brand panel hides, the form panel
   fills the viewport, the solo wordmark appears above the
   form.
3. Enabled "Reduce motion" in your OS settings, refreshed the
   page, clicked "Forgot password?" — confirmed the swap is
   instant (no fade, no translate).
4. Toggled OS dark mode — confirmed both the brand panel and
   the form panel pick up the dark Lacquer tokens.
5. Tabbed through the sign-in view — confirmed the tab order
   matches contracts/ui-views.contract.md § Tab order across
   the new shell.
6. Run `speckit-design-auditor` against the changed surface (it
   runs as part of `npm run lint` if wired up; otherwise invoke
   the skill directly) — confirmed **zero** violations.

Per the constitution: "A UI task is complete only after a
side-by-side comparison against the canonical
`design-system/preview/*.html` and confirmation that every
value traces to a token."

## 7. Operator smoke test on preview (recommended)

After the preview deploy:

1. Visit https://salon-management-git-010-login-redesign-mearatjames.vercel.app/login
   (or whatever the preview URL is).
2. Click "Forgot password?". Confirm the view swaps.
3. Type `owner@tangnails.dev` (or your test email) and submit.
4. Confirm the forgot-sent view shows.
5. Open the email in your inbox (or Inbucket, locally). Click
   the link.
6. Confirm you land on `/reset-password` with a "Set a new
   password" form.
7. Enter `tang-nails-dev-new` twice; submit. Confirm the
   redirect to `/select-staff`.
8. Pin in as Maya (PIN 1234) — confirm you reach the dashboard.
9. Sign out. Sign back in with the new password — confirm it
   works.

## Where to look if something breaks

| Symptom | Likely cause | Fix |
|---|---|---|
| Reset email never arrives | Local: Inbucket not running. Preview/prod: Supabase SMTP not configured. | Local: `npm run dev:supabase` brings up Inbucket. Hosted: Supabase Dashboard → Authentication → Email Templates → ensure built-in SMTP is enabled (default). |
| Reset link returns 404 / "URL not allowed" | Supabase Site URL allowlist missing `/reset-password` entry. | §1 above. |
| Reset link works but lands on `/login?error=oauth_failed` instead of `/reset-password` | `/auth/callback` recovery branch is not detecting `?type=recovery`. | Check `app/auth/callback/route.ts` extension; verify the test asserting "recovery exchange → /reset-password" is green. |
| Google sign-in for the seeded owner creates a 2nd user row | The owner row's `email_confirmed_at` is NULL. | §2 above; or run `update auth.users set email_confirmed_at = now() where ...`. |
| `npm run test:e2e` bounces on `audit_log` truncate race | `--workers=1` was omitted. | Re-run with `--workers=1`. Documented in CLAUDE.md § Pre-push quality gates. |
