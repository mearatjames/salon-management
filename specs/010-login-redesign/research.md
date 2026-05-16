# Phase 0 Research — Login UI/UX Redesign

This document records the resolved decisions behind the
implementation plan. Each entry follows the canonical
**Decision / Rationale / Alternatives Considered** shape. All
items the plan depends on are listed; none are open.

The Clarifications session on 2026-05-16 (see
[spec.md](./spec.md) § Clarifications) already resolved the
product-level questions. This file records the **engineering**
decisions that fall out of those choices.

---

## R1. View-state architecture: URL-seeded server render + thin client island

**Decision**: `/login/page.tsx` stays a Server Component. It
reads the request's search params and renders one of five
view components (`signin` / `forgot` / `forgot-sent` /
`magic` / `magic-sent`) based on this precedence:

```
?reset_sent=<email>   → forgot-sent
?reset_intent=1       → forgot
?magic_sent=<email>   → magic-sent
?magic_intent=1       → magic
(otherwise)           → signin
```

On hydration, the page wraps the active view in a thin client
component (`auth-views.tsx`) that intercepts back-button +
forward-link clicks to swap views in-place using
`history.pushState` (without a server round-trip). The
animation (`viewIn` keyframe) runs on each swap.

**Rationale**: This is the cleanest split between RSC-first
rendering (per Principle II) and the prototype's transition
animation. The URL-seeded server render means the no-JS path
works end-to-end: the "Forgot password?" link is a plain `<a>`
to `/login?reset_intent=1`, and a no-JS user sees the same
visual swap (no animation) without any client code. With JS,
the same anchor's click handler is intercepted, the URL is
pushed via `history.pushState`, and the swap animates.

**Alternatives considered**:

- **All-client view-state machine** (e.g. `useState` for
  the current view) — rejected because it forces full client
  hydration to even see the initial view, breaks the no-JS
  path, and runs the animation on first paint (which is jarring
  and reduced-motion-hostile).
- **Per-view routes** (`/login`, `/login/forgot`,
  `/login/magic`) — rejected because it triggers a full Next.js
  route transition (layout re-mount, scroll-position lose) for
  what should be a 200ms in-pane fade. The prototype's UX is
  unambiguously an in-pane swap, not a navigation.
