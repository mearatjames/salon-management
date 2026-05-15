# Contracts: Dashboard (Front-Desk Landing)

**Feature**: 002-dashboard-page
**Date**: 2026-05-14

The dashboard is a self-contained read-only UI surface; it exposes no external
HTTP / RPC endpoint. The contracts below describe the **internal boundaries**
that this feature must honor so subsequent features (auth, schema, calendar)
can plug in without redrawing the page.

| File                                  | Boundary                                  |
|---------------------------------------|-------------------------------------------|
| [dashboard-page.contract.md](./dashboard-page.contract.md)         | The `/dashboard` route — URL, response shape, side effects |
| [dashboard-data.contract.md](./dashboard-data.contract.md)         | `lib/dashboard/*` public API — types + functions the page imports |
| [lacquer-components.contract.md](./lacquer-components.contract.md) | Props of every new `components/lacquer/*` component |

Each contract is a stable surface that the later Supabase-wiring + auth
features must preserve. Changes to these signatures require a constitution-
gated amendment, not a silent refactor.
