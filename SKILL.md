---
name: salon-management
description: Tang Nails salon management app. Loads project context (system design + design system rules) so any task in this repo follows the established architecture and visual language.
---

# Tang Nails

Web-based salon management app for a single nail salon (Tang Nails). Stack: Next.js 15 + Vercel + Supabase + Square. Design language: **Lacquer** design system (shadcn/ui + Tailwind OKLCH tokens + Lucide + Inter).

## When to use

Activate any time you're working in this repo — new features, refactors, bug fixes, code review.

## Instructions

1. Read `CLAUDE.md` at the repo root.
2. Read `docs/system-design.md` for architecture, scope, data model, flows, and build order.
3. For any UI work, also load `design-system/SKILL.md` and `design-system/README.md`. Tokens live in `design-system/colors_and_type.css`. Reference prototypes live in `design-system/ui_kits/` and `design-system/prototypes/`.
4. Follow the design-system rules in `CLAUDE.md` (tokens-only, sentence-case copy, Lucide icons, on-scale spacing, etc.) without exception.
5. When picking up implementation work, follow the build order in `docs/system-design.md` § "Files to create."
