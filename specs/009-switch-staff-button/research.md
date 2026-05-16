# Phase 0 — Research: Switch Staff Standalone Top‑Nav Button

**Feature**: `009-switch-staff-button` · **Spec**: [spec.md](./spec.md) · **Date**: 2026-05-16

This file resolves every open question implied by the feature spec so that
Phase 1 design has no `NEEDS CLARIFICATION` markers left.

---

## R1. Authoritative source for the visual

- **Decision**: Use the "Option B — labeled button" variant from the `Switch Staff Nav` mockup as the visual contract. The mockup is part of the Lacquer salon design archive (the same archive vendored at `design-system/`).
- **Rationale**: Constitution Principle I (Design System Fidelity, NON‑NEGOTIABLE) — UI must adapt the matching prototype, not be redrawn. The mockup itself names the variant ("Option B — labeled button. Most discoverable. Label is always visible. Slightly more topbar width; best when techs switch frequently throughout the day."), and the user request explicitly cites it.
- **Alternatives considered**:
  - Option A (icon-only) — rejected: lower discoverability for new staff (US2), violates the spec's "label always visible" requirement.
  - Option C (split chip) — rejected: combines identity + action into one control; cleaner visually but the user request explicitly picks Option B.
- **Evidence**: extracted the mockup from the tarball returned by `https://api.anthropic.com/v1/design/h/LFbjq-EYCp7mAyhnCyRTyA?open_file=Switch+Staff+Nav.html`. The variant's CSS class is `.ghost-btn` in the mockup; geometry: `height: 32px`, `padding: 0 12px`, `gap: 6px`, `border-radius: var(--radius-md)`, `border: 1px solid var(--border)`, `color: var(--muted-foreground)`; hover swaps `background: var(--accent)`, `color: var(--foreground)`, `border-color: var(--ring)`.

## R2. Token-to-mockup mapping

The mockup uses generic Lacquer tokens; this repo's `styles/tokens.css` already exports them. Mapping for the new button + divider:

| Mockup value | Tang Nails token | Notes |
|--------------|------------------|-------|
| `height: 32px` | `var(--space-8)` (32px) | On‑scale (4/8/12/16/20/24/32/…). |
| `padding: 0 12px` | `0 var(--space-3)` | On‑scale. |
| `gap: 6px` | `var(--space-2)` (8px) | Round up to on‑scale; 6px would violate Principle I. The 2px difference is imperceptible at this size. |
| `border: 1px solid var(--border)` | unchanged | Existing token. |
| `border-radius: var(--radius-md)` | `var(--radius-md)` (8px) | Existing token; same value the prototype names. |
| `color: var(--muted-foreground)` → hover `var(--foreground)` | unchanged | Existing tokens. |
| `background: transparent` → hover `var(--accent)` | unchanged | Existing token. |
| Divider `1px × 20px, bg var(--border)` | `1px × var(--space-5)` | On‑scale; matches `var(--border)`. |
| Icon `<Repeat>` (lucide `repeat`) | unchanged | Already used today inside `operator-menu.tsx`. |
| Icon size `16`, stroke `1.5` | unchanged | Constitution Principle I. |
| Font: `var(--text-sm)`, `var(--font-sans)` | unchanged | Existing tokens; Inter. |

- **Decision**: write the button as a plain `<button>` styled inline (matching the existing `operator-chip.tsx` and `operator-menu.tsx` patterns), not as a shadcn `<Button variant="ghost">`.
- **Rationale**: the immediate neighbors in the topbar (operator chip, operator menu dropdown items) all use the same inline-style pattern. Introducing a shadcn `Button` here would create two ways to spell "ghost button in chrome" within twelve lines of JSX. Consistency with the established repo convention is preferred. Both still resolve to tokens, so Principle I is satisfied either way.
- **Alternatives considered**:
  - `<Button variant="ghost">` from shadcn — rejected for the inconsistency reason above.
  - A new CSS module class `.switch-staff-button` in `styles/studio.css` — viable, slightly cleaner; chosen as a small refinement (added as a regular class next to `.studio-topbar-sep`). See R4.

## R3. Placement and DOM order

- **Decision**: place the new button **inside** `.studio-topbar-right`, **before** the existing `<OperatorMenu><OperatorChip /></OperatorMenu>` block, with a `<span class="studio-topbar-sep" aria-hidden="true" />` between them.
- **Rationale**: `.studio-topbar-right` is the existing flex row (`display:flex; align-items:center; gap: var(--space-2)`) that already houses the chip. Inserting two siblings before the chip keeps the layout one-dimensional and inherits the topbar's spacing/baseline. The divider visually separates "action" from "identity" exactly as the mockup shows.
- **Alternatives considered**:
  - Putting the button in `.studio-topbar-center` next to the reconnecting banner — rejected: the center slot is reserved for status messaging (reconnecting banner); mixing actions in would clutter the connection-state surface.
  - Putting the button on the left next to the brand — rejected: the mockup places it on the right adjacent to the chip; right-side placement also matches the existing affordance the user is replacing.

## R4. CSS hygiene

- **Decision**: add two small additions to `styles/studio.css`:
  1. `.studio-topbar-sep` — 1px × `var(--space-5)`, `background: var(--border)`, `flex-shrink: 0`. Mirrors the mockup's `.topbar-sep`.
  2. `.studio-switch-staff` — the ghost button class, with all values from the R2 mapping table.
