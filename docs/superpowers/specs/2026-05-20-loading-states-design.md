# Loading & processing states — design

- **Date:** 2026-05-20
- **Status:** Approved — ready for implementation planning
- **Branch:** `fix/ui-fixes`
- **Authority:** `design-system/preview/loading.html` (canonical loading patterns); `CLAUDE.md` § "Design system rules (non-negotiable)"; Constitution Principle I.

## 1. Problem

Tang Nails has inconsistent and incomplete loading feedback:

- Only 4 of ~17 data-fetching routes have a `loading.tsx`. The rest paint
  blank or flicker while the server fetch is in flight.
- Auth forms, staff add/edit/danger-zone, and the checkout charge buttons
  give **no** feedback while their server action runs — the user cannot tell
  "working" from "hung".
- The PIN-entry modal silently ignores input during verification: after the
  4th digit it sits on 4 static dots with no signal while `submitPin`
  verifies and redirects.
- Where loading feedback exists it has drifted: skeletons use a custom
  `tx-skeleton` **pulse** while the design system's canonical skeleton is a
  **shimmer**; the spinner is Lucide `Loader` in one place and `Loader2` in
  another; several buttons disable + swap text but omit the spinner the
  design system specifies.
- There is no shared `<Spinner>` or `<Skeleton>` primitive, so every surface
  re-implements (and re-drifts).

## 2. Goals / non-goals

**Goals**

- Add page-load, button, section, and processing states everywhere it makes
  sense, all tracing to the design system's canonical patterns.
- Establish shared primitives so future UI cannot drift.
- Make the post-PIN verification window visibly "processing".

**Non-goals**

- The design system's full-screen **blocking overlay** pattern. Not needed:
  the long card-terminal wait already has a dedicated `CardWaiting` screen,
  and navigation waits are covered by route `loading.tsx`. The pattern stays
  documented but unused.
- An app-init full-screen splash (mark + spinner). Deferred — no surface
  currently warrants it.
- Restyling any existing button. Loading work only **adds** feedback
  (disabled + spinner + label); it never changes a button's chrome.

## 3. Design system reference

From `design-system/preview/loading.html` — the four canonical patterns:

| Pattern | Spec |
|---|---|
| **Spinner** | Lucide `Loader2` arc, `lq-spin` 1.2s linear infinite. Sizes 16 / 20 / 24px. Stroke 1.8 @16, 1.5 @20–24. On a button: stroke 2 (2.2 at small size). |
| **Button — loading** | `disabled`, `opacity: 0.72`, `cursor: not-allowed`, leading spinner + label (`Saving…`, `Processing…`, `Loading`). |
| **Skeleton — shimmer** | `lq-shimmer` 1.6s ease-in-out infinite. `linear-gradient(90deg, var(--muted) 0%, var(--neutral-300) 45%, var(--muted) 80%)`, `background-size: 1200px 100%`. Shape modifiers: line 12px, sub 9px, stat 18px (all `--radius-xs`), circle (`--radius-full`), square (`--radius-md`). Explicitly noted "more premium than pulse". |
| **Full-screen** | app-init (mark + spinner), blocking overlay (frosted glass), section skeleton (card-level, no overlay). Only the section-skeleton idea is used here; see non-goals. |

## 4. Decisions (from design dialogue)

1. **Shimmer everywhere.** New skeletons use the canonical shimmer **and**
   the 4 existing pulse skeletons migrate to it. One animation, matches the
   source of truth. The `tx-skeleton` pulse is removed.
2. **Checkout = in-button feedback.** The charge buttons get a spinner +
   label during the brief `inflight` window; no blocking overlay
   (`CardWaiting` already owns the long wait).
3. **PIN modal gets a visible processing state.**
4. **Delivery:** one PR on `fix/ui-fixes` (~30–35 files, mechanically
   uniform).

## 5. Detailed design

### 5.1 Shared primitives

- **`components/ui/spinner.tsx`** — `<Spinner>`. Renders Lucide `Loader2`
  with `lq-spin`. Props: `size` (16 | 20 | 24, default 16), `className`.
  Stroke width derived from size (1.8 @16, 1.5 @20–24). `aria-hidden` —
  the surrounding container owns the accessible status text.
- **`components/ui/skeleton.tsx`** — `<Skeleton>`. A shimmer block. Props:
  `variant` ("line" | "sub" | "stat" | "circle" | "square"), plus
  `width`/`height`/`className` overrides. `aria-hidden`.
- **`components/ui/button.tsx`** — add `loading?: boolean`. When set: the
  button is non-interactive, renders a leading `<Spinner>`, and shows the
  design system's 0.72 loading opacity (a `data-loading` attribute overrides
  the default `disabled:opacity-50`). `children` may be swapped by the
  caller to a loading label.
- **`components/lacquer/submit-button.tsx`** — `<SubmitButton>`. A client
  component that reads `useFormStatus()` and forwards `pending` to
  `<Button loading>`. Convenience wrapper for forms whose submit already
  uses the shadcn `Button`.
- **`styles/loading.css`** — `@keyframes lq-spin` and `@keyframes lq-shimmer`
  plus the shimmer background utility. Imported by the primitives. The old
  `.tx-skeleton` rule and `@keyframes tx-skeleton-pulse` are deleted from
  `styles/dashboard.css`.

**Raw styled buttons.** Many submit/charge buttons are raw `<button>` with
inline styles, not the shadcn `Button`. Those are **not** migrated to
`<Button>`. They keep their chrome and gain pending feedback in place:
`disabled`, a leading `<Spinner>`, and a label swap — driven by
`useFormStatus()` (forms) or existing local state (`inflight`).

