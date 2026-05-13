# Lacquer — Salon Management Design System

Lacquer is a nail salon management platform: bookings, client records, service catalog, staff scheduling, payments, and inventory in one place. It serves two audiences in one product family:

1. **Lacquer Studio** — the desktop/web app used by salon owners, managers, and technicians (calendar, clients, POS, reporting).
2. **Lacquer Book** — the mobile-first booking experience used by clients (browse services, pick a tech, schedule, pay).

The design system is built directly on top of **shadcn/ui** conventions: Tailwind CSS variables in OKLCH, a neutral foundation with a single accent (`primary`), Radix-derived component patterns, and Lucide icons. The aesthetic is modern, restrained, and quiet — the salon visuals are the "color"; our chrome stays out of the way.

## Sources

This system was generated without an attached codebase or Figma. It uses shadcn/ui (https://ui.shadcn.com) as the canonical reference and invents Lacquer-specific tokens, copy, and product surfaces on top. If a real codebase or Figma exists, re-attach it via the Import menu and we'll align the tokens to the source of truth.

## Index

Root files:
- `README.md` — this document (context, content rules, visual foundations, iconography)
- `SKILL.md` — Agent Skill front-matter for use in Claude Code
- `colors_and_type.css` — base + semantic CSS variables, font-face declarations
- `fonts/` — webfonts (Inter via Google Fonts, loaded by `colors_and_type.css`)
- `assets/` — logos, marks, hero imagery, illustration placeholders
- `preview/` — small HTML cards rendered in the Design System tab
- `ui_kits/studio/` — Lacquer Studio (web) UI kit
- `ui_kits/book/` — Lacquer Book (mobile) UI kit

## Content fundamentals

Lacquer copy is **calm, specific, and second-person.** We write to the salon owner like a trusted ops partner — never bossy, never cute.

- **Person.** "You" for the user, "we" only when the product is doing something on their behalf ("We'll email her a reminder 24 hours before"). Avoid "I" entirely.
- **Casing.** Sentence case everywhere — buttons, headings, table columns, menu items. The only Title Case is the product name (Lacquer Studio, Lacquer Book) and proper nouns (service names like "Russian Manicure" if the salon uses them).
- **Tone.** Plainspoken and concrete. Prefer "Add client" over "Create new client record." Prefer "12 unread" over "You have 12 unread notifications."
- **Numbers.** Always numerals (`3 services`, not "three services"). Currency uses the locale symbol with no trailing zeros when whole (`$45`, not `$45.00`) except in receipts where alignment matters.
- **Dates.** Relative when recent ("Today", "Tomorrow", "Tue"), explicit when distant ("May 21"). Never "05/21/26" outside of dense tables.
- **Empty states.** One sentence telling the user what this surface is for, plus one primary action. Example, clients list: "Clients you've booked will show up here. — [Add client]"
- **Errors.** Name the thing, then the fix. "Card was declined. Try a different payment method." Not "An error occurred."
- **Emoji.** None in product chrome. Emoji are fine in user-generated content (notes, client tags) but never in our copy, buttons, or system messages.
- **Vibe.** Quiet, professional, slightly editorial. Imagine the back-office of a high-end studio — not a startup launch page, not a mass-market consumer app.

Examples:
- ✅ "Maya is fully booked Friday. Move this appointment to Saturday?"
- ❌ "Oops! 😬 Maya doesn't have any open slots on Friday."
- ✅ "Charge $84 to Visa •• 4242"
- ❌ "Click here to charge the customer's card"
- ✅ "Shift starts in 12 min"
- ❌ "Your shift will be starting in approximately 12 minutes!"

## Visual foundations

**Color.** Neutral-first. The palette is built on a warm-cool slate (`oklch` neutrals) with a single brand accent — **Lacquer Rose**, a desaturated mauve that nods to nail polish without being literal. Semantic colors (success, warning, destructive) are muted, never saturated. Backgrounds are off-white in light mode (`oklch(0.99 0.003 90)`) and near-black in dark mode (`oklch(0.145 0 0)`). No gradients in chrome. Imagery may use warm gradients but the UI itself is flat.

**Type.** Inter for everything. Weights 400/500/600. Tabular numerals (`font-feature-settings: "tnum"`) on every numeric column, time, and currency. Display sizes use tight tracking (`-0.02em`) and line-height 1.1. Body is 14px / 1.5. There is no serif, no display face, no monospace except in code blocks (`ui-monospace` system stack).

**Spacing.** 4px base unit. The scale we actually use: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`. Most paddings are `12` or `16`. Card insets are `24`. Section gaps are `32` or `48`. Never use raw pixel values outside this scale.

**Backgrounds.** Solid colors only in chrome. App background is `--background`, surfaces are `--card` (one step lighter or identical depending on mode). No textures, no patterns, no full-bleed hero imagery in product. Marketing surfaces (which are out of scope for v1) may use a single duotone photograph per page.

**Animation.** Minimal and fast. `150ms` for hover/press, `200ms` for popovers/menus, `300ms` for sheet/dialog. Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) for entries, `ease-in` for exits. No bounces. No springs in chrome. Page transitions are crossfades, never slides.

**Hover.** Buttons darken by ~4% (`hover:bg-primary/90`). Ghost/secondary surfaces fill with `--accent` (a 4% tint of foreground). Links underline on hover. Cards never lift on hover unless they're clickable; clickable cards get a 1px ring in `--border`.

**Press.** Buttons have no scale transform — only a 50ms color darken. Toggleable rows show a brief `--accent` flash. We do not use scale-down on press.

**Borders.** Hairline (`1px`) in `--border` (a 6% step from background). Borders define grouping; we lean on borders rather than shadows. `border-dashed` only for empty/drop zones.

**Shadows.** Three levels, all subtle:
- `--shadow-xs` — `0 1px 2px 0 rgb(0 0 0 / 0.04)` for resting cards
- `--shadow-sm` — `0 2px 4px -1px rgb(0 0 0 / 0.06)` for popovers
- `--shadow-md` — `0 8px 24px -4px rgb(0 0 0 / 0.10)` for dialogs/sheets
No glow, no inner shadow, no neumorphism. Dark mode uses `rgb(0 0 0 / 0.5)` at the same magnitudes.

**Capsules vs gradients.** Pills (`rounded-full`) for status badges and filter chips only. Buttons are `rounded-md` (6px). Cards are `rounded-xl` (12px). No protection gradients — we use solid surfaces with borders.

**Layout.** 12-column grid on desktop, 4-column on mobile. Max content width 1280px. Sidebars are 240px (collapsed 56px). The app shell is fixed: top bar 56px, sidebar full-height, content scrolls internally. Modals/sheets pin to the right (sheets) or center (dialogs).

**Transparency & blur.** Used only for overlays (modal scrim at `bg-black/50`) and the macOS-style toolbar in dark mode (`backdrop-blur-md` over `bg-background/80`). Never on cards.

**Imagery.** Salon photography is warm, slightly desaturated, with natural light — never stock-blue cool tones, never high-contrast. Avatars are crisp circular crops. We always include a fallback avatar with the user's initials in `--muted` over `--muted-foreground`.

**Corner radii.** `4` (inputs), `6` (buttons), `8` (small cards/chips), `12` (cards), `16` (sheets/dialogs), `999` (pills/avatars).

**Cards.** White (`--card`) over off-white (`--background`). 1px border in `--border`. Optional `--shadow-xs`. 24px inset. Clickable cards add a focus ring on keyboard focus only.

## Iconography

See the **Iconography** section in the Design System tab. We use **Lucide** (https://lucide.dev) at 1.5px stroke, sized 16/20/24. Lucide is loaded from CDN — see `assets/icons.md` for the canonical import. No custom icon set, no emoji in chrome, no Unicode glyphs as icons. The brand mark (`assets/lacquer-mark.svg`) is the one custom shape in the system.
