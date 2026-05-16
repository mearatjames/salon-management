# Prototype — User Onboarding & Offboarding

Source: Claude Design handoff bundle, file `User Onboarding.html` from project
`Lacquer Salon Design System`
(`https://api.anthropic.com/v1/design/h/sgLd4id9ddU2t5y3cnS01A`), fetched on
2026-05-16. Originating chat: `chats/chat16.md` — "Admin User Onboarding Flow".

## What's here

- `User Onboarding.html` — the canonical prototype host. Renders the
  Settings → Onboarding page inside the Lacquer Studio shell, with a tweaks
  panel that can open any of the three sheets directly.
- `Onboarding.jsx` — the Settings → Onboarding page itself. Hero with
  Active / Pending / Offboarded counts + the **Onboard user** CTA, an
  owners-only notice, and three stacked sections (`Pending invites`,
  `Active accounts`, `Offboarded`). Each row has its own action menu.
- `OnboardSheet.jsx` — right-side sheet to invite a new user. Two modes:
  - **Quick** — one screen (name + email + role). Sends a magic-link invite,
    defers PIN and avatar to first login.
  - **Thorough** — 4-step wizard: Identity → Invite → PIN → Review.
    "Invite method" picks magic-link vs. password-setup; a live email
    preview shows what the recipient will see.
- `OffboardSheet.jsx` — right-side sheet for the **soft, reversible**
  offboard. Calm and procedural: a what-happens checklist, optional reason
  chips, and a single confirm. Lands the user in the Offboarded list with
  reactivation available.
- `RemoveSheet.jsx` — right-side sheet for the **hard, irreversible**
  remove. Tinted destructive header, two acknowledgement checkboxes, and a
  typed-name confirmation. The destructive button stays disabled until both
  acks are checked and the typed name matches (case-insensitive).
- `Components.jsx` — shared UM (Lacquer Studio) chrome: sidebar, top bar,
  badges, avatar, Lucide-shape icons. Inlined for prototype isolation.
- `PinModal.jsx` — the standalone PIN modal used elsewhere; the
  OnboardSheet's PIN step uses the same look but inlined.
- `data.jsx` — mock roster (seven users across the three states),
  `ROLE_PERMISSIONS` (per-role grants + blocks), `OFFBOARD_REASONS`, and
  the eight-color staff palette in OKLCH.
- `onboarding.css` — the prototype's styles. Tokens come from
  `colors_and_type.css` (matches the live `styles/tokens.css`).
- `tweaks-panel.jsx` — design-canvas-only chrome (toggle Quick/Thorough
  default, open any of the three sheets for review). **Not** part of the
  implementation surface — kept here so the prototype HTML renders
  untouched if you open it in a browser.
- `lacquer-mark.svg` — the Lacquer logo mark, used by the prototype's
  sidebar. The real app reads its mark from `design-system/assets/`.

## How this maps to spec `012-user-onboarding`

The implementation adopts:

1. **A new Settings → Onboarding tab** distinct from Settings → Staff. Staff
   tab keeps day-to-day edits (schedule, services, PIN, color, name); the
   Onboarding tab owns the **lifecycle** — invite, offboard, remove.
2. **Owners-only access** at both the UI and the server-action level.
   Managers are deflected with a calm notice + a link to the Staff tab.
3. **The two-mode Onboard sheet** verbatim — Quick (single screen, magic
   link) for the 80% case, Thorough (4-step wizard) for the careful path.
4. **Both invite methods** — magic link and password-setup. Maps to
   Supabase Auth `inviteUserByEmail` and `generateLink({ type: 'invite' })`
   with the same email template hooks the 010 login redesign uses.
5. **Soft offboard** — ban the Supabase user, clear the PIN, hide from
   the login picker, preserve history. Status flips to `offboarded` in the
   staff/users table; the row moves to the Offboarded section.
6. **Hard remove** — delete the Supabase Auth user, anonymize the staff
   record (display_name → "Former staff #NNN", email → null), keep past
   tickets attributed to the placeholder. Two acks + typed-name match
   before the destructive button enables.
7. **Per-row actions** as in the prototype: pending → resend / copy
   link / cancel; active → reset PIN / send password reset / offboard;
   offboarded → reactivate (resend invite) / remove permanently.
8. **Self-offboard guard** — the current user's row in the Active section
   replaces the offboard menu item with the explanatory line "You can't
   offboard yourself. Another owner has to do it."

The audit-log surface from 010 is extended with the new event types:
`user.invited`, `user.invite_resent`, `user.invite_cancelled`,
`user.offboarded`, `user.reactivated`, `user.removed`. PIN reset and
password reset reuse the existing 010 events.

Tweaks panel (`tweaks-panel.jsx`) is design-canvas chrome only and is not
implemented.

When the design changes again, re-export the handoff zip and replace this
folder; the implementation reads `design-system/prototypes/onboarding/` as
the visual source of truth.
