# Contract — `editCashDrawerAction` Server Action

Location: `app/(studio)/end-of-day/history/actions.ts`. Invoked from the client island `edit-form.client.tsx` via `'use server'`.

## Signature

```ts
type EditCashDrawerInput = {
  sessionId: string;          // the closed session to edit (uuid)
  countedCents: number;       // operator's new counted amount, in cents (>= 0 integer)
  notes: string;              // raw note; may be empty
};

type EditCashDrawerResult =
  | { ok: true; sessionId: string }
  | { ok: false; code:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "NOT_CLOSED"
        | "NOTE_REQUIRED"
        | "BAD_INPUT"
        | "UNEXPECTED";
      message: string;
    };

export async function editCashDrawerAction(
  input: EditCashDrawerInput
): Promise<EditCashDrawerResult>;
```

## Flow

1. **Resolve session**: `const viewer = await requireStudioSession()` — throws / redirects on missing session. After this, `viewer.staff.id` is the operator and `viewer.deviceUserId` is the device user.
2. **Role gate**: if `viewer.staff.role !== 'owner' && viewer.staff.role !== 'manager'` → return `{ ok: false, code: "FORBIDDEN", message: "Only owners and managers can edit a cash drawer count." }`. No audit row written (the read is harmless).
3. **Validate input**: `sessionId` is a non-empty string; `countedCents` is a non-negative integer. If anything fails → `BAD_INPUT`. Notes are not validated here (the RPC trims).
4. **Invoke RPC**: `await admin.rpc('pos_edit_cash_drawer', { p_session_id, p_counted_cents, p_notes, p_operator, p_device_user_id })` using the service-role client (`createSupabaseServiceRoleClient()` from `lib/db/admin.ts`).
5. **Map Postgres errors** by `error.message`:
   - `cash_drawer_session_missing` → `code: "NOT_FOUND"`.
   - `cash_drawer_session_not_closed` → `code: "NOT_CLOSED"`.
   - `cash_drawer_note_required` → `code: "NOTE_REQUIRED"`.
   - Any other error → `code: "UNEXPECTED"`; log via `console.error`.
6. **Revalidate**: `revalidatePath('/end-of-day/history')` and `revalidatePath(`/end-of-day/history/${input.sessionId}`)` on success so the next render of either page returns the edited values + the new audit row in the change history.
7. **Return** `{ ok: true, sessionId }`.

## UI consumption rules

- `ok: true` → client navigates back to the detail page (or just refreshes; the page is revalidated). Show a brief success toast: "Changes saved."
- `code: "NOT_FOUND"` → client navigates to `/end-of-day/history` with a transient toast: "Session no longer exists."
- `code: "NOT_CLOSED"` → unreachable from a properly-built UI (only closed sessions are linked from the list). On a manual URL hit, navigate to `/end-of-day` with a toast: "Use the close screen for an open day."
- `code: "FORBIDDEN"` → unreachable from a properly gated page; manual API hit returns a 403-equivalent error toast.
- `code: "NOTE_REQUIRED"` → client shouldn't have submitted (the form's `canSubmit` mirrors the rule); show a one-line error and keep the form state.
- `code: "BAD_INPUT"` / `UNEXPECTED` → generic error toast; preserve form state so the operator can retry.

## Test coverage (Vitest, mocking the supabase RPC)

- Returns `FORBIDDEN` for `front_desk` and `technician`.
- Passes the right argument shape to `admin.rpc`.
- Maps each Postgres error message to the documented code.
- Calls `revalidatePath` for both the list and the detail page exactly once on success.
- Does NOT call the RPC if the role gate fails.
- Handles a `BAD_INPUT` rejection without ever calling the RPC (validation runs first).