### 5.2 Page-load skeletons (`loading.tsx`)

Each `loading.tsx` mirrors its page chrome so content arrival causes no
layout shift — the same approach the existing 4 already use, now built from
`<Skeleton>`.

- **Migrate to shimmer:** `dashboard`, `transactions`, `report`, `payroll`.
- **Add new:** `select-staff`, `checkout`, `checkout/[ticketId]`,
  `end-of-day`, `end-of-day/history`, `end-of-day/history/[sessionId]`,
  `payroll/[staffId]`, `services`, `settings/onboarding`, `settings/square`,
  `settings/staff`.
- **Skip:** `login`, `reset-password` — static forms; the real wait is the
  submit button.
- **Verify, add only if they fetch:** `settings/general`, `settings/billing`,
  `settings/notifications`, `settings/policy`.

### 5.3 Button / action states

Add pending feedback (disabled + `<Spinner>` + label swap) to:

- **Auth forms** — `auth-views.tsx` (sign-in, forgot, magic-link),
  `reset-password-form.tsx`, `google-sign-in-button.tsx`. Via `useFormStatus`
  / `<SubmitButton>`.
- **Staff** — `edit-panel.client.tsx` ("Save changes"),
  `add-staff-wizard.client.tsx` (final submit), `danger-zone.client.tsx`
  (deactivate / remove). Verify `change-pin-modal.client.tsx`.
- **Checkout** — the charge buttons ("Take cash", "Send to Square") in
  `checkout-screen.client.tsx`: spinner + label swap ("Charging…",
  "Sending to terminal…") while `inflight`.
- **Normalize existing partial buttons** to the canonical button-loading
  spec — they disable + swap text today but omit the spinner:
  `connect-button.client.tsx`, `disconnect-button.client.tsx`,
  `cash-count.client.tsx`, `eod/history/edit-form.client.tsx`,
  `tech-pay-action.client.tsx`, `close-period-dialog.client.tsx`,
  `device-list.tsx`.

### 5.4 PIN entry processing state

`components/lacquer/select-staff/pin-entry-modal.client.tsx` — while
`isPending` (after the 4th digit, during `submitPin` verify + redirect):

- Swap the `select-staff-modal-prompt` line ("Enter your 4-digit PIN") to a
  `<Spinner size={16}>` + "Signing in…".
- Dim the keypad (already inert) so it visibly reads as locked.

Covers both paths: on a correct PIN the spinner shows continuously until the
redirect completes; on a wrong PIN it shows briefly, then the existing
destructive error state paints. New visuals trace to `styles/select-staff.css`
classes (Principle I).

### 5.5 Section / in-place

`components/lacquer/onboarding/onboarding-search.client.tsx` — the search
re-fetches from the server on keystroke with no indicator. Add a
`<Spinner size={16}>` adornment inside the input while the
`router.replace` transition is pending.

### 5.6 Consistency cleanup

`components/lacquer/reconnecting-banner.tsx` — replace the inline Lucide
`Loader` + ad-hoc `studio-spin` keyframes with `<Spinner size={16}>` so the
app has exactly one spinner implementation.

## 6. Testing

- **Unit (Vitest):** `<Spinner>` and `<Skeleton>` render with the right
  variants/sizes; `Button` `loading` disables and renders the spinner;
  `<SubmitButton>` reflects `useFormStatus` pending.
- **E2E (Playwright):** verify the new pending states do not break existing
  `disabled`-based assertions; add coverage for the PIN processing state and
  one representative form submit button.
- **Design fidelity:** every value traces to a token; compare against
  `design-system/preview/loading.html`.
- **Gates:** full set before the PR — `format:check`, `lint`, `typecheck`,
  `test`, `test:e2e`.

## 7. Delivery

One PR on `fix/ui-fixes`. Estimated ~30–35 files: 3 new primitives
(`<Spinner>`, `<Skeleton>`, `<SubmitButton>`) + 1 stylesheet, ~11 new
`loading.tsx`, 4 migrated `loading.tsx`, ~15 component edits, unit tests.

## 8. File manifest

**New:** `components/ui/spinner.tsx`, `components/ui/skeleton.tsx`,
`components/lacquer/submit-button.tsx`, `styles/loading.css`; `loading.tsx`
under `select-staff`, `checkout`, `checkout/[ticketId]`, `end-of-day`,
`end-of-day/history`, `end-of-day/history/[sessionId]`, `payroll/[staffId]`,
`services`, `settings/onboarding`, `settings/square`, `settings/staff`;
unit-test files for the primitives.

**Modified:** `components/ui/button.tsx`; the 4 existing `loading.tsx`;
`styles/dashboard.css` (remove pulse); `auth-views.tsx`,
`reset-password-form.tsx`, `google-sign-in-button.tsx`;
`staff/edit-panel.client.tsx`, `staff/add-staff-wizard.client.tsx`,
`staff/danger-zone.client.tsx` (and `staff/change-pin-modal.client.tsx` if
needed); `checkout/checkout-screen.client.tsx`;
`select-staff/pin-entry-modal.client.tsx` (+ `styles/select-staff.css`);
`onboarding/onboarding-search.client.tsx`; `connect-button.client.tsx`,
`disconnect-button.client.tsx`, `cash-count.client.tsx`,
`eod/history/edit-form.client.tsx`, `tech-pay-action.client.tsx`,
`close-period-dialog.client.tsx`, `settings/square/device-list.tsx`;
`reconnecting-banner.tsx`.