- **Pure server render every swap** (clicking "Forgot
  password?" issues a real GET) — rejected because it loses the
  `viewIn` animation entirely. The no-JS path already gets this
  behaviour as a fallback; we shouldn't degrade the JS path to
  match.

---

## R2. PKCE recovery callback: branch the existing `/auth/callback`

**Decision**: Extend the existing
`app/auth/callback/route.ts` (`003-login-flow`) to branch on
`type=recovery` and forward those exchanges to
`/reset-password` instead of `/select-staff`. The branch is
detected by Supabase's `?type=recovery` query param on the
emailed link.

Flow:

```
[ Reset email link ]
  ↓
GET /auth/callback?code=<pkce>&type=recovery
  ↓
exchangeCodeForSession(code) → session cookies set
  ↓
recordAuth("device.signed_in", userId, null, { method: "recovery" })
  ↓
redirect → /reset-password
  ↓
( page is now authenticated; renders new-password form )
```

**Rationale**: One route handler beats two. The existing
callback already encapsulates PKCE exchange + audit-log emission
+ error redirect; branching on `type=recovery` reuses 100% of
that plumbing. Supabase's
`resetPasswordForEmail({ redirectTo })` natively appends
`?code=&type=recovery` to the URL, so no extra encoding work is
needed at the request side.

**Audit semantics**: the recovery PKCE exchange is itself a
device sign-in (the user is authenticated by the link), so
`device.signed_in` with `method: "recovery"` is the correct
audit row. The subsequent `device.password_reset` row is
written when the user actually submits the new password — two
distinct events, both auditable.

**Alternatives considered**:

- **Dedicated route handler at `/auth/recovery-callback`** —
  rejected as duplication. The exchange logic is identical;
  only the post-exchange redirect target differs. A one-line
  branch in the existing handler is strictly simpler.
- **Exchange on the `/reset-password` page itself** (call
  `exchangeCodeForSession` inside `page.tsx`) — rejected because
  it forces every refresh of the page to re-exchange (which
  fails — PKCE codes are single-use). The exchange must happen
  exactly once, and the redirect-then-render pattern guarantees
  that.

---

## R3. Supabase Auth configuration: Site URL allowlist only

**Decision**: The only Supabase Auth config change required is
adding `<origin>/reset-password` to the **Site URL** allowlist
in Supabase Dashboard → Authentication → URL Configuration, for
both preview and production projects. Recorded in
`quickstart.md`. No env var, no code change.

**Rationale**: `resetPasswordForEmail({ redirectTo })` is
validated server-side by Supabase against the project's Site URL
+ Additional Redirect URLs allowlist. Without the allowlist
entry, the call succeeds but the emailed link is rejected on
redirect. This is the entire operator action needed; the rest
is all in code.

The Site URL needs **both**:
- Preview: `https://salon-management-git-<feature>-mearatjames.vercel.app/reset-password`
  via wildcard pattern
  `https://salon-management-git-*-mearatjames.vercel.app/reset-password`
  (the wildcard is supported by Supabase).
- Production: `https://salon-management.vercel.app/reset-password`
  (or whatever the production domain is — also recorded in
  `quickstart.md`).

**Alternatives considered**:

- **Env var for the reset URL** — rejected because the URL is
  derivable from `request.headers().get('origin')` (same
  pattern as `signInWithGoogle` in
  `app/(auth)/login/actions.ts:79`). An env var would duplicate
  config that's already implicit in the deployment URL.
- **Hardcoded `https://salon-management.vercel.app`** —
  rejected because it would break preview deploys (each has a
  unique URL).

---

## R4. Supabase account linking: leave default ON, rely on confirmed-email guard

**Decision**: Supabase's default automatic identity linking by
verified email is left enabled. The seeded dev owner already
has `email_confirmed_at = now()` in `supabase/seed.sql:21,43`,
so Google sign-in for the same email merges into the existing
user. Production bootstrap docs in `quickstart.md` reiterate
the requirement to set `email_confirmed_at` when inserting the
first owner via Studio SQL.

**Rationale**: Auto-linking is what the user explicitly asked
for ("If I have a user that already created with the gmail
email will it be able to be considered as one user?"). Supabase
defends against the takeover-via-OAuth attack by refusing to
link to an unconfirmed identity — so the only operator
discipline required is "create owners with confirmed emails."
The dev seed already does this; production bootstrap is a
one-line `email_confirmed_at => now()` in the Studio SQL.

**Verified during planning**: SC-010 is testable today against
the preview project — sign in with the seeded
`owner@tangnails.dev` email/password, then sign out, then sign
in with Google for the same email. Inspect
`auth.users WHERE email = 'owner@tangnails.dev'` (single row)
and `auth.identities WHERE user_id = '<that id>'` (two rows:
one `email`, one `google`).

**Alternatives considered**:

- **Disable auto-linking** and rely on manual `linkIdentity()`
  invoked from a settings page — rejected because (a) the
  user explicitly asked for the auto-merge behaviour; (b) it
  would require new UI surface (a "Link Google" button in
  Settings → Profile) that this feature doesn't ship; (c) the
  dev seed already meets the safety precondition.
- **Force email confirmation on every signup** (Supabase
  Dashboard → Authentication → Email → "Enable email
  confirmations") — partial overlap; the dev seed bypasses it
  (correctly — seed is internal), so the setting only affects
  the hypothetical self-signup path that's explicitly out of
  scope (FR-025). Leaving the setting at its default avoids a
  config change that has no effect on our flows.

**Sources**:

- [Identity Linking | Supabase Docs](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Pricing & Fees | Supabase](https://supabase.com/pricing) —
  social OAuth providers are included in the free tier; no
  upcharge for Google, no upcharge for `resetPasswordForEmail`.

---

## R5. Magic-link enumeration parity for reset-password

**Decision**: `sendPasswordReset(email)` MUST follow the same
no-enumeration contract that
`signInWithMagicLink` already enforces
(`app/(auth)/login/actions.ts:126-168`): on success, on
unknown-email, **and** on SDK failure, always redirect to
`/login?reset_sent=<encoded-email>` so the forgot-sent
confirmation appears identically. Only true network failures
surface a calm `?error=network` redirect on the `forgot` view.

**Rationale**: Supabase's `resetPasswordForEmail` already
behaves the same way (it doesn't reveal whether the email is
registered) — but we MUST still wrap it in the same defensive
swallow pattern to defeat side-channel timing differences. The
existing magic-link action proves the pattern works in
production (`003-login-flow` FR-019); we copy it byte-for-byte.

**Alternatives considered**:

- **Show a real "no such email" error** — rejected per
  `003-login-flow` FR-019 and the spec's edge case "Password
  reset for a non-existent email." Account enumeration is a
  documented OWASP category; defending against it is required.
- **Add a CAPTCHA on the `forgot` view** — rejected as scope
  creep; the salon counter is the only entry point and rate
  limiting at Supabase's edge already protects against the
  brute-force case.

---

## R6. View animation + reduced-motion gating

**Decision**: The `viewIn` keyframe (200ms fade + 8px
translate-up, `ease-out-expo`) ships in `styles/auth.css`,
wrapped in
`@media (prefers-reduced-motion: no-preference) { ... }` so it
is a no-op for users who request reduced motion. The
no-preference branch is the default per WCAG 2.3.3 — users
who haven't expressed a preference see the animation.

**Rationale**: WCAG 2.3.3 requires honoring `reduced-motion`;
Principle I (Lacquer animation rules: 150ms hover, 200ms
popover, 300ms sheet) explicitly endorses the 200ms duration.
The prototype's `viewIn` is exactly the canonical Lacquer
animation, so we adopt the entire keyframe verbatim. The
media-query wrapper is the one tweak we add for accessibility.

**Alternatives considered**:

- **JS-driven animation** (Framer Motion, etc.) — rejected;
  adds a dependency for one 200ms CSS animation. Pure CSS is
  smaller, faster, and accessible by default.
- **Animate only on the first hydration** (skip subsequent
  swaps) — rejected; the prototype's UX expects every swap to
  animate, and a one-shot is harder to reason about than a
  consistent rule.

---

## R7. Password reveal toggle: client island, type-attribute swap

**Decision**: The eye-toggle button lives in the
`auth-views.tsx` client island. It toggles a local
`useState<boolean>` (one per password field) and the rendered
`<input>` switches between `type="password"` and
`type="text"`. The toggle state resets to `false` on every view
swap (an effect tied to the active view key).

The button's `aria-label` updates in lockstep
("Show password" ↔ "Hide password"). Tab order places it
immediately after the password input so keyboard users hit it
naturally on Tab + Enter.

**Rationale**: The simplest possible implementation that
matches the prototype. Browser autofill remains masked on first
paint (FR-013 edge case) because the initial state is `false`
and React only flips it on user interaction. The reset-on-swap
behaviour (FR-012) is one `useEffect(() => setShown(false), [view])`.

**Alternatives considered**:

- **Reveal-on-hover** (CSS-only with `:hover`) — rejected;
  it's hostile to touch devices, leaks the password to anyone
  with screen-recording access, and the prototype is explicit
  about a click-toggle button.
- **Persist reveal state across swaps** (carry it in a context
  or URL) — rejected; FR-012 explicitly requires reset on
  swap so a previously revealed password doesn't bleed across
  views (e.g. signin → forgot → back to signin would re-show
  the previously typed + revealed password). Reset is the safer
  default.

---

## R8. Audit-log union extension: `device.password_reset`

**Decision**: Add `"device.password_reset"` to the
`AuditAction` union in `lib/auth/audit.ts:29-47`. The
`deriveEntityType` switch
(`lib/auth/audit.ts:49-62`) already routes any non-`service.*`
non-`staff.*` action to `"auth"` — so the new value picks up
`entity_type: "auth"` automatically without touching the
dispatch.

The new row is written from the `/reset-password` Server Action
on successful `updateUser({ password })`:

```ts
await recordAuth(
  "device.password_reset",
  userId,
  null,                                  // entityId — not a staff event
  { method: "recovery" }                 // payload — distinguishes from a
                                         //   future Settings-driven password
                                         //   change which would carry
                                         //   { method: "self_service" }
);
```

**Rationale**: Matches the established pattern from
`003-login-flow` exactly. No migration, no contract churn — the
free-form `text` column on `audit_log.action` accepts any
string; the controlled-vocabulary discipline is enforced in TS.
Future Settings → Change Password (out of scope here) would
reuse the same action with a different `payload.method`.

**Alternatives considered**:

- **Two separate actions** (`device.password_reset_requested`,
  `device.password_reset_completed`) — rejected as low value;
  the request itself already emits no event (Supabase handles
  the send), and the `device.signed_in` row written by the
  `/auth/callback` recovery branch (R2) already captures the
  "exchange happened" moment. One completion event is enough.
- **Bury the event in `payload` of an existing action** —
  rejected; controlled-vocabulary actions are the audit table's
  primary index, and burying makes querying brittle.

---

## R9. Test infrastructure: reuse Inbucket for reset emails

**Decision**: The Playwright e2e test for the reset flow uses
the same local Supabase + Inbucket SMTP-capture setup that
`003-login-flow`'s magic-link e2e already uses. No new test
infrastructure.

**Rationale**: Local Supabase (via `supabase start`) launches
Inbucket on `http://localhost:54324` and routes all outbound
auth emails there. The existing magic-link test already
fetches the email body, extracts the link, and follows it; the
reset test follows the identical pattern with a different
button click and a different post-link assertion (new-password
form instead of automatic sign-in).

**Alternatives considered**:

- **Mock Supabase Auth entirely** — rejected; we already pay
  the cost of a real Supabase in CI for `003-login-flow`, and
  reset is an auth-critical path (Principle IV) where mocks
  diverge from production behaviour exactly when it matters
  most.
- **Use a hosted email-capture service** (e.g. Mailosaur) —
  rejected as cost (and scope, per Principle V).

---

## R10. CSS strategy: extend `styles/auth.css` in place; remove
deprecated selectors

**Decision**: All new styles ship as additions/replacements in
`styles/auth.css`. Specifically:

- **Add**: `.auth-shell` (replacing the old centred-card
  meaning), `.auth-brand-panel`, `.auth-form-panel`,
  `.auth-form-well`, `.auth-view-pane` (with the `viewIn`
  keyframe), `.auth-eye-toggle`, `.auth-inline-link`
  (Forgot password? styling), `.auth-back-btn`,
  `.auth-confirm-card`, `.auth-divider-or` (the "OR" between
  password and Google), `.auth-solo-mark` (sub-720px
  wordmark).
- **Remove**: `.auth-card`, `.auth-magic-link-details`,
  `.auth-magic-link-form`, `.auth-magic-link`, and the old
  meaning of `.auth-shell` as a centred wrapper.
- **Keep untouched**: every `.auth-keypad*`, `.auth-staff-tile`,
  `.auth-roster` rule — they belong to `/select-staff` which is
  explicitly out of scope per FR-026.

**Rationale**: One file, one PR, clear diff. The CSS surface is
small enough (≈ 250 lines) that splitting per-view would just
create indirection. The constitution's design-system fidelity
rule is enforced by the design auditor regardless of how the
file is organised; one file is easier to audit.

**Alternatives considered**:

- **CSS Modules per component** — rejected because the rest
  of the app uses global tokens-backed CSS in `styles/*.css`
  (consistent with `003-login-flow` and the dashboard feature).
  Introducing CSS Modules here would split the convention.
- **Tailwind utility classes** — rejected; the project's
  convention (per `CLAUDE.md` and the Lacquer prototype) is
  semantic class names that resolve to tokens, not inline
  utilities. Switching here would violate Principle I's "no
  second component library / styling system" intent.

---

## R11. Scope safety: `/select-staff` and middleware unchanged

**Decision**: This feature does NOT touch:

- `app/(auth)/select-staff/*` (the PIN keypad surface)
- `middleware.ts` (the studio gate)
- `lib/auth/cookie.ts`, `lib/auth/session.ts`,
  `lib/auth/pin.ts`, `lib/auth/next-url.ts`
- Any `(studio)` route or shell component
- `supabase/migrations/0001_auth_schema.sql` (no schema change)

**Rationale**: Spec FR-026 explicitly bounds scope. Every
change in the diff must land within `/login`, the new
`/reset-password` surface, the prototype-vendored
`design-system/prototypes/auth/`, and their direct test and
component-library dependencies. Reviewers can quickly verify
this by checking the file list of the eventual PR against the
plan's "Project Structure → Source Code" tree.

**Alternatives considered**: none — scope discipline is
load-bearing for Principle V.

---

## Summary of unknowns resolved

| Category | Status before clarify | Status now |
|---|---|---|
| Forgot-password vs magic-link role | Open (deferred by 003 FR-022) | **Resolved** — both ship as peer recovery (Clarifications Q2) |
| Google identity linking semantics | Open (research request) | **Resolved** — auto-link by verified email; free-tier (R4) |
| Reset email allowlist setup | Implicit | **Resolved** — operator action documented in quickstart (R3) |
| View-swap architecture | Implicit | **Resolved** — URL-seeded server render + client island (R1) |
| PKCE recovery handling | Implicit | **Resolved** — branch existing /auth/callback (R2) |
| Audit-log extension | Implicit | **Resolved** — one new union member (R8) |
| Reduced-motion gating | Implicit | **Resolved** — `@media` wrapper around `viewIn` (R6) |
| Password-reveal state model | Implicit | **Resolved** — local state, reset on swap (R7) |
| Reset post-success destination | Open (clarify) | **Resolved** — `/select-staff` (Clarifications Q4) |
| Reset link TTL | Open (clarify) | **Resolved** — Supabase default 1h (Clarifications Q5) |
| Enumeration safety on reset | Implicit | **Resolved** — same swallow-pattern as magic-link (R5) |
| CSS organisation | Implicit | **Resolved** — extend `styles/auth.css` in place (R10) |

No `NEEDS CLARIFICATION` markers remain. Plan is ready for
Phase 1 design.
