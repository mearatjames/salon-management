# Tang Nails — Repo Guide

This repo is **Tang Nails**, a salon management web app for a single nail salon. The visual language is the **Lacquer** design system (a separate brand identity Tang Nails uses, generated in Claude Design). Source of truth for the build:

- **System design**: `docs/system-design.md` — architecture, scope, data model, flows, build order.
- **Design system**: `design-system/` — the Lacquer brand & component library (tokens, prototypes, UI kits). Vendored copy of the [Claude Design project](https://claude.ai/design/p/019e0124-88cc-7ec5-b59a-055dd1301a03). When the live project changes, re-export the handoff zip and replace `design-system/`.

## Design system rules (non-negotiable)

When writing or reviewing UI code in this repo, you MUST follow `design-system/`:

1. **Read `design-system/README.md` and `design-system/SKILL.md` first** before writing any component or page.
2. **Tokens, not hardcoded values.** All colors, spacing, radii, shadows, and type come from `design-system/colors_and_type.css` (copied into `styles/tokens.css`). No raw hex codes, no off-scale spacing, no custom font weights.
3. **Components** — use shadcn/ui primitives (`components/ui/*`) composed into project-specific components in `components/lacquer/*`. Do not introduce a second component library.
4. **Icons** — Lucide only, 1.5px stroke, sized 16/20/24. No emoji in chrome.
5. **Type** — Inter only, weights 400/500/600. Tabular numerals on every numeric column, time, and currency. Body 14px / 1.5.
6. **Color** — neutral foundation + `--primary` (Lacquer Rose) accent. Semantic colors muted. No gradients in chrome.
7. **Spacing** — 4px base; only the scale `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
8. **Radii** — `4` inputs, `6` buttons, `8` chips/small cards, `12` cards, `16` sheets/dialogs, `999` pills.
9. **Animation** — 150ms hover/press, 200ms popovers, 300ms sheets/dialogs, ease-out-expo. No bounce/spring/scale.
10. **Copy** — calm, specific, second-person, sentence case, numerals always (`3 services`, `$45`). See README "Content fundamentals."

## Reuse the prototypes

`design-system/ui_kits/studio/*.jsx` and `design-system/prototypes/**/*.jsx` are the reference layouts for v1 surfaces. Do not redraw — adapt them. Mapping is in `docs/system-design.md` under "Reuse from the design system handoff."

## When you change UI

Before claiming a UI task complete:
- Compare your output side-by-side with the matching prototype in `design-system/`.
- Confirm every value used (color, spacing, radius, shadow) traces back to a token.
- Run the design-system preview HTML files (`design-system/preview/*.html`) in a browser if you need to eyeball the canonical look.

## Stack reminder

Next.js 16 (App Router, RSC + Server Actions) · Vercel · Supabase (Postgres/RLS, Auth, Realtime, Storage) · Square SDK (server-side) · shadcn/ui + Tailwind + Lucide. See `docs/system-design.md` for the full picture.

<!-- SPECKIT START -->
Active feature plan: `specs/006-staff-management/plan.md` — read it for the
current feature's technical context, project structure, and build steps.
<!-- SPECKIT END -->
