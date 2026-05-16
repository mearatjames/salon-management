# Contracts — Login UI/UX Redesign

Phase 1 design contracts for spec
[010-login-redesign](../spec.md). These extend the
contracts introduced by
[003-login-flow](../../003-login-flow/contracts/) — see those
for the baseline.

## Files

| Contract | Scope |
|---|---|
| [server-actions.contract.md](./server-actions.contract.md) | New `sendPasswordReset` and `updatePassword` Server Actions; extension of `signInWithMagicLink` parity rules to reset. |
| [routes.contract.md](./routes.contract.md) | Refactored `/login` page contract (5-view URL state machine), new `/reset-password` page contract, extended `/auth/callback` recovery branch. |
| [audit.contract.md](./audit.contract.md) | Extension of `AuditAction` union with `device.password_reset`; audit-row shape and lifecycle for the reset flow. |
| [ui-views.contract.md](./ui-views.contract.md) | The five-view UI state machine: URL→view mapping, view-swap precedence, animation + reduced-motion contract, password-reveal toggle contract. |

## Cross-feature invariants

All contracts in this folder preserve every cross-action invariant
from `003-login-flow/contracts/server-actions.contract.md`:

1. **Audit before redirect on success.** A successful sign-in,
   reset, or password update writes its audit row before any
   `redirect()` call.
2. **No enumeration.** Wrong-password, unknown-email, and
   not-registered all surface identical responses
   (`/login?error=invalid` for sign-in;
   `/login?magic_sent=<email>` for magic-link;
   `/login?reset_sent=<email>` for password reset).
3. **Network failures.** Surface `?error=network` on the same
   view the user was on; render a calm retry message.
4. **`?next=` propagation.** `next` is carried verbatim through
   every redirect; sanitization happens only at the
   cookie-issuing boundary in `/select-staff`.

These invariants are enforced by the existing test suite
(`tests/unit/auth/login-actions.test.ts`,
`tests/e2e/auth.spec.ts`) and extended by the new tests this
feature adds.
