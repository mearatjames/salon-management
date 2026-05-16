# Prototype — Auth (Login Screen)

Source: Claude Design handoff bundle, file `Login Screen.html` from project
`Lacquer Salon Design System`
(`https://api.anthropic.com/v1/design/h/0Y0sT4aT7el9l_9KsXD6Eg`), fetched on
2026-05-16.

## What's here

- `Login Screen.html` — the canonical prototype. Five views in one file:
  - `signin` — email/password + Google + magic-link link
  - `forgot` — "Reset password" email-only form
  - `forgot-sent` — "Check your email" confirmation
  - `magic` — "Sign in with a link" email-only form
  - `magic-sent` — "Check your email" confirmation
- `tweaks-panel.jsx` — design-canvas-only chrome (dark mode, hide brand
  panel, force error). Not part of the implementation surface — kept here
  so the prototype HTML renders untouched if you open it in a browser.

## How this maps to spec `010-login-redesign`

The redesign adopts the **two-panel shell** (brand panel + form panel,
collapsing to form-only at ≤720px), the **view-pane transition**, the
**password reveal toggle**, and the **dark-mode tokens** verbatim. It does
**not** add a separate password-reset email flow — the existing
`003-login-flow` FR-022 keeps password reset out of scope and magic-link
as the only recovery path, so the prototype's "Forgot password?" link is
rebound to the magic-link view in the implementation.

When the design changes again, re-export the handoff zip and replace this
folder; the implementation reads `design-system/prototypes/auth/` as the
visual source of truth.
