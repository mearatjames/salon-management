# Phase 0 Research — Select staff redesign

All NEEDS CLARIFICATION items resolved. Each decision below is the input to Phase 1.

---

## R1 — Escaping the `(auth)` two-panel shell for `/select-staff` only

**Decision**: Move `app/(auth)/select-staff/` into a new `app/(device)/` route group
with its own `app/(device)/layout.tsx`.

**Rationale**: `app/(auth)/layout.tsx` wraps every child route in `<AuthShell>` (the
fixed `1fr 480px` brand + form panels). FR-003 and the spec's Assumptions require
`/select-staff` to use the full viewport with no brand panel, while `/login` and
`/reset-password` keep it. A Next.js route group exists precisely to attach a different
layout to a subset of routes; it does not add a URL segment, so `/select-staff` stays
`/select-staff` and every `proxy.ts` matcher / `switchStaff` redirect that names that
path keeps working untouched.

**Alternatives considered**:
- *Conditional rendering inside `AuthShell`* — `AuthShell` is a server component and has
  no direct access to the pathname; threading it via a `proxy.ts`-set header is hacky and
  couples the shell to route knowledge. Rejected.
- *Nested `select-staff/layout.tsx`* — a nested layout **nests inside** the `(auth)`
  layout rather than replacing it, so the brand panel would still render. Rejected.

---

## R2 — Modal primitive

**Decision**: Use the shadcn `Dialog` primitive (`components/ui/dialog.tsx`, Radix).

**Rationale**: Constitution I mandates shadcn primitives composed into
`components/lacquer/*` — no second component library. Radix `Dialog` delivers FR-018 in
full for free: backdrop click-to-dismiss, `Escape`-to-dismiss, an explicit close button,
focus trapping, and `aria-modal` semantics. `DialogOverlay` already paints a dimmed,
blurred backdrop. The Option D prototype hand-rolls all of this with inline styles; the
production build delegates to the primitive and re-skins it with tokens.

**Alternatives considered**: Hand-rolled `position:absolute` overlay (as in the
prototype) — re-implements focus trap and dismissal, more code, less accessible.
Rejected.

---

## R3 — Keeping the modal open after a wrong PIN (FR-017)

**Decision**: Change `submitPin` so a **failed** attempt `return`s a discriminated
result `{ ok: false }` instead of calling `redirect()`. The **success** path is
unchanged — it sets the operator cookie and `redirect()`s to the sanitized `next`.
Return type becomes `Promise<{ ok: false }>` (success never resolves — it throws the
Next redirect).

**Rationale**: Today both failure branches (`invalid_target`, `mismatch`) call
`redirect("/select-staff?error=pin_failed&next=…")`. A redirect is a full navigation —
it tears down the client modal state, so the modal cannot "stay open for an immediate
retry." Returning a value lets the client keypad keep the modal mounted, paint the error
state on the 4-dot indicator, clear the buffer, and accept the next attempt. This does
**not** violate FR-024: PIN length, verification rules, no-throttle/no-lockout policy,
and the operator session are all unchanged — only the *transport of a failure signal*
changes. `recordAuth("staff.pin_failed", …)` stays on both failure branches, still
`await`ed before the return (FR-020, SC-007).

Consequences: the page-level `?error=pin_failed` query param and the top-of-page
`<Alert>` are removed — the error now lives inside the modal. The expired-device-session
branch keeps its `redirect("/login?next=…")` (that is a correct navigation, not a PIN
failure).

**Invocation pattern**: the keypad calls `submitPin` imperatively from its `onSubmit`
callback inside `startTransition`. On a resolved `{ ok: false }` it sets an
`errorMessage`; on success the action throws `NEXT_REDIRECT` and the Next client runtime
performs the navigation (the modal unmounts naturally).

**Alternatives considered**:
- `useActionState(submitPin, …)` — canonical for `<form action>` bindings, but the
  keypad is callback-driven (not a form submit), so the `(prevState, formData)` signature
  adds churn for no gain. The imperative call is simpler. Rejected as the primary
  pattern (still acceptable if the implementer prefers it — equivalent behavior).
- Keep the redirect, re-open the modal from a URL param on the re-rendered page —
  reintroduces URL-driven modal state the redesign is explicitly removing, and flashes
  the roster between attempts. Rejected.

---

## R4 — Keypad component (0–9 + Clear + Backspace)

**Decision**: Build a new `components/lacquer/select-staff/pin-pad.tsx` — a 12-key
(3×4) callback-based keypad: digits 1–9, then `Clear` / `0` / `Backspace`.

**Rationale**: FR-013 requires digits **and** a clear control **and** a backspace
control. The two existing keypads each have only one of the two:
- `components/lacquer/pin-keypad.tsx` — 11 keys (1–9, 0, Clear); form-posting; being
  removed with this redesign.
- `components/lacquer/numeric-keypad.client.tsx` — 11 keys (1–9, 0, Backspace); shared
  by the staff Add-wizard and Change-PIN modal. Adding Clear here would change a
  component two unrelated surfaces depend on.

A dedicated `pin-pad.tsx` keeps the shared `numeric-keypad` untouched and matches the
Option D prototype's `Keypad` exactly. It is callback-based (`onDigit` / `onClear` /
`onBackspace`), owns no form, imports no Server Action — the modal owns submission.

