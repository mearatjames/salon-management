# Implementation Plan: User Onboarding & Offboarding

**Branch**: `012-user-onboarding` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-user-onboarding/spec.md`

## Summary

A new owners-only **Settings → Onboarding** tab that owns the *lifecycle*
of users with email-login access — invite, offboard (soft / reversible),
remove (hard / irreversible), reactivate, resend, cancel — while the
existing **Settings → Staff** tab keeps its day-to-day operational role
(schedule, color, PIN, name, role within the manager-allowed scope).

The page adapts the Lacquer prototype at
`design-system/prototypes/onboarding/User Onboarding.html` verbatim: a
hero with three live counts + an **Onboard user** primary CTA, three
stacked sections (Pending invites · Active accounts · Offboarded) with
per-row action menus, three right-side sheets (Onboard / Offboard /
Remove), and a PIN modal lifted from the existing Staff change-PIN flow.

**Technical approach** — net-new functionality on top of existing
infrastructure:

1. **One Supabase migration** (`0004_user_onboarding.sql`) extending
   `public.staff` with a `state` enum (`active`/`invited`/`offboarded`),
   `email`, invite metadata (`invited_at`, `invited_by`, `invite_method`),
   offboard metadata (`offboarded_at`, `offboarded_by`, `offboard_reason`),
   `last_sign_in_at`, `pin_reset_admin_at`, and an anonymization sequence
   for the hard-remove placeholder counter. No new tables.
2. **Six new server actions** in
   `app/(studio)/settings/onboarding/actions.ts` —
   `inviteUser`, `resendInvite`, `cancelInvite`, `offboardUser`,
   `reactivateUser`, `removeUser` — plus two thin wrappers
   (`resetUserPin`, `sendUserPasswordReset`) for the Active row menu
   that reuse the existing `setStaffPin` and the 010 `sendPasswordReset`
   patterns with an `actor=admin` audit tag.
3. **One new page + three new sheet components + one PIN modal reuse**
   under `app/(studio)/settings/onboarding/` and
   `components/lacquer/onboarding/`. All server-rendered shell; client
   islands only for sheets, menus, and the search input.
4. **Audit-log union extension** adds seven event types
   (`user.invited`, `user.invite_resent`, `user.invite_cancelled`,
   `user.offboarded`, `user.reactivated`, `user.removed`,
   `user.pin_reset`) — one-line edit to `lib/auth/audit.ts` plus a
   tweak to `deriveEntityType` so the `user.*` prefix routes to
   `entity_type = "user"`. `device.password_reset` is reused with an
   optional `actor=admin` payload flag.
5. **Single role-permissions module** at `lib/auth/role-permissions.ts`
   becomes the source of truth shared by the Thorough wizard's
   Permissions card, the Staff tab's empty-state hints, and any future
   role-comparison view (FR-080).
6. **`/reset-password` route gains `?type=invite` mode** (FR-030a) —
   page reads the query param, swaps copy ("Set your password" instead
   of "Reset your password"), forwards an additional `method=invite`
   tag to the audit payload, and reuses the existing PKCE exchange +
   `updateUser({ password })` logic verbatim. `/auth/callback` gains a
   sibling branch to `type=invite` matching the existing `type=recovery`
   branch.
7. **TabBar gains the Onboarding entry** between Staff and Notifications
   (FR-001).

See [research.md](./research.md) for the decision record (invite link
generation, lifecycle state column vs. existing `active` flag, anon
counter, RLS surface, owner-initiated reset audit tagging) and
[contracts/](./contracts/) for the server-actions, routes, audit,
permissions, and ui-views contracts.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS (matches the
repo's `engines`).

**Primary Dependencies**: Next.js 16 (App Router, RSC + Server
Actions), React 19, `@supabase/ssr` 0.10 + `@supabase/supabase-js` 2
(already installed). No new package additions. Lucide-react supplies
the prototype's icons (`Mail`, `Check`, `Archive`, `RefreshCcw`,
`Send`, `Copy`, `X`, `MoreHorizontal`, `Pencil`, `Key`, `Trash`,
`Clock`, `AlertTriangle`, `Info`, `UserPlus`, `Link`, `ArrowLeft`,
`Search`) — all available in the installed `lucide-react`. shadcn
primitives (`button`, `input`, `label`, `alert`, `sheet`, `dialog`,
`dropdown-menu`, `tabs`) — `sheet`, `dialog`, and `dropdown-menu`
have not been installed yet; this feature adds them via
`npx shadcn@latest add sheet dialog dropdown-menu` per Constitution
Principle I (no second component library).

**Storage**: Supabase Postgres. **One migration**
(`supabase/migrations/0004_user_onboarding.sql`) extends `public.staff`
with the lifecycle, invite, and offboard fields enumerated in
[data-model.md](./data-model.md) § 1, plus the
`staff_anon_counter` sequence for the hard-remove placeholder name.
No new tables. The `audit_log.action` TypeScript union in
`lib/auth/audit.ts` gains the seven `user.*` event types
(FR-070) and `deriveEntityType` learns the `"user"` prefix; the DB
column is unconstrained text so no migration is needed for the union
extension. Existing `staff_assert_owner_present_trg` (introduced in
0002) is reused as the server-side backstop for last-owner protection
(FR-044, FR-053, edge case "Last owner protection").

**Testing**: Vitest (unit) at:
`tests/unit/auth/role-permissions.test.ts` (the shared FR-080 module);
`tests/unit/settings/onboarding/actions.test.ts` (every server action's
validation, permission, audit, and error branches);
`tests/unit/settings/onboarding/anon-counter.test.ts` (the
sequence-backed `Former staff #N` generator). Playwright (e2e) at
`tests/e2e/onboarding.spec.ts` covers all seven user stories (US1
Quick onboard, US2 Thorough onboard incl. PIN-mismatch loop, US3
soft offboard, US4 hard remove gates, US5 pending-invite actions,
US6 reactivate, US7 search). The invite-method e2e leg reuses the
existing local-Supabase Inbucket SMTP capture (set up by `003-login-flow`
for magic-link, extended by `010-login-redesign` for recovery) — both
templates (`invite` and `magiclink`) land in the same Inbucket inbox.
The `/reset-password?type=invite` leg is covered both in unit
(action signature + audit payload) and in e2e (full email round-trip
for US2 password-method invite).

