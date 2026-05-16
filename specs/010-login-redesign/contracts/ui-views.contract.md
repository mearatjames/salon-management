# UI Views Contract — Login Redesign

This contract specifies the **five-view UI state machine** that
`/login` presents, the URL-to-view mapping that seeds the initial
render, the view-swap animation contract, and the
password-reveal toggle behaviour.

The visual source of truth is
[`design-system/prototypes/auth/Login Screen.html`](../../../design-system/prototypes/auth/Login%20Screen.html).
This document is the **wire-level + behavioural** contract that
sits alongside that visual reference.

## Views

| View id | When rendered | Has form | Has back button |
|---|---|---|---|
| `signin` | Default (no view-seeding query param) | yes | no |
| `forgot` | `?reset_intent=1` | yes (email only) | yes |
| `forgot-sent` | `?reset_sent=<email>` | no (confirm card) | yes |
| `magic` | `?magic_intent=1` | yes (email only) | yes |
| `magic-sent` | `?magic_sent=<email>` | no (confirm card) | yes |

The five view components live in `components/lacquer/auth-views.tsx`
as named exports:

- `<SignInView next={...} error={...} />`
- `<ForgotView next={...} error={...} />`
- `<ForgotSentView email={...} next={...} />`
- `<MagicView next={...} error={...} />`
- `<MagicSentView email={...} next={...} />`

## URL → view precedence (read on every GET)

```ts
function resolveView(searchParams: URLSearchParams):
  | "signin" | "forgot" | "forgot-sent" | "magic" | "magic-sent"
{
  if (searchParams.has("reset_sent"))   return "forgot-sent";
  if (searchParams.has("reset_intent")) return "forgot";
  if (searchParams.has("magic_sent"))   return "magic-sent";
  if (searchParams.has("magic_intent")) return "magic";
  return "signin";
}
```

Documented in routes.contract.md § View selection precedence.
Implemented in `app/(auth)/login/page.tsx`.

## Allowed transitions

```
signin   → forgot         (click "Forgot password?")
signin   → magic          (click "Email me a sign-in link instead")
forgot   → forgot-sent    (submit valid email — server-driven)
forgot   → signin         (click "Back to sign in")
magic    → magic-sent     (submit valid email — server-driven)
magic    → signin         (click "Back to sign in")
forgot-sent → forgot      (click "send another link")
forgot-sent → signin      (click "Back to sign in")
magic-sent  → magic       (click "send another link")
magic-sent  → signin      (click "Back to sign in")
forgot   → magic          (NOT ALLOWED — return to signin first)
magic    → forgot         (NOT ALLOWED — return to signin first)
```

Disallowed transitions are not user-reachable from the rendered
UI; if they appear in the URL (manual editing) they resolve
naturally via the URL precedence above.

## View-swap mechanism

### No-JS path (server-driven, no animation)

Every navigation control is a real `<a href="?...">`:

- "Forgot password?" → `<a href="/login?reset_intent=1&next={...}">`
- "Email me a sign-in link instead" → `<a href="/login?magic_intent=1&next={...}">`
- "Back to sign in" → `<a href="/login?next={...}">`
- "send another link" (in `forgot-sent`) → `<a href="/login?reset_intent=1&next={...}">`
- "send another link" (in `magic-sent`) → `<a href="/login?magic_intent=1&next={...}">`

Submitting the form fields on `forgot` / `magic` is a normal
form POST to the corresponding Server Action which redirects to
the `*-sent` URL. The user sees a full page reload with no
animation.

### JS path (hydrated, animated)

On hydration, the client island `auth-views.tsx` wraps the
rendered view. It intercepts:

- Anchor clicks whose `href` starts with `/login?` (or is
  `/login` with no params) — `event.preventDefault()`, call
  `history.pushState`, update the `view` state, render the
  matching view component, fire the `viewIn` animation.
- Form submits on `forgot` / `magic` — these still post to the
  Server Action (no interception); the resulting page swap
  carries the URL change but the next render is a full page load.
  The animation does not run in this case. (Acceptable: it's a
  one-time confirmation; the user reads the email next, not the
  swap.)

### Animation contract (CSS-driven)

```css
@media (prefers-reduced-motion: no-preference) {
  .auth-view-pane {
    animation: viewIn var(--duration-base, 200ms) var(--ease-out-expo);
  }

  @keyframes viewIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
}
```

When the OS or user requests reduced motion, the `@media` block
short-circuits and `.auth-view-pane` carries no animation. The
view still swaps; it just appears instantly.

Verified by SC-007.

## Password-reveal toggle

Lives on:

- The `signin` view's password field.
- Both password fields on `/reset-password`'s new-password form.

NOT on:

- `forgot`, `magic` views (no password field).
- Confirmation views (`forgot-sent`, `magic-sent`).

### Behaviour