**Keyboard input (FR-014)**: a `window` `keydown` listener (mounted only while the modal
is open) handles digit keys and `Backspace`. `Escape` is **not** bound by the keypad —
it is left to Radix `Dialog`, which closes the modal (FR-018 "pressing escape … closes
the modal"). On-screen `Clear` covers buffer-clear; there is no standard physical
"clear" key, so `Escape`-as-cancel satisfies FR-014's "a key to clear or cancel."

**Repeated-identical-error reset**: the keypad buffer must clear after every failed
attempt, including two identical wrong PINs in a row. The modal increments an
attempt counter and passes it as the `key` of the keypad (or as part of the error
identity) so the keypad remounts/resets deterministically on each failure rather than
relying on an error-string change.

---

## R5 — Search

**Decision**: A controlled `<input>` whose value drives a synchronous `useMemo` filter
over the in-memory roster — case-insensitive, partial, **display name only** (not role
labels, per spec Assumptions). No debounce, no separate submit, no server round-trip.

**Rationale**: The roster is at most ~25 rows and is already fully loaded into the
client screen as a prop. Filtering 25 strings per keystroke is sub-millisecond, so a
debounce would only add latency against SC-004 ("immediately as each character is
typed"). FR-009 forbids a submit step. The empty-result message names the typed text
(FR-010).

---

## R6 — Transient modal state; dropping URL parameters

**Decision**: The selected-staff / modal-open state is client `useState` in
`select-staff-screen.client.tsx`. The `?selectedTileId=` and `?error=` URL parameters
are removed. Only `?next=` is still read (by the RSC page, to thread the post-sign-in
destination). A page refresh closes the modal because client state resets on reload —
satisfying the spec edge case "page refresh during entry returns to the roster grid."

**`switchStaff` interaction**: `app/(studio)/actions.ts` `switchStaff` redirects to
`/select-staff?next=…&selectedTileId=<previousOperator>`. The redesigned page simply
does not read `selectedTileId`, so the parameter becomes an inert no-op. Removing it
from `switchStaff` is out of scope (it would re-touch a studio action and its tests for
no behavior change); it is left in place and ignored.

---

## R7 — Scroll behavior for a large roster (FR-006)

**Decision**: Lay the screen out as a flex column: a fixed header (wordmark + sign
out), a fixed `ScreenHeader` + search field, then the avatar grid as the single
`flex: 1; overflow-y: auto` region. Only the grid scrolls; the header and search field
stay visible.

**Rationale**: FR-006 explicitly requires the header and search field to "remain
visible" when the grid overflows. The Option D prototype puts header + search + grid all
inside one `overflow-y: auto` section, so everything scrolls together. Pinning the
header/search is a small, deliberate refinement of the prototype to satisfy FR-006 —
documented here so the design audit does not flag it as drift.

---

## R8 — Avatar rendering

**Decision**: A small token-driven initials avatar local to the select-staff component
set — soft-tint background `oklch(from var(<color_token>) l c h / 0.15)` with the token
color as the foreground, matching the idiom already in `staff-tile.tsx`. Sizes: ~56px on
the grid tile, ~80px in the modal.

**Rationale**: `staff.color_token` values (`--avatar-rose`, …) are already defined in
`styles/tokens.css` and consumed by `staff-tile.tsx` and `tech-avatar.tsx`.
`TechAvatar` is typed against the dashboard's `Technician` aggregate shape — reusing it
here would couple the auth surface to an unrelated read model. A tiny local avatar keeps
the dependency graph clean and stays fully token-driven (FR-026).

---

## R9 — Prototype vendoring (FR-028)

**Decision**: `design-system/prototypes/select-staff/` already exists (vendored during
`/speckit-specify`) and contains the Option D bundle — `select-staff-variants.jsx`
(with `VariantAvatarGrid` = Option D), `Select Staff Redesign.html`, `design-canvas.jsx`,
`colors_and_type.css`. Phase 1/2 tasks verify the bundle is complete and add a
prototype→surface mapping line to `docs/system-design.md` § "Reuse from the design
system handoff":

```
prototypes/select-staff/select-staff-variants.jsx (VariantAvatarGrid / Option D)
  → app/(device)/select-staff/page.tsx
```

**Rationale**: FR-028 requires the Option D bundle to be vendored so future UI work can
reference the canonical layout; the handoff mapping in `docs/system-design.md` is where
every other prototype→surface pair is recorded.

---

## R10 — Dead code removed by the redesign

**Decision**: After the redesign, delete `components/lacquer/staff-roster.tsx`,
`components/lacquer/staff-tile.tsx`, `components/lacquer/pin-keypad.tsx`, and the
select-staff-only rule block in `styles/auth.css` (`.auth-roster`, `.auth-keypad*`,
`.auth-staff-tile`, `.auth-headline`, `.auth-form-row`, `.auth-form-actions`).

**Rationale**: A grep confirms these three components are imported **only** by the old
`app/(auth)/select-staff/page.tsx` (the `PinKeypad*` matches under `settings/staff/` are
an unrelated reducer type). The named `auth.css` classes are likewise referenced only by
the old select-staff page — `/login` and `/reset-password` use the `.auth-form-*` /
`.auth-view-*` families instead. Leaving them would be dead code; Constitution V
(scope discipline) favors removing it in the same change set.
