# Implementation Plan: Login UI/UX Redesign (Brand-Panel Shell)

**Branch**: `010-login-redesign` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/010-login-redesign/spec.md`

## Summary

Two parallel changes to the existing login surface (`/login` from
`003-login-flow`):

1. **Re-skin `/login` to the new Lacquer prototype** at
   `design-system/prototypes/auth/Login Screen.html` — a two-panel
   shell (1fr brand panel + 480px form panel), five view panes
   (`signin` / `forgot` / `forgot-sent` / `magic` / `magic-sent`)
   that swap via URL-seeded initial state + a tiny client island for
   intra-session transitions, a password reveal toggle on every
   password input, and dark-mode honouring via the existing
   `prefers-color-scheme` token cascade.

2. **Add a real password-reset flow** alongside magic-link
   (overrides `003-login-flow` FR-022). A new Server Action
   `sendPasswordReset` calls Supabase
   `resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`;
   the emailed link lands on a new `/reset-password` page that
   exchanges the PKCE `?code=` via the existing `/auth/callback`
   route's pattern (or a dedicated `/auth/callback?type=recovery`
   branch), then renders a "Set a new password" form whose Server
   Action calls `supabase.auth.updateUser({ password })`, writes a
   new `device.password_reset` audit row, and redirects to
   `/select-staff`. Magic-link survives as a peer second on-ramp.

**Technical approach**: This is **net-new functionality on top of
existing infrastructure** — no new dependencies, no new tables, no
new env vars. The auth surface is rebuilt as a Server Component
`/login/page.tsx` that picks one of five view components based on
query params (`?reset_intent=1`, `?reset_sent=<email>`,
`?magic_intent=1`, `?magic_sent=<email>`, otherwise `signin`); the
page hands the active view to a thin client wrapper that takes over
on hydration to enable instant in-page swaps (history-pushed query
params) and the password-reveal toggle. The brand panel is a pure
server component (no state). The new `/reset-password` route is a
sibling under `app/(auth)/` that reuses the same layout. The
`audit_log.action` controlled vocabulary gains one new value
(`device.password_reset`) defined in the existing `AuditAction`
union in `lib/auth/audit.ts` — no migration. CSS lives in
`styles/auth.css`, extended in place. The redesign **replaces** the
centred-card `.auth-shell` / `.auth-card` / `.auth-magic-link-*`
rules; keypad / staff-tile rules belong to `/select-staff` and are
untouched.

A single Supabase Auth config item must be set in each project
(preview + prod): the **Site URL** allowlist must include
`<origin>/reset-password` so the recovery email link is honoured.
This is recorded in `quickstart.md`; no code change.

See [research.md](./research.md) for the decision record and
[contracts/](./contracts/) for the updated server-actions, routes,
audit, and UI-views contracts.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS (matches the
repo's `engines`).

**Primary Dependencies**: Next.js 16 (App Router, RSC + Server
Actions), React 19, `@supabase/ssr` 0.10 + `@supabase/supabase-js`
2 (already installed). No new package additions. Lucide-react
(already installed) supplies `Eye`, `EyeOff`, `ChevronLeft`,
`AlertCircle` — the four icons the prototype uses. shadcn
primitives (`button`, `input`, `label`, `alert`) are already
installed from `003-login-flow`; no new ones needed.

**Storage**: Supabase Postgres. No schema migration in this
feature. `audit_log` accepts one new `action` value
(`device.password_reset`) added to the `AuditAction` union in
`lib/auth/audit.ts` — the table column is a free-form text so
adding the union member is the only code change. The seeded dev
owner already has `email_confirmed_at = now()` in
`supabase/seed.sql` (lines 14–62), so Google identity linking
already works against the preview project without seed changes.
**Production bootstrap** instructions in `quickstart.md` reiterate
that the first owner row must be created with `email_confirmed_at`
populated.

**Testing**: Vitest (unit) at `tests/unit/auth/login-actions.test.ts`
extended with: `sendPasswordReset` (success → redirect to
`?reset_sent=`; network failure → calm error; no-such-email →
still confirmation, no enumeration); a new
`tests/unit/auth/reset-password.test.ts` for the `/reset-password`
Server Action covering password validation (matching + 8-char
floor), audit-log write, and the expired-link branch. Playwright
(e2e) at `tests/e2e/auth.spec.ts` extended with: the full reset
flow (request → email lands in Inbucket via the local SMTP capture
already used for magic-link → open link → set new password → land
on `/select-staff`); the new view-swap UX (forgot ↔ signin ↔ magic
transitions preserve `?next=`); the password-reveal toggle keyboard
accessibility; and the prefers-reduced-motion guarded view
animation. The two-panel layout responsive collapse at 720px is
verified via Playwright's `setViewportSize` in a new spec block.

**Target Platform**: Web (modern evergreen browsers). Counter
laptop (desktop) and front-desk iPad (768px+) are primary; the
< 720px breakpoint collapses the brand panel for mobile emergency
access. Dark mode honoured at OS level via
`prefers-color-scheme: dark`.

**Project Type**: Next.js App Router web application (single repo
root). No structural change.

**Performance Goals**: View swaps complete within 200ms
(`viewIn` keyframe duration) on hydrated client; 0ms (no
animation) when `prefers-reduced-motion: reduce`. PKCE code
exchange on `/reset-password` completes within 500ms p95 against
preview Supabase. Total reset flow (request → email arrival → new
password set → land on `/select-staff`) completes in **under 60
seconds** of wall-clock time (SC-009), excluding email delivery
latency outside our control.

**Constraints**: Free-tier Supabase
(`project_supabase_dual_project` memory) — no new paid features.
Google OAuth, magic-link OTP, and `resetPasswordForEmail` are all
in free tier. No env vars added. All copy + visuals trace to
Lacquer tokens; `speckit-design-auditor` MUST pass with zero
violations (SC-001). No new test infrastructure; reuse the existing
local Supabase + Inbucket already set up for `003-login-flow`'s
magic-link e2e.

**Scale/Scope**: Single salon, ~10 staff, single-digit concurrent
sessions. The 50k-MAU Supabase free-tier ceiling is ~5000× headroom;
not a constraint.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1
design.*

| Principle | Compliance | Evidence |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | Pass | FR-027 mandates 100% token coverage; FR-028 adapts the vendored prototype at `design-system/prototypes/auth/Login Screen.html`; SC-001 gates on `speckit-design-auditor`. Lucide-only icons (Eye/EyeOff/ChevronLeft/AlertCircle) at 1.5px stroke per FR-011 + prototype source. No new component library; reuses shadcn primitives from `components/ui/*` and Lacquer-scoped components from `components/lacquer/*`. |
| **II. Server-Authoritative Architecture** | Pass | All sign-in, magic-link, reset-request, and password-update logic is in Server Actions; client island only handles in-page view swap + password reveal toggle. No client-side Supabase write path. No new Square or business-logic surface. `requireStudioSession()` is unchanged. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | Pass | New `device.password_reset` audit row written by the `/reset-password` Server Action on successful `updateUser` (FR-017(d), SC-009). Controlled-vocabulary union extended in `lib/auth/audit.ts`. No money flow touched. |
| **IV. Test-First for Critical Paths** | Pass | Reset flow is an auth-critical path → covered by both Vitest unit tests (request action, reset action, audit-log write) and Playwright e2e (full email round-trip). Test changes ship in the same PR (constitution review gate). |
| **V. Scope Discipline & Cost Restraint** | Pass | No new dependencies, env vars, migrations, or paid features. Free-tier Supabase confirmed (research R4). The override of `003-login-flow` FR-022 is documented + back-pointed in both specs (Clarifications session 2026-05-16). Self-signup, email-change, and MFA remain explicitly out of scope (FR-025). |

**Result**: All five principles pass. **No Complexity Tracking
entries required.**

Re-checked after Phase 1 design — still passes (no new
architectural decisions surface complexity).

## Project Structure

### Documentation (this feature)

```text
specs/010-login-redesign/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (read-only changes only)
├── quickstart.md        # Phase 1 output (operator + dev setup)
├── contracts/
│   ├── README.md
│   ├── server-actions.contract.md   # Extends 003 actions
│   ├── routes.contract.md           # Extends 003 routes + /reset-password
│   ├── audit.contract.md            # Adds device.password_reset
│   └── ui-views.contract.md         # The 5-view state machine
├── checklists/
│   └── requirements.md  # Already created by /speckit-specify
└── tasks.md             # Generated by /speckit-tasks
```

### Source Code (repository root)

```text
app/
├── (auth)/
│   ├── layout.tsx                          # Refactor: two-panel shell wrapper
│   ├── login/
│   │   ├── page.tsx                        # Refactor: view-state selection from search params
│   │   └── actions.ts                      # Extend: add sendPasswordReset action
│   ├── reset-password/                     # NEW
│   │   ├── page.tsx                        # NEW: PKCE exchange + new-password form
│   │   └── actions.ts                      # NEW: updatePassword action
│   └── select-staff/                       # Untouched (out of scope per FR-026)
│       ├── page.tsx
│       └── actions.ts
└── auth/callback/route.ts                  # Extend: branch on type=recovery → /reset-password

components/lacquer/
├── auth-shell.tsx                          # NEW: two-panel layout wrapper (server component)
├── auth-brand-panel.tsx                    # NEW: left brand panel with deco SVGs (server)
├── auth-form-panel.tsx                     # NEW: right form panel + solo wordmark (server)
├── auth-views.tsx                          # NEW: client island — view-swap + reveal toggle
├── login-form.tsx                          # Refactor: new layout, eye toggle, inline forgot link
├── google-sign-in-button.tsx               # Refactor: prototype's outline button styling
├── magic-link-control.tsx                  # Refactor: drops <details>, becomes a dedicated view
└── reset-password-form.tsx                 # NEW: new-password + confirm + reveal toggle

lib/auth/
├── audit.ts                                # Extend: add 'device.password_reset' to AuditAction union
└── (cookie.ts, session.ts, pin.ts, next-url.ts unchanged)

styles/
└── auth.css                                # Heavy refactor: two-panel shell, view-pane animation,
                                            #   forgot/reset confirm cards; remove .auth-shell/.auth-card,
                                            #   .auth-magic-link-* rules. Keypad/roster rules untouched.

design-system/prototypes/auth/              # Vendored prototype (already in place)
├── Login Screen.html
├── tweaks-panel.jsx
└── README.md

supabase/
└── seed.sql                                # Untouched — seeded owner already has
                                            # email_confirmed_at = now() (verified during planning).
                                            # Production bootstrap docs in quickstart.md.

tests/
├── e2e/
│   └── auth.spec.ts                        # Extend: reset flow, view swaps, reveal toggle,
                                            #   responsive collapse at 720px, reduced-motion
└── unit/
    └── auth/
        ├── login-actions.test.ts           # Extend: sendPasswordReset unit tests
        └── reset-password.test.ts          # NEW: updatePassword action + validation tests
```

**Structure Decision**: No structural change — extends the existing
Next.js App Router layout that `003-login-flow` established. New
files cluster under `app/(auth)/reset-password/` and
`components/lacquer/auth-*`. The `auth-views.tsx` client island is
the **only** new piece of client-side JavaScript; everything else
stays server-side per Principle II.

## Complexity Tracking

> Constitution Check passed with no violations. **This section is
> intentionally empty.**

No `app/(auth)/reset-password/` route alternative was considered
because the spec is explicit (FR-017): the route is named and the
shape (PKCE exchange + new-password form) follows Supabase's
documented App Router PKCE pattern. No deviation from the Lacquer
prototype's view structure was considered because the prototype is
the visual source of truth per Principle I.
