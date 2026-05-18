# Contract: Server Actions — `addService` / `updateService` deduction extensions

This feature **extends** the existing 008 Server Actions in `app/(studio)/services/actions.ts`. It does NOT introduce new actions. The shared prelude (`requireStudioSession` → `assertCanWriteCatalog` → validate → mutate → `recordAudit` → `revalidatePath` + redirect) is unchanged.

`archiveService` and `restoreService` are **not modified** by this feature — they continue to read only `id`, `name`, and `active` from the row and do not touch deduction columns.

---

## 1. New FormData keys

Both `addService` and `updateService` accept the following additional FormData entries:

| Key                  | Type           | Required when                  | Notes                                                                 |
|----------------------|----------------|-------------------------------|-----------------------------------------------------------------------|
| `card_fee_mode`      | string         | always                         | One of `'default'`, `'custom'`, `'exempt'`. Default `'default'`.        |
| `card_fee_custom`    | dollars string | `card_fee_mode = 'custom'`     | Decimal with ≤ 2 fractional digits, in `[0, 50]`. Plain decimals only.  |
| `supply_on`          | `"on" \| absent`| always (toggle)               | `"on"` when Supply is enabled, absent when off (FormData boolean convention). |
| `supply_amount`      | dollars string | `supply_on = "on"`             | Decimal with ≤ 2 fractional digits, strictly `> 0`, ≤ 50.               |
| `supply_label`       | string         | `supply_on = "on"`             | Trimmed length in `[1, 64]`.                                            |

Existing 008 keys (`name`, `category`, `duration_min`, `price`, `color_token`, `taxable`, `variable_price`, `price_from`, `price_to`, `variable_price_note`, `service_id`, `staff_ids[]`, `override_min[<id>]`) continue to be accepted unchanged.

## 2. Validator-call order (inside the existing prelude)

After the existing 008 validators run (name, category, duration, color, price/bounds), the action calls the four new validators in this order:

```ts
const cardFeeMode = validateCardFeeMode(String(formData.get("card_fee_mode") ?? "default"));

let cardFeeCustomCents: number | null;
if (cardFeeMode === "custom") {
  cardFeeCustomCents = validateCardFeeCustomDollars(String(formData.get("card_fee_custom") ?? ""));
} else {
  cardFeeCustomCents = null; // FR-014: cleared on save when mode != 'custom'
}

const supplyOn = formData.get("supply_on") === "on";
let supplyAmountCents: number | null;
let supplyLabel: string | null;
if (supplyOn) {
  supplyAmountCents = validateSupplyAmountDollars(String(formData.get("supply_amount") ?? ""));
  supplyLabel = validateSupplyLabel(String(formData.get("supply_label") ?? ""));
} else {
  supplyAmountCents = null; // FR-021
  supplyLabel = null;       // FR-021
}
```

The four resolved values are then folded into the existing `insert(...)` / `update(...)` builder alongside the 008 fields. A failed validator throws `ValidationError` and the existing `handleKnownError(err, selectedId)` catch redirects with `?error=<code>`.

## 3. Error codes added

| Code                          | When raised                                                          | UI surface                                            |
|-------------------------------|----------------------------------------------------------------------|-------------------------------------------------------|
| `invalid_card_fee_mode`       | `card_fee_mode` is not one of the three allowed values               | Toast: "Couldn't save service — card-fee mode is invalid." |
| `invalid_card_fee_custom`     | `card_fee_custom` is empty / negative / malformed when mode=custom   | Toast: "Couldn't save service — custom card fee amount is invalid." |
| `card_fee_custom_too_large`   | `card_fee_custom` > $50 when mode=custom                             | Toast: "Couldn't save service — card fee can't exceed $50." |
| `invalid_supply_amount`       | `supply_amount` empty / zero / negative / malformed when supply on   | Toast: "Couldn't save service — supply amount is invalid." |
| `supply_amount_too_large`     | `supply_amount` > $50 when supply on                                 | Toast: "Couldn't save service — supply can't exceed $50." |
| `invalid_supply_label`        | `supply_label` empty / whitespace-only when supply on                | Toast: "Couldn't save service — supply label is required." |
| `supply_label_too_long`       | `supply_label` > 64 chars after trim when supply on                  | Toast: "Couldn't save service — supply label is too long (max 64)." |

All seven codes extend the existing `?error=<code>` redirect contract; `services-toaster.client.tsx` maps each to a `toasts.ts` entry.

## 4. Redirect targets

Unchanged from 008:

- **Success — `addService`**: `${SERVICES_PATH}?selected=<newId>&toast=service_added&name=<encoded>`. The right pane flips to Edit for the just-created service (which now carries `card_fee_mode = 'default'` and no supply by default).
- **Success — `updateService`**: `${SERVICES_PATH}?selected=<id>&toast=changes_saved`.
- **Validation failure**: `${SERVICES_PATH}?error=<code>&selected=<id>` (when `id` is known). The panel stays on the offending service so the operator can fix the input.
- **DB failure**: `${SERVICES_PATH}?error=db_failure&selected=<id>`.
- **No-changes save in `updateService`**: `${SERVICES_PATH}?selected=<id>&error=no_changes` (existing 008 behavior; the no-op detector now compares 14 columns instead of 10).

## 5. `updateService` no-op detection

`buildChanges(before, after)` continues to be the trust source for "did any column change?". The constant `SERVICE_DIFF_KEYS` grows by four entries (`card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`) so a deduction-only edit is correctly detected as a change.

Patch construction continues to be narrowed to only the changed keys — the wire payload to PostgREST shrinks when only one deduction column moves.

## 6. Authorization (unchanged from 008)

`assertCanWriteCatalog(viewer.staff.role)` continues to gate every write. Owners and managers may write; technicians and front-desk operators are rejected with `?error=forbidden`. The disabled-control tooltip on the panel ("Only owners and managers can edit the catalog.") matches the existing 008 vocabulary.

Per FR-029, a non-privileged operator who bypasses the disabled UI and POSTs the FormData directly still gets rejected — and no audit row is written, because the role gate runs before the mutation.

## 7. Performance

The new validators are O(1) string parsing. The DB UPDATE / INSERT statement gains four columns; the wire payload grows by ~40 bytes per save. No new queries. The Server Action round-trip stays within the existing 008 budget.

## 8. Test coverage

Vitest:
- `validation.test.ts` — extend with the seven new error codes plus happy paths for each validator (zero, mid-range, edge of cap, just-over-cap, whitespace, trim, multi-byte UTF-8 in label).

Playwright (`tests/e2e/services-deductions.spec.ts`):
- US2: round-trip every card-fee mode; verify the chip on the list row after each save; verify the disabled custom input is hidden when mode flips away from custom.
- US3: round-trip supply on/off; verify amber chip text matches `${amount} ${label}`; verify both columns clear on toggle-off save.
- US5: assert that posting the FormData as a `technician` returns the page with `?error=forbidden` and no audit row was written (using the existing `getAuditLogRowsSince()` helper from `tests/e2e/_db.ts`).