**Target Platform**: Web (modern evergreen browsers). The Onboarding
page is owner-only and primarily used from a desktop or counter laptop;
the prototype's three-section list and three sheets degrade cleanly to
a 360 px single column (SC-005) — verified via Playwright's
`setViewportSize`.

**Project Type**: Next.js App Router web application (single repo
root). No structural change.

**Performance Goals**: Quick-mode invite end-to-end (page open → invite
sent toast) completes **under 30 seconds on a cold start** (SC-001);
the server action itself completes **under 800 ms p95** including the
admin-API call to Supabase (one `admin.generateLink` for magic-link or
one `admin.inviteUserByEmail` for password method). Soft offboard takes
effect **within 5 seconds** (SC-003) — measured from the action's
`redirect()` to the offboarded user's next authenticated request
failing; achieved by `supabase.auth.admin.signOut(user_id, 'global')`
which invalidates every refresh token immediately. Audit-log entries
visible to other owner sessions **within 1 second** (SC-007) — already
true with the existing `recordAudit` synchronous write.

**Constraints**: Free-tier Supabase (memory: `project_supabase_dual_project`)
— no new paid features. `admin.inviteUserByEmail`, `admin.generateLink`,
and `admin.deleteUser` are all in free tier. **No new env vars** (the
service-role key is already present per `lib/db/admin.ts`). All copy +
visuals trace to Lacquer tokens; `speckit-design-auditor` MUST pass
with zero violations. No new test infrastructure beyond the existing
local-Supabase + Inbucket stack.

