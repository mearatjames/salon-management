# Data Model: Project Scaffolding

**Feature**: 001-project-scaffolding
**Date**: 2026-05-13

## Summary

**This feature has no domain data model.** Project scaffolding stands up the repository structure,
toolchain, and dependency set — it introduces no persistent entities, no database tables, and no
schema.

The Tang Nails data model (staff, services, clients, appointments, tickets, payments, tip splits,
audit log, etc.) is defined in `docs/system-design.md` §"Data model" and will be implemented by a
later schema feature as `supabase/migrations/0001_init.sql`. This scaffolding feature only creates
the empty `supabase/migrations/` directory that will hold it.

## Configuration artifacts (not domain entities)

For completeness, the structured artifacts this feature *does* produce are project configuration,
not data:

| Artifact | Purpose | Authored by |
|----------|---------|-------------|
| `package.json` / `package-lock.json` | Dependency manifest + reproducible lockfile | `create-next-app` + `npm install` (never hand-edited) |
| `tsconfig.json` | TypeScript compiler config (strict mode) | `create-next-app` |
| `components.json` | shadcn/ui generation config | `npx shadcn@latest init` |
| `vitest.config.ts` / `playwright.config.ts` | Test runner configs | feature implementation |
| `.env.example` | Names every environment variable v1 will need | feature implementation |
| `.github/workflows/ci.yml` | Quality-gate pipeline definition | feature implementation |

These have no relationships, no state transitions, and no validation rules in the domain sense —
they are validated only by the tools that consume them (the quality gates in quickstart.md).

## State transitions

None. The scaffold is static; it has no runtime state.
