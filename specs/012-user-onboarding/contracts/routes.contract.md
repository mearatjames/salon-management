# Routes Contract — User Onboarding

This feature adds one new route and extends two existing ones.

## NEW: `GET /settings/onboarding`

**Auth**: requires authenticated Supabase session AND `viewer.staff.role === "owner"`. Non-owners → `redirect("/settings/staff")` per FR-002 (calmer than `/dashboard`; the offboarded notice lives next to where they expect their existing Staff edits).

**Server Component**. Fetches the full roster (R13), bins into pending/active/offboarded, renders the page.

**Search params**:

| Param | Type | Source | Effect |
|---|---|---|---|
| `q` | string | search input (URL-synced) | Server-side filter on `display_name` ILIKE OR `email` ILIKE. Applied to all three buckets before render. |
| `toast` | one of: `invited`, `resent`, `cancelled`, `offboarded`, `reactivated`, `removed`, `pin_reset`, `password_reset_sent` | server action redirects | Read by `OnboardingToaster` client island, fires the matching Sonner toast, then strips itself + `name` from the URL via `router.replace`. |
| `name` | string | server action redirects | Interpolated into the toast string. |
| `error` | one of: `already_invited`, `already_active`, `was_offboarded`, `invite_failed`, `not_found`, `cannot_offboard_self`, `last_owner`, `confirm_name_mismatch`, `ack_required`, `network`, `server_error`, `invalid_email`, `invalid_name`, `invalid_role`, `invalid_color`, `invalid_pin_shape`, `invalid_reason`, `stale_state`, `forbidden` | server action redirects | Read by `OnboardingToaster`, fires the matching error toast/inline alert per `ui-views.contract.md § Error mapping`. |
| `target` | uuid (staff_id) | server action redirects | When present, the page scrolls to + briefly highlights the target row. Optional. |

**Cache**: `export const dynamic = "force-dynamic"` (matches the Staff page). The roster query is hot but tiny; no ISR.

**Response codes**: 200 (rendered), 307 redirect (non-owner → /settings/staff, unauthenticated → /login).

---

## MODIFY: `GET /reset-password?type=<recovery|invite>`

**Existing behavior** (from 010): renders the new-password form or the expired-state card.

**New behavior**: reads `?type` from searchParams (defaults to `"recovery"`). Two affected surfaces:

| Surface | `type=recovery` (existing) | `type=invite` (new) |
|---|---|---|
| Page heading | "Reset password" | "Set your password" |
| Form submit button | "Update password" | "Set password and continue" |
| Expired card heading | "Reset link expired" | "Invite link expired" |
| Expired card body | "This link has expired or has already been used. Reset links are good for 1 hour and can only be used once." | "This invite link has expired or has already been used. Ask the owner to send a fresh one." |
| Expired card CTA | "Request a new link" → `/login?reset_intent=1` | (no CTA — the invitee can't self-request; the link is hidden, only the explanatory copy renders) |
| Form hidden field `method` | `"recovery"` | `"invite"` |

The Server Action `updatePassword` reads the hidden `method` field from FormData (defaulting to `"recovery"` if absent for back-compat) and passes it into the `device.password_reset` audit payload.

Post-submit redirect: both modes → `/select-staff` (existing).

**Server Component**. Same RSC + `searchParams` shape as 010; one extra `pickString(params.type)` call.

---

## MODIFY: `GET /auth/callback?code=...&type=invite`

**Existing behavior** (from 010): handles `?type=recovery` → redirects to `/reset-password`. Handles default OAuth + magic-link → redirects to `/select-staff`.

**New behavior**: `?type=invite` branch — after `exchangeCodeForSession` succeeds, `recordAuth("device.signed_in", userId, null, { method: "invite" })`, then `redirect("/reset-password?type=invite")`. On `?type=invite` with missing code OR exchange failure → `redirect("/reset-password?type=invite&error=expired")`.

`methodFromCallback(provider, type)` gains the case `if (type === "invite") return "invite"` (checked before the recovery branch).

---

## Inline error mapping

All `?error=` codes from server actions render as **inline alerts** above the section they apply to (not as toasts). Layout matches the 010 `.auth-alert.auth-alert-error` pattern, scoped under `.onb-alert`:

| Code | Surface |
|---|---|
| `already_invited` | Inline alert at the top of the Onboard sheet OR the Pending section (depending on which action threw). |
| `already_active` | Inline alert in the Onboard sheet's Identity step (email field), with a "View in Staff" inline link. |
| `was_offboarded` | Inline alert in the Onboard sheet, with a "Reactivate from Offboarded" link that scrolls to the row. |
| `not_found` | Toast (the row vanished beneath the user; reload the page). |
| `cannot_offboard_self` | Should not appear (UI gates it). If it does, toast: "You can't offboard yourself. Another owner has to do it." |
| `last_owner` | Inline alert in the Offboard / Remove sheet header: "Promote another owner first." Destructive button stays disabled. |
| `confirm_name_mismatch` | Inline below the typed-name input: "That doesn't match. Type the full name exactly." |
| `ack_required` | Should not appear (button disabled until both acks checked). Defensive toast: "Check both acknowledgements first." |
| `invite_failed`, `network`, `server_error` | Toast: "Couldn't reach the server. Try again." Action's sheet stays open with state intact (matches the edge case "Network failure mid-action"). |
| `stale_state` | Toast: "Someone else just changed this row. Refreshing…" + automatic `router.refresh()`. |
| `invalid_*` | Inline alert under the offending field. |
| `forbidden` | Should not appear (the page-level gate already redirected). Defensive: redirect to `/settings/staff`. |
