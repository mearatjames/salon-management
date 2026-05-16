# Contracts — User Onboarding & Offboarding

These contracts are the wire-level + behavioral specifications the
implementation must satisfy. Each section is keyed to spec FRs and to
research entries (R1–R14) in `../research.md`.

| File | Scope |
|---|---|
| [`server-actions.contract.md`](./server-actions.contract.md) | Eight server actions: inviteUser, resendInvite, cancelInvite, offboardUser, reactivateUser, removeUser, resetUserPin, sendUserPasswordReset. Per-action: arguments, validation, permission gates, side effects, audit row, redirect targets, error codes. |
| [`routes.contract.md`](./routes.contract.md) | `/settings/onboarding` GET + the four `?toast=` / `?error=` query parameters; `/reset-password?type=invite` view-state change; `/auth/callback?type=invite` branch. |
| [`audit.contract.md`](./audit.contract.md) | Seven new `user.*` AuditAction values + payload shapes; `device.password_reset` payload extension for owner-initiated path; `device.signed_in` payload extension for `method=invite`. |
| [`permissions.contract.md`](./permissions.contract.md) | The shared `lib/auth/role-permissions.ts` module (FR-080) — the single source of truth for per-role `label`, `summary`, `grants[]`, `blocks[]` consumed by the Thorough wizard, Staff tab hints, and any future role-comparison view. |
| [`ui-views.contract.md`](./ui-views.contract.md) | Page view structure (hero + 3 sections + 3 sheets + Reset PIN modal), Quick vs Thorough modes, per-row menus, empty states, search filtering, toast and inline-error surfaces. |

## Cross-cutting invariants

All eight server actions follow the **shared prelude** (mirrors
`app/(studio)/settings/staff/actions.ts`):

1. `requireStudioSession()` — throws `AuthRedirectError` on
   unauthenticated requests; propagates up.
2. Owner-only role gate — `if (viewer.staff.role !== "owner") redirect("/dashboard?error=forbidden")`.
   (Defense in depth on top of the page-level redirect from FR-002.)
3. Parse + validate `FormData` (per action; via `_validation.ts`).
4. Load target row (skipped for `inviteUser` — no target yet).
5. Perform the action-specific check (email-conflict for invite;
   last-owner pre-check for offboard/remove; `stale_state` check for
   any mutation against an `invited`/`offboarded` row whose state has
   changed since the page was rendered).
6. Mutate via `createSupabaseServiceRoleClient()` — DB writes and
   `supabase.auth.admin.*` calls. The action wraps the destructive
   Supabase calls in try/catch so a Supabase failure between the
   `createUser` and the staff INSERT can roll back via
   `admin.deleteUser` (R11).
7. `await recordAudit(...)` — no redirect before the audit row commits
   (Constitution III + the 010 `updatePassword` pattern).
8. `revalidatePath("/settings/onboarding")` + `redirect(...)` with the
   appropriate `?toast=` (success) or `?error=` (recoverable failure)
   query string.

Errors that bubble out of step 6 due to a known DB constraint:
- `unique_violation` (`23505`) on `staff_email_lower_unique` →
  `?error=already_invited`.
- `check_violation` (`23514`) / `raise_exception` (`P0001`) on the
  last-owner trigger → `?error=last_owner`.
- Any other DB error is `console.error`'d and the action redirects
  with `?error=server_error`.

All eight actions return `Promise<void>` (Next 16 Server Action
convention; the body always ends in `redirect()` which throws to
satisfy the never-return contract).