**Scale/Scope**: Single salon, 5–25 staff over the product's lifetime.
The Onboarding page is the lowest-traffic surface in the app — single-digit
visits per week. No pagination, no virtualization, no realtime channel
needed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Compliance | Evidence |
|---|---|---|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | Pass | Page + three sheets + PIN modal all adapt `design-system/prototypes/onboarding/{Onboarding,OnboardSheet,OffboardSheet,RemoveSheet,PinModal}.jsx` verbatim (prototype README § "How this maps to spec 012"). All colors/spacing/radii/shadows resolve to tokens in `styles/tokens.css` (prototype CSS already uses `var(--…)`). Icons are Lucide only (prototype's `UM.*` aliases map 1:1). Components compose shadcn primitives from `components/ui/*`; new project-specific components land in `components/lacquer/onboarding/*`. `speckit-design-auditor` MUST pass with zero violations before any UI task is claimed complete (per CLAUDE.md "When you change UI"). |
| **II. Server-Authoritative Architecture** | Pass | All eight server actions enforce the owner role first (defense in depth on top of the page-level redirect from non-owners — FR-002). All Supabase admin API calls (`inviteUserByEmail`, `generateLink`, `deleteUser`, `signOut`, `updateUser`) happen server-side via the existing `createSupabaseServiceRoleClient()` (`lib/db/admin.ts`); the service-role key never reaches the client bundle (memory: same constraint already enforced for `recordAudit`). The page itself is an RSC; client islands are limited to the three sheets, the row menus, and the search input. Email-already-exists checks, last-owner guards, and stale-state checks all live in the action. RLS continues to deny direct writes to `staff` and `audit_log` from the `authenticated` role. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | Pass | Every mutation writes exactly one audit row before the action returns (`user.invited`, `user.invite_resent`, `user.invite_cancelled`, `user.offboarded`, `user.reactivated`, `user.removed`, `user.pin_reset`, `device.password_reset`). Each carries `by` (acting owner's user_id), `subject` (target user_id or, for `user.removed`, a snapshot of prior display_name + email), and any action-specific metadata (`reason` for offboard, `method` for invite). Audit row is `await`ed before `redirect()` per the shared prelude — matches the 010 `updatePassword` pattern. No money flow touched. |
| **IV. Test-First for Critical Paths** | Pass | Onboarding gates email-login access to the entire app — it is an auth-critical path. Vitest unit tests cover every server action's validation + permission + audit + error branches (`tests/unit/settings/onboarding/actions.test.ts`) and the shared role-permissions module (FR-080). Playwright e2e covers all seven user stories end-to-end against the local Supabase, including the invite-email round-trip via Inbucket. Tests ship in the same PR (constitution review gate). For US2's password-method invite the e2e additionally proves the `/reset-password?type=invite` leg works against the existing reset flow. |
| **V. Scope Discipline & Cost Restraint** | Pass | No new dependencies beyond three shadcn primitive installs (`sheet`, `dialog`, `dropdown-menu`) — all from the existing shadcn registry, no new component library. No new env vars. No new paid Supabase features. One schema migration that extends an existing table (no new tables). The page is owner-only — managers and below see no UI surface at all (FR-002). Self-signup, SSO/SCIM, bulk import, custom invite email templates, audit-log UI, and per-feature permission tweaks are all out of scope (not requested). The `pin_reset_admin_at` notice on `/select-staff` is a 1-column read + a single-line UI banner — within the spirit of "the simplest mechanism that satisfies the design doc". |

**Result**: All five principles pass. **No Complexity Tracking
entries required.**

Re-checked after Phase 1 design — still passes. The largest design
choice (pre-create the auth user + staff row at invite time, both
keyed by `staff.user_id = auth.users.id`) is the simplest mapping
onto the existing `staff_user_id_unique` partial index; no new
abstraction surfaces.

## Project Structure

### Documentation (this feature)

```text
specs/012-user-onboarding/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (schema extension + invariants)
├── quickstart.md        # Phase 1 output (dev + operator setup)
├── contracts/
│   ├── README.md
│   ├── server-actions.contract.md   # Eight actions + shared prelude
│   ├── routes.contract.md           # /settings/onboarding + /reset-password?type=invite
│   ├── audit.contract.md            # Seven new event types
│   ├── permissions.contract.md      # FR-080 single source of truth
│   └── ui-views.contract.md         # Page sections + sheet states
├── checklists/
│   └── requirements.md  # Already created by /speckit-specify (existed prior to this plan)
└── tasks.md             # Generated by /speckit-tasks (next command)
```

### Source Code (repository root, worktree-relative)

```text
app/(studio)/settings/
├── layout.tsx                                # Untouched — restricted children gate themselves
└── onboarding/                               # NEW
    ├── page.tsx                              # NEW: RSC — owner gate + 3-section fetch + render
    ├── actions.ts                            # NEW: 8 server actions
    ├── _types.ts                             # NEW: OnboardingUser, OnboardingSection
    ├── _validation.ts                        # NEW: validateEmail, validateRole, validateReason
    └── _sort.ts                              # NEW: section split + role-order sort

app/(auth)/
├── reset-password/
│   ├── page.tsx                              # MODIFY: read ?type=invite, swap copy
│   └── actions.ts                            # MODIFY: forward method=invite to audit payload
└── (login, layout, select-staff)             # Untouched

app/auth/callback/route.ts                    # MODIFY: add type=invite branch (mirrors recovery)

components/lacquer/
├── settings/
│   └── tab-bar.tsx                           # MODIFY: insert Onboarding between Staff + Notifications
├── onboarding/                               # NEW
│   ├── onboarding-page.client.tsx            # NEW: small client island (search input + sheet state)
│   ├── user-row.tsx                          # NEW: server-rendered row (avatar + meta + menu)
│   ├── user-row-menu.client.tsx              # NEW: client menu (Resend, Cancel, Offboard, Remove, etc.)
│   ├── onboard-sheet.client.tsx              # NEW: Quick + Thorough modes (adapts OnboardSheet.jsx)
│   ├── offboard-sheet.client.tsx             # NEW: soft offboard sheet (adapts OffboardSheet.jsx)
│   ├── remove-sheet.client.tsx               # NEW: hard remove sheet w/ two acks + typed-name
│   ├── reset-pin-modal.client.tsx            # NEW: thin wrapper around existing PinKeypad
│   ├── email-preview.tsx                     # NEW: server-rendered preview pane for Thorough step 2
│   ├── role-tile-picker.tsx                  # NEW: 4-tile role picker for Thorough step 1
│   ├── permission-card.tsx                   # NEW: server-rendered role-permissions card
│   ├── onboarding-toaster.client.tsx         # NEW: URL → Sonner toast bridge (matches staff-toaster pattern)
│   └── section.tsx                           # NEW: server-rendered section wrapper (head + rows + empty)
└── staff/                                    # Reused (initials, change-pin-modal, staff-avatar)

lib/auth/
├── audit.ts                                  # MODIFY: 7 new AuditAction members + 'user' entity type
└── role-permissions.ts                       # NEW: single source of truth for FR-080
                                              #   (per-role grants[] + blocks[] + summary + label)

lib/onboarding/
├── invite.ts                                 # NEW: thin wrappers over supabase.auth.admin.*
│                                              #   (generateMagicLinkInvite, sendPasswordInvite, deleteInviteUser)
└── email-conflict.ts                         # NEW: pre-invite uniqueness check across all 3 states

styles/
└── onboarding.css                            # NEW: page + sheet + row styles (adapted from prototype's onboarding.css)
                                              #   No new tokens — every value resolves to styles/tokens.css

supabase/migrations/
└── 0004_user_onboarding.sql                  # NEW: staff.state + invite/offboard metadata,
                                              #   staff_anon_counter sequence, pin_reset_admin_at,
                                              #   (no RLS changes — service-role writes only)

design-system/prototypes/onboarding/          # Vendored prototype (already in place)
├── User Onboarding.html
├── Onboarding.jsx
├── OnboardSheet.jsx
├── OffboardSheet.jsx
├── RemoveSheet.jsx
├── PinModal.jsx
├── Components.jsx
├── data.jsx
├── onboarding.css
└── README.md

tests/
├── e2e/
│   ├── onboarding.spec.ts                    # NEW: full coverage of US1–US7
│   └── auth.spec.ts                          # MODIFY: extend with /reset-password?type=invite path
└── unit/
    ├── auth/
    │   └── role-permissions.test.ts          # NEW: per-role grants/blocks shape + FR-080 stability
    └── settings/
        └── onboarding/
            ├── actions.test.ts               # NEW: every action × every branch
            ├── anon-counter.test.ts          # NEW: sequence-backed Former staff #N generator
            └── email-conflict.test.ts        # NEW: invited/active/offboarded/removed conflict matrix
```

**Structure Decision**: No structural change — extends the existing
Next.js App Router layout. The Onboarding page slots in next to
`app/(studio)/settings/staff/` and uses the identical action-file
pattern (shared prelude → validate → load → matrix → mutate → audit →
revalidate + redirect with `?toast=` / `?error=`). Sheet client
components and the page-level search/sheet state are the only new
client islands; everything else stays server-side per Principle II.
The shared `lib/auth/role-permissions.ts` module avoids the trap of
two parallel role-permission definitions (one in the wizard, one in
Staff) drifting apart.

## Complexity Tracking

> Constitution Check passed with no violations. **This section is
> intentionally empty.**

No alternative to a dedicated `state` column on `staff` was considered —
the existing `active` boolean cannot represent the
`invited`/`active`/`offboarded` trichotomy without semantic overload, and
the spec's Key Entities section explicitly enumerates the three states.
No alternative to the prototype's sheet structure was considered because
the prototype is the visual source of truth per Principle I.
