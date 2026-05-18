# Contract: Audit log — deduction payload extensions

No new verbs. No new entity_type. No new `lib/auth/audit.ts` union additions. This feature **extends the existing `service.added` and `service.updated` payload shapes** declared by 008's audit contract (`specs/008-services-catalog/contracts/audit.contract.md`) with the four new deduction fields.

`entity_type` remains `'service'`. `entity_id` remains the `services.id` UUID. `actor_user_id` and `acting_as_staff_id` are unchanged.

---

## 1. `service.added` — payload extension

Fired by `addService` after a successful insert. The echoed-fields list grows by four:

```jsonc
{
  // … existing 008 fields: name, category, duration_min, price_cents, color_token,
  // taxable, variable_price, price_from_cents, price_to_cents, variable_price_note,
  // assigned_staff_ids …
  "card_fee_mode": "default",
  "card_fee_custom_cents": null,
  "supply_amount_cents": null,
  "supply_label": null
}
```

For services created via the Add panel in Phase 1, these four fields always resolve to `{ 'default', null, null, null }` because the panel's Add mode renders deduction defaults. But the payload echoes whatever was actually persisted — a future direct SQL insert or a Phase 2 cloning workflow that passes non-default values would surface those values in the audit.

## 2. `service.updated` — payload extension

Fired by `updateService` after a successful diff-apply. Two extensions:

### 2.1 `changes` map

The diff loop runs over the extended `SERVICE_DIFF_KEYS` constant (14 entries instead of 10). Any of the four deduction keys whose `before` value differs from `after` appears as a `[before, after]` pair in `changes`. Per FR-030, an unchanged key does NOT appear.

Example: a save that flipped Card-fee from default to custom and added a supply deduction:

```jsonc
{
  "changes": {
    "card_fee_mode": ["default", "custom"],
    "card_fee_custom_cents": [null, 450],
    "supply_amount_cents": [null, 500],
    "supply_label": [null, "GelX tips & gel"]
  },
  // (assignment_changes omitted when assignments did not change)
  "before": { /* full snapshot, see 2.2 */ },
  "after":  { /* full snapshot, see 2.2 */ }
}
```

Example: a save that ONLY changed the supply label (mode and amounts unchanged):

```jsonc
{
  "changes": {
    "supply_label": ["GelX tips", "GelX tips & gel"]
  },
  // No card_fee_mode, no card_fee_custom_cents, no supply_amount_cents — they didn't change.
  "before": { /* full snapshot */ },
  "after":  { /* full snapshot */ }
}
```

Example: a save that ONLY changed the price (no deduction edits — confirms FR-030):

```jsonc
{
  "changes": {
    "price_cents": [3500, 4000]
  },
  // No card_fee_* or supply_* keys appear — they didn't change.
  "before": { /* full snapshot — includes deduction columns at their unchanged values */ },
  "after":  { /* full snapshot — includes deduction columns at their unchanged values */ }
}
```

### 2.2 `before` and `after` snapshot extension

Both snapshots gain the four deduction columns alongside the existing fields:

```jsonc
{
  "name": "Gel polish",
  "category": "Manicure",
  "duration_min": 45,
  "price_cents": 3500,
  "color_token": "--avatar-rose",
  "taxable": true,
  "active": true,
  "variable_price": false,
  "price_from_cents": null,
  "price_to_cents": null,
  "variable_price_note": null,
  "assignment_ids": ["a1f0…", "b2c1…"],
  // NEW in 021:
  "card_fee_mode": "default",
  "card_fee_custom_cents": null,
  "supply_amount_cents": null,
  "supply_label": null
}
```

The snapshots always include the four fields (even when they didn't change in this save) so a future audit consumer can reconstruct the row state at any point without joining back to `services`.

## 3. Diff semantics

- `card_fee_mode` is compared as strings (`'default' !== 'custom'`).
- The three nullable columns are compared with strict inequality (`null !== 0` registers as a change).
- The `buildChanges` helper from 008's `actions.ts` is unchanged — it picks up the new keys via the extended `SERVICE_DIFF_KEYS` constant.

## 4. Why no new verb

Per `research.md § R6`: a separate `service.deduction_updated` verb would split a single user-facing save into two audit rows (one for the price change, one for the deduction change), forcing consumers to join them to reconstruct intent. Extending the existing payload preserves the "one save → one audit row" invariant established in 008.

## 5. Test coverage

`tests/unit/services/audit-diff-keys.test.ts` — NEW. Asserts:
- The `SERVICE_DIFF_KEYS` constant contains exactly the 14 expected keys (10 from 008 + 4 from 021).
- `buildChanges({ card_fee_mode: 'default', card_fee_custom_cents: null, ... }, { card_fee_mode: 'custom', card_fee_custom_cents: 450, ... })` returns `{ card_fee_mode: ['default', 'custom'], card_fee_custom_cents: [null, 450] }`.
- `buildChanges` does NOT emit keys when before === after (covers the FR-030 "no spurious entries" rule).

The existing 008 audit-vocabulary test (`tests/unit/services/audit-service-entity.test.ts`) continues to verify the `entity_type` routing — no edit needed.
