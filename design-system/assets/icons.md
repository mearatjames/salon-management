# Iconography

Lacquer uses **Lucide** (https://lucide.dev) — a fork of Feather, MIT-licensed, 1.5px stroke.

## Loading

```html
<script src="https://unpkg.com/lucide@latest"></script>
<i data-lucide="calendar"></i>
<script>lucide.createIcons();</script>
```

Or React:
```jsx
import { Calendar, Scissors, Sparkles } from "lucide-react";
```

## Sizes
- 16px — inline with body text, dense tables
- 20px — buttons, list items (default)
- 24px — section headers, empty states
- 32px+ — hero / illustration

## Stroke
1.5px (Lucide default). Never thicken or fill.

## Common icons in product
- `calendar` `clock` `users` `user` `scissors` `sparkles` `dollar-sign`
- `bell` `search` `plus` `more-horizontal` `chevron-right`
- `check` `x` `circle-alert` `info` `circle-check`

## Don'ts
- No emoji in product chrome
- No Unicode glyphs as icons (✓ ✗ ★ are not allowed — use `check` `x` `star`)
- No mixing icon sets
- Never hand-roll an SVG icon — extend Lucide or request a custom mark
