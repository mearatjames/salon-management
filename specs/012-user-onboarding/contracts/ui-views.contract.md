# UI Views Contract — User Onboarding

Page composition, sheet states, menu items, empty states. All visuals trace to the prototype at `design-system/prototypes/onboarding/`; this contract codifies what each surface does, not how it looks.

## Page composition

```text
┌────────────────────────────────────────────────────────────────────┐
│ Settings tab bar: [General] [Staff] [Onboarding★] [Notif] [Billing]│
└────────────────────────────────────────────────────────────────────┘
┌──── Settings → Onboarding ─────────────────────────────────────────┐
│                                                                    │
│  ┌── Hero ─────────────────────────────────────────────────────┐  │
│  │ Onboarding                  [🔍 search...]  [+ Onboard user]│  │
│  │ Invite, manage, offboard email-login users.                 │  │
│  │ Day-to-day staff edits live in Staff →                      │  │
│  │                                                              │  │
│  │ {active}  {pending}  {offboarded}                            │  │
│  │  Active    Pending   Offboarded                              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌── Owners-only notice ──────────────────────────────────────┐   │
│  │ ⓘ Owners only. Onboarding and offboarding are restricted…   │   │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌── Pending invites (N) ─────────────────────────────────────┐   │
│  │ Invitations sent but not yet accepted                        │   │
│  │ [row] [row] [row]    or  "No pending invites…" empty state   │   │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌── Active accounts (N) ─────────────────────────────────────┐   │
│  │ People with email login access                               │   │
│  │ [row] [row] [row]                                            │   │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌── Offboarded (N) ──────────────────────────────────────────┐   │
│  │ Login revoked. Reactivate to send a fresh invite…            │   │
│  │ [row] or hidden when empty + no active search query          │   │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### Hero stats

The three counts are computed server-side from the unfiltered roster (i.e. they always show the salon-wide totals, not the search-filtered totals). The number color hints follow the prototype:

| Stat | Color when 0 | Color when > 0 |
|---|---|---|
| Active | `var(--foreground)` | `var(--foreground)` |
| Pending | `var(--foreground)` | `oklch(0.55 0.13 75)` (amber accent — invites need attention) |
| Offboarded | `var(--muted-foreground)` | `var(--muted-foreground)` (muted; not actionable) |

### Owners-only notice

Static text block under the hero. Always visible on this page (the page is owners-only, but the notice clarifies the boundary with Staff for any owner who lands here expecting day-to-day edits).

### Section visibility

| Section | Always visible? | Empty-state copy |
|---|---|---|
| Pending invites | Yes | "No pending invites. Onboard someone to get started." |
| Active accounts | Yes | "No active accounts yet." (never realistic — the viewing owner is always active) |
| Offboarded | Hidden when count = 0 AND no `?q=` search; visible with empty row when `?q=` is active | "No offboarded users." |

## Row composition

Each row has 5 horizontal cells (collapsing to 2 rows at < 720 px):

| Cell | Content |
|---|---|
| Person | Avatar (28 px, role color, initials) + display_name (with `You` tag if `target.user_id === viewer.deviceUserId`) + email |
| Role chip | Color dot + role label (from `ROLE_PERMISSIONS[role].label`) |
| Status | Pill badge with state-colored dot — `Invited` (amber), `Active` (green), `Offboarded` (gray) |
| Metadata | Bucket-specific contextual text (see below) |
| Actions | Per-bucket icon buttons + ⋯ menu |

### Bucket-specific metadata

- **Pending**: "Invited {relative time}" using the `lib/time/*` helper against `SALON_TZ` (rounded to today/yesterday/N days ago). Source: `staff.invited_at`.
- **Active**: "Last sign-in {relative time}" using same helper. Source: `staff.last_sign_in_at` (null → "Never signed in").
- **Offboarded**: "Offboarded {relative time}{reason ? ' · ' + reason : ''}". Source: `staff.offboarded_at` + `staff.offboard_reason`.

### Bucket-specific action area

| Bucket | Inline icons | Menu items |
|---|---|---|
| Pending | 🔄 Resend, 🔗 Copy link | Resend invite · Copy invite link · ──── · Cancel invite (destructive) |
| Active | (none — only ⋯) | Edit in Staff · Reset PIN · Send password reset · ──── · Offboard {first}… (destructive) OR self-line "You can't offboard yourself. Another owner has to do it." |
| Offboarded | (none — only ⋯) | Reactivate (resend invite) · ──── · Remove permanently… (destructive) |

"Edit in Staff" navigates to `/settings/staff?selected=<id>` (existing route, existing functionality).

"Copy invite link" calls `navigator.clipboard.writeText(<link>)` where `<link>` is the URL last produced by the Supabase admin call. We persist the **last issued** URL on a transient client-side cache populated at row render time via a thin server action `getInviteLink(staff_id)` that calls `admin.generateLink` and returns the link without rotating (using `type: 'magiclink' | 'invite'` + `options: { shouldCreateUser: false }`). Note: Supabase rotates the link on every `generateLink` call by design, so "Copy link" implicitly invalidates the prior link too. UX caveat noted in `quickstart.md`.

## Sheet states

Three right-side sheets + one centered dialog. All open from a click on a row action or the hero CTA.

### Onboard sheet

**Two modes**: Quick (default) and Thorough. Mode pill in the sheet header toggles between them without losing already-entered Identity fields.

#### Quick mode (single screen)

Three fields: full name, work email, role (4-tile picker). One primary `Send invite` button (gated on name ≥ 2 chars + valid email). One info hint at the bottom: "Quick mode sends a magic-link invite and defers PIN + avatar. Need to set those now? Switch to Thorough above."

PIN and avatar color default to NULL and a system-assigned color (next color from `STAFF_COLORS` not already used by an active staff member; falls back to the first color when all are in use).

#### Thorough mode (4 steps)

Step bar at top: Identity · Invite · PIN · Review. Back/Continue footer. Continue gated per step:

- **Step 1 (Identity)** — full name (text), role (4-tile picker), avatar color (8-swatch). Continue gated on name ≥ 2.
- **Step 2 (Invite)** — work email (text), invite method (2 tiles: Magic link / Set up a password), live email preview (renders subject, From, To, intro, CTA, validity-window footer; updates as `name` / `email` / `method` changes). Continue gated on valid email.
- **Step 3 (PIN)** — inline 4-digit keypad (two-pass: enter → enter again). On mismatch, dots flash error state, both entries clear, the wizard returns to first-entry with "PINs didn't match. Try again." A "Skip — they can set it on first login" button is always visible.
- **Step 4 (Review)** — Person · Role · Email · Invite method · Login PIN (set / will set on first login) summary, plus a Permissions card (label, summary, grants list, blocks list — see `permissions.contract.md`).

Footer's `Send invite` replaces Continue on step 4. Submit → server action `inviteUser` with `mode='thorough'`.

#### Success state (both modes)

Replaces the sheet body with a centered success splash: icon, "Invite sent" heading, "{first} should receive an email at {email} within a minute. They'll show up under Pending invites until they accept." Then a small card with the avatar + role + invite method. Footer has two actions: "Copy invite link" (writes to clipboard) and "Done" (closes the sheet).

The page below the sheet has already been revalidated (the server action fires `revalidatePath` before redirecting); the new pending row is visible immediately when the sheet closes.

### Offboard sheet (soft)

Header: "Offboard {full name}" + person card (avatar, name, role, email, Active badge).

Body sections:
1. **What happens** — checklist with 4 items: Email login revoked · Hidden from login picker · History stays · Reversible.
2. **Reason (optional)** — chip group with 5 reasons (Left the salon, On extended leave, Role change, Performance, Other). Selecting a chip writes to the form's `reason` field. Optional — empty submission is valid.

Footer: `Cancel` + destructive `Offboard {first name}` button (always enabled — confirmation is the act of submitting the dedicated sheet).

Last-owner edge: if pre-flight count says target is the last active owner, the destructive button is disabled and an inline alert at the top of the sheet reads "Promote another owner first."

### Remove sheet (hard)

Header has a tinted destructive band (background `oklch(0.97 0.025 25)`-ish in the prototype, mapped to `var(--destructive-bg)` token if exists, else inline-resolved via prototype CSS variables).

Body sections:
1. **Person card** — same shape as Offboard sheet.
2. **What happens** — "Auth account deleted forever · Past tickets stay (attributed to anonymized placeholder) · Email frees up for reuse · Cannot be undone".
3. **Two acknowledgement checkboxes** —
   - "I understand past tickets will be attributed to an anonymized 'Former staff #N' placeholder."
   - "I understand this can't be undone."
4. **Typed-name confirmation** — input labeled "Type {display_name} to confirm". Compared case-insensitively to the row's `display_name` (trim both sides).

Destructive button label: `Permanently remove`. Disabled until all three gates pass.

Last-owner edge: same as Offboard.

### Reset PIN modal

Centered dialog (not a side sheet). Body: same two-pass 4-digit keypad as the Thorough wizard's step 3, with the heading "Reset PIN for {first}". Footer: `Cancel` + `Save PIN` (gated on two matching 4-digit entries). On submit → server action `resetUserPin`. On success → toast "{name}'s PIN reset. They'll be notified on next sign-in."

## Search

Single input in the hero. URL-synced via `?q=` (client-side debounced 250 ms, server-rendered on each new value). Filters all three sections by `display_name ILIKE '%q%' OR email ILIKE '%q%'`. When `?q=` is active AND a section's filtered count is 0, the section is hidden entirely (matches FR-007 AC: "section header is hidden entirely whereas without a query, the header shows with a 'No offboarded users' empty row").

## Toasts

URL → Sonner bridge in `OnboardingToaster.client.tsx` (matches `StaffToaster` pattern from 006):

| `?toast=` | Sonner copy | Tone |
|---|---|---|
| `invited` | "Invite sent to {name}" | success |
| `resent` | "Invite resent" | success |
| `cancelled` | "Invite to {name} cancelled" | neutral |
| `offboarded` | "{name} offboarded" | neutral |
| `reactivated` | "Reactivation invite sent to {name}" | success |
| `removed` | "{name} permanently removed" | destructive |
| `pin_reset` | "{name}'s PIN reset. They'll be notified on next sign-in." | success |
| `password_reset_sent` | "Password-reset email sent to {name}" | success |

Toast fires once on mount; `router.replace` strips `?toast=` + `?name=` from the URL so a page refresh doesn't re-fire.

## Responsive layout

Desktop (≥ 1024 px): hero + 3 sections in single column. Rows are 5-cell horizontal.

Tablet (720 px – 1023 px): same layout; rows compress with smaller paddings.

Mobile (360 px – 719 px): rows wrap into 2 stacked layers per row (person + role on top; status + metadata + actions on bottom). Sheets become full-screen (sheet width = 100 vw, max width = 480 px). The hero stats wrap to a 3-up grid below the title.

## Keyboard + a11y

- All buttons reachable via Tab; Esc closes any open sheet or menu.
- The Onboard, Offboard, and Remove sheets trap focus while open (shadcn `sheet` primitive handles this).
- The Reset PIN modal traps focus and returns focus to the triggering ⋯ button on close (shadcn `dialog`).
- Status badges have `role="status"`; the success state in the Onboard sheet has `aria-live="polite"` so screen readers announce "Invite sent" without a layout change.
- Color is never the sole signal — every status badge has both a colored dot AND text; every avatar has both color AND initials.

## Out of scope

- No bulk invite (CSV import, multi-select). Single-row only.
- No invite preview for password method (the email preview in step 2 shows the recipient's view; no separate "preview the in-app reset form" step).
- No editing the invite (name/role/method) once sent — owner must Cancel + Re-invite.
- No audit-log UI (rows are written; surfacing them is a future feature).
- No SSO / SCIM / domain claim. Single-tenant, email-based invites only.