| State | `<input type>` | Button icon | `aria-label` |
|---|---|---|---|
| Default (hidden) | `"password"` | Lucide `Eye` 16px / 1.5px stroke / `--muted-foreground` | `"Show password"` |
| Toggled (revealed) | `"text"` | Lucide `EyeOff` same | `"Hide password"` |

### Toggle rules

1. Click or Enter on the toggle button flips state.
2. **Reset to hidden on view swap** (FR-012). Implementation:
   the `useState<boolean>` lives inside the view component, so
   it remounts on swap. No extra effect needed; React's
   key-based remount does the work.
3. Tab order: the toggle button is the next focusable element
   after the password input it adorns. Keyboard users naturally
   reach it via Tab.
4. **Autofill at first paint stays masked** (edge case). The
   initial state is `false`; the toggle only flips on user
   interaction. Browser-autofilled values are subject to the
   input's current `type`, which is `password`.

### Visual contract

The button is `position: absolute; right: 0;` inside an
`input-wrap` (the input's container). The input has
`padding-right: 40px` so its rendered text never overlaps the
icon. Hover changes the icon colour from `--muted-foreground`
to `--foreground` with a 150ms ease-out transition (Lacquer
hover token).

## Two-panel responsive shell

`auth-shell.tsx` renders:

```
┌─────────────────────────────────────┐
│  brand-panel (1fr)  │ form-panel    │
│                     │   (480px)     │
│  • LacquerMark      │               │
│  • "Tang Nails      │  ┌─────────┐  │
│     Studio"         │  │ form    │  │
│                     │  │  well   │  │
│  • deco SVG (TR)    │  │ (360px) │  │
│  • deco SVG (BR)    │  │         │  │
│  • tagline          │  │ ⟨view⟩  │  │
│  • sub-line         │  │         │  │
│                     │  └─────────┘  │
└─────────────────────────────────────┘
                       (viewports ≥ 720px)

┌─────────────────────────────────────┐
│  (brand panel hidden)               │
│                                     │
│   • LacquerMark + "Tang Nails       │
│      Studio"  (solo wordmark)       │
│                                     │
│   ┌──────────────────────────────┐  │
│   │   form well (full width)     │  │
│   │                              │  │
│   │   ⟨view⟩                     │  │
│   │                              │  │
│   └──────────────────────────────┘  │
│                                     │
└─────────────────────────────────────┘
                       (viewports < 720px)
```

### Breakpoint contract

| Viewport | Brand panel | Form panel | Solo wordmark |
|---|---|---|---|
| ≥ 720px | visible (1fr, full height) | 480px fixed | hidden |
| < 720px | `display: none` | full width, no left border | visible above the form well |

Implemented via media-query in `styles/auth.css` (research R10).
Verified by SC-002 (≥ 720px ± 4px tolerance against the
prototype) and SC-003 (< 720px across 320 / 480 / 719 widths).

## Brand panel content (server-rendered, static)

| Slot | Source | Notes |
|---|---|---|
| Top-left wordmark | `LacquerMark` SVG + "Tang Nails Studio" text | LacquerMark inlined in `components/lacquer/auth-brand-panel.tsx`; the inline SVG matches the prototype's path data verbatim. |
| Top-right deco | 380px LacquerMark SVG at 7.5% opacity | Pure decoration; `aria-hidden="true"`. |
| Bottom-right deco | 160px LacquerMark SVG at 4.5% opacity, rotated 18° | Pure decoration; `aria-hidden="true"`. |
| Bottom-left tagline | "Studio tools built for focused work." (verbatim) | Lacquer text-4xl, weight 600, leading-tight, tracking-tight. |
| Bottom-left sub | "Bookings, clients, payments, and staff scheduling — all in one quiet place." (verbatim) | Lacquer text-md, `--muted-foreground`. |

All values trace to Lacquer tokens. No client JS. No focus order
in the brand panel (decorative + non-interactive only) per FR's
"no element in the brand panel is keyboard-focusable" edge case.

## Accessibility contract

- Heading hierarchy: each view has exactly one `<h1>` (the view
  title — "Sign in" / "Reset password" / "Check your email" / etc.).
- Eye toggle: `<button type="button" aria-label="Show password">`
  / `"Hide password"`. Sufficient contrast against the field
  background (Lacquer `--muted-foreground` over `--background`).
- Reduced motion: every animation in this surface is gated by
  `@media (prefers-reduced-motion: no-preference)`.
- Form labels: every `<input>` has a programmatic
  `<label htmlFor="...">`.
- Error alerts: `<Alert role="alert">` (shadcn primitive) — the
  role is part of the existing primitive; we don't override it.
- Tab order across the new shell:
  - `signin` view: email → password → eye toggle → "Forgot
    password?" → Sign in → "Continue with Google" (when present)
    → "Email me a sign-in link instead".
  - `forgot` / `magic` views: back button → email → submit.
  - `forgot-sent` / `magic-sent` views: back button → "send
    another link".
  - `/reset-password`: new-password → reveal-1 → confirm →
    reveal-2 → submit.
  - Brand panel: not focusable.