- **Rationale**: keeping styles in `studio.css` matches where the other topbar styles live; the file already contains `.studio-sidebar-toggle`, which is a structurally identical "ghost icon button" pattern. Co-locating the new class lets a reviewer compare both at a glance.
- **Alternatives considered**:
  - Inline `style={{...}}` on the JSX — viable and matches `operator-chip.tsx`. Rejected for the new class because the ghost button has a `:hover` and `:focus-visible` state that's awkward to write inline; a small class is the right tool.
  - A new file `styles/switch-staff-button.css` — rejected: too small to justify a file, and `styles/studio.css` is already imported by the studio layout.

## R5. Re-entry guard (FR-007)

- **Decision**: `<SwitchStaffButton>` is a `"use client"` component that calls `useFormStatus()` from `react-dom`. When `status.pending === true`, the inner submit `<button>` is rendered with `disabled` and `aria-busy="true"`. The button's submit triggers the bound Server Action; the form is re-enabled when the action's `redirect()` lands and the component re-mounts.
- **Rationale**: this is the React 19 / Next.js 16 idiom for "disable while server action is in flight" and adds no dependencies. It's the same pattern the shadcn submit examples document. It produces the spec's behavior (rapid double-click does not double-invoke) without any client business logic.
- **Alternatives considered**:
  - `useTransition` — viable but heavier; the form pattern is the textbook fit.
  - Debounce / `pointer-events: none` via state — works but reinvents what `useFormStatus()` exists to do.

## R6. Failure feedback (FR-008)

- **Decision**: keep error handling identical to today's dropdown path. `switchStaff()` either calls `redirect()` (success) or throws (e.g., the session is gone). A thrown error propagates to the nearest `app/(studio)/error.tsx` (or root error boundary), exactly as it does when the user invokes the same action from the dropdown today. The button is re-activatable because the boundary re-renders and remounts the form.
- **Rationale**: the spec requires the user to be "informed" and for the button to become "re-activatable." Both are met by the existing Next.js error boundary behavior. Adding a new toast pipeline for a single action would expand scope beyond the relocation; the dropdown version has no toast today either. Parity is the conservative call.
- **Alternatives considered**:
  - Surfacing failures via a `<Toaster>` toast — would require returning error state from the action (it currently throws or redirects, both of which terminate). Rejected as out of scope; can be added later as a cross-cutting Server Action error-handling concern, not a single-button concern.

## R7. Degraded session

- **Decision**: render `<SwitchStaffButton>` unconditionally in `app/(studio)/layout.tsx`, including the `degraded` branch.
- **Rationale**: the spec's edge case explicitly requires the button to remain available during degraded sessions so the user can recover. `switchStaff()` already calls `requireStudioSession()` — if the underlying session is too far gone to invoke the action, the resulting redirect to `/select-staff` is still the right outcome. The button does not need branch logic.

## R8. Test strategy

- **Decision**:
  - **Unit (Vitest + Testing Library)**: a new spec `tests/unit/auth/operator-menu.test.tsx` that
    1. renders `<OperatorMenu><OperatorChip ... /></OperatorMenu>`, opens the dropdown, and asserts the dropdown has exactly one item with the accessible name "Sign out" (and no item named "Switch staff").
    2. renders `<SwitchStaffButton>` and asserts the rendered DOM has a `<form>` whose `action` is the `switchStaff` server action reference, a submit button with accessible name "Switch staff", and a `<Repeat>` Lucide SVG inside it.
  - **e2e (Playwright)**:
    - Update the five existing callsites in `tests/e2e/auth.spec.ts` (lines 292, 310, 324, 344, 884 per repo state at branch creation) to click the topbar button instead of opening the chip dropdown. Identifier: `data-slot="switch-staff-button"`.
    - Add a new test asserting that the operator chip dropdown contains only "Sign out" after the change (covers FR‑004 and SC‑003).
- **Rationale**: matches Constitution Principle IV's requirement of test-first for auth-critical paths. Updating the existing tests in the same change set keeps the suite consistent and prevents a hidden regression where some flows still use the deprecated dropdown item.
- **Alternatives considered**: keeping the old e2e flow as a "still works as a fallback" — rejected because the spec explicitly removes the dropdown item; there is nothing to keep working.

## R9. Accessibility

- **Decision**:
  - The button is a real `<button type="submit">` inside a `<form action={switchStaff}>` — so it's reachable by Tab and activates on Enter/Space natively (FR-005).
  - Tab order: the button is rendered before the chip in DOM order, so the natural tab order is "brand → reconnecting banner controls (if any) → switch staff button → operator chip." This matches reading order.
  - Focus indicator: rely on the existing global `:focus-visible` ring already used elsewhere in the studio shell (the sidebar toggle uses the same approach). No new focus styles are introduced.
  - Icon: the Lucide SVG inside the button is marked `aria-hidden="true"`; the button's accessible name comes from the text node "Switch staff" — identical to how the operator menu's items are wired today.
- **Rationale**: matches the spec's FR-005 and existing repo conventions; no new ARIA invented.

## R10. Open questions

None. All FR/edge-case items in the spec map to decisions above. The Constitution Check in [plan.md](./plan.md) is PASS at both Phase 0 and Phase 1 re-check.
