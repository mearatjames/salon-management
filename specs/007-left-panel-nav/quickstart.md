# Quickstart: Studio Left Navigation Panel

**Feature**: 007-left-panel-nav

This is the minimum a teammate or reviewer needs to run, see, and verify the studio left panel.

---

## 1. Run the app

From the repo root:

```bash
npm install              # if you haven't already
npm run dev              # Next.js dev server
```

Open `http://localhost:3000`, sign in (existing flow), and land on `/dashboard`.

You should see, in addition to the top bar that already exists:

- A 224px-wide left panel filling the full window height.
- A collapse button in the top-right of the panel.
- A "Dashboard" link, then a "Workspace" group (Schedule, Clients, Services, Checkout, Walk-in), then an "Operations" group (End of Day Cash, Day Report, Settings).
- An operator chip pinned at the bottom showing the staff member you signed in as.

---

## 2. Verify behaviour quickly (manual smoke)

| Action | Expected |
|---|---|
| Click "Schedule" | URL becomes `/calendar`; "Schedule" is the only item with the active treatment. |
| Visit `/settings/staff` directly | "Settings" is highlighted (nested route still highlights parent section). |
| Click "Services" or "Day Report" | Nothing happens; the item looks de-emphasised; hovering shows a "coming soon" tooltip. |
| Click the collapse toggle | Panel shrinks to a 56px icon rail; main content fills the reclaimed space. |
| Reload the page while collapsed | Panel stays collapsed (no flash to expanded then back). |
| Click toggle again, reload | Panel stays expanded. |
| Sign out and back in (or trigger the auth-degraded path) | Panel still renders; footer shows a neutral placeholder instead of crashing. |

---

## 3. Side-by-side against the prototype (acceptance bar)

This is the constitutional bar (Principle I — Design System Fidelity). Open both:

```bash
open design-system/prototypes/user-management/User\ Management.html
```

…and the local app's `/dashboard` page. Compare:

- Icons (same Lucide shapes), labels (same text), group order.
- Expanded width 224px, collapsed width 56px.
- Spacing, font sizes/weights, active background, hover background.
- Animation feel on collapse/expand (≤220ms, ease-out, no spring).
- Operator chip composition (avatar tile in staff color, name, role label).

Any visible drift = the feature is not done. Fix the styles in `styles/studio.css` until the side-by-side matches.

---

## 4. Run the quality gates (constitution Principle § Development Workflow)

In this exact order — CI runs the same set and a missed one will bounce the PR:

```bash
npm run format:check     # Prettier
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm test                 # Vitest unit (includes sidebar/is-active-section.test.ts)
npm run test:e2e -- --workers=1   # Playwright (includes sidebar.spec.ts)
```

All five MUST be green locally before push.

---

## 5. Files you should expect to see in the diff

- `app/(studio)/layout.tsx` — wrapped in the 2-column grid, mounts the sidebar.
- `components/lacquer/sidebar/studio-sidebar.tsx` — server component shell.
- `components/lacquer/sidebar/sidebar-shell.client.tsx` — small client island (toggle + active state).
- `components/lacquer/sidebar/nav-item.tsx` — per-item server component.
- `components/lacquer/sidebar/nav-items.ts` — the canonical nav config (matches `contracts/nav-items.contract.md`).
- `styles/studio.css` — new `.studio-shell`, `.studio-sidebar`, `.studio-nav-*` rules; existing rules unchanged.
- `tests/unit/sidebar/is-active-section.test.ts` — unit coverage of the active-match helper.
- `tests/e2e/sidebar.spec.ts` — Playwright e2e covering presence, navigation, active state, collapse persistence, disabled-item no-op.
- `CLAUDE.md` — SPECKIT block updated to reference this plan.

If you see a database migration, a Server Action, a new dependency, or anything under `app/api/`, something has drifted outside the spec — push back.
