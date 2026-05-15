# Contracts: Login Flow

These documents are the public surfaces of feature 003 — the things other
features and the test suite depend on. Treat them as the spec for the
implementation; if implementation diverges, update the contract first.

| File | Surface |
|------|---------|
| [routes.contract.md](./routes.contract.md) | `/login`, `/select-staff`, `/auth/callback` HTTP behavior + middleware contract |
| [server-actions.contract.md](./server-actions.contract.md) | `signInWithPassword`, `signInWithGoogle`, `signInWithMagicLink`, `submitPin`, `switchStaff`, `signOut` — argument shapes, return values, error modes |
| [session-helper.contract.md](./session-helper.contract.md) | `requireStudioSession()` and `getStudioSessionOrDegraded()` — the canonical input every studio caller uses |
| [cookie.contract.md](./cookie.contract.md) | `acting_as_staff_id` cookie format, signing, verification, expiry |
| [audit.contract.md](./audit.contract.md) | The five `audit_log.action` values this feature writes + per-action payload shape |

The data model (tables, indexes, RLS) is in [`../data-model.md`](../data-model.md).
