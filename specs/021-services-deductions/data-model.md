# Phase 1 — Data Model: Per-service deductions

**Feature**: `021-services-deductions` · **Date**: 2026-05-17

Schema delta, app-layer type extensions, validation rules, state transitions, and invariants for the deduction columns. The authoritative source for column types is the migration this document is the basis for: `supabase/migrations/0016_services_deductions.sql`.

This feature adds **four columns + three CHECK constraints** to the existing `public.services` table (created in 008's migration `0003_services_catalog.sql`). **No new tables**, no new RLS roles, no `audit_log` schema change. The `service.updated` and `service.added` payload shapes are extended additively per [contracts/audit-payload.contract.md](./contracts/audit-payload.contract.md).

---

## 1. Schema delta — `public.services`

### 1.1 New columns

| Column                    | Type      | Constraints                                                            | Notes                                                          |
|---------------------------|-----------|------------------------------------------------------------------------|----------------------------------------------------------------|
| `card_fee_mode`           | `text`    | `not null default 'default'`; column-CHECK `IN ('default','custom','exempt')` | Tri-state per FR-009 / R1                                       |
| `card_fee_custom_cents`   | `int`     | nullable; cross-column CHECK below                                     | Required only when `card_fee_mode = 'custom'`; capped `[0, 5000]` |
| `supply_amount_cents`     | `int`     | nullable; cross-column CHECK below                                     | Required iff `supply_label` is set; bounded `[1, 5000]` when non-null |
| `supply_label`            | `text`    | nullable; cross-column CHECK below                                     | Required iff `supply_amount_cents` is set; trimmed length `[1, 64]` |

### 1.2 New CHECK constraints

- **`services_card_fee_mode_chk`** (column-level on `card_fee_mode`):
  `card_fee_mode IN ('default', 'custom', 'exempt')`

- **`services_card_fee_custom_pair_chk`** (cross-column):
  ```sql
  (
    card_fee_mode = 'custom'
      AND card_fee_custom_cents IS NOT NULL
      AND card_fee_custom_cents BETWEEN 0 AND 5000
  )
  OR (
    card_fee_mode <> 'custom'
      AND card_fee_custom_cents IS NULL
  )
  ```
  Reads: "When mode is custom, cents MUST be non-null and in `[0, 5000]`. When mode is anything else, cents MUST be null."

- **`services_supply_pair_chk`** (cross-column):
  ```sql
  (
    supply_amount_cents IS NULL
      AND supply_label IS NULL
  )
  OR (
    supply_amount_cents IS NOT NULL
      AND supply_label IS NOT NULL
      AND supply_amount_cents BETWEEN 1 AND 5000
      AND length(trim(supply_label)) BETWEEN 1 AND 64
  )
  ```
  Reads: "Both columns null, OR both non-null with amount in `[1, 5000]` and trimmed label length in `[1, 64]`."

### 1.3 Backfill behavior

Existing rows: `card_fee_mode` gets `'default'` from the column default; `card_fee_custom_cents`, `supply_amount_cents`, `supply_label` are null. No explicit `UPDATE` statement needed. Per SC-003, **100%** of existing services render a "$3 card fee" chip after migration, **0%** render a supply chip, **0%** render a "No fees" chip.

### 1.4 RLS posture

Unchanged from 008. `services` continues to grant `select to authenticated using (true)`; the kiosk JWT has no policy; writes go via service-role client through the Server Action. The four new columns inherit the table's RLS automatically.

### 1.5 Triggers

Unchanged. `services_set_updated_at_trg` continues to bump `updated_at` on any column change (including the four new ones).

### 1.6 Indexes

No new indexes. The existing `services_active_category_name_idx` (partial on `active = true`) already covers the hot list query; deduction columns are read alongside the rest of the row in the same `select`.

---

## 2. App-layer type extensions

### 2.1 `app/(studio)/services/_types.ts` — extend `CatalogService`

```ts
export type CardFeeMode = "default" | "custom" | "exempt";

export type CatalogService = {
  // … existing 008 fields …
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
  supply_amount_cents: number | null;
  supply_label: string | null;
  // existing: assignment_count: number;
};
```

`ServiceDraftBaseline` already extends `CatalogService` with `assignments`; the four new fields ride through automatically.

### 2.2 `service-form.client.tsx` — extend `ServiceDraft`

```ts
export type ServiceDraft = {
  // … existing 008 fields …
  card_fee_mode: CardFeeMode;
  // Preserved across mode flips so a fat-finger toggle doesn't lose typed input (FR-014).
  card_fee_custom_dollars: string; // empty string = unset; "0", "4", "4.50"
  supply_on: boolean;
  // Preserved across off-toggles so a fat-finger off doesn't lose typed input (FR-021).
  supply_amount_dollars: string;
  supply_label: string;
};
```

The draft uses dollar strings (not cents integers) so the inputs render exactly what the operator typed — the validators convert to cents on save. The mode flip and the supply toggle preserve the dollar strings in the draft buffer; the Server Action's validation runs on the **persisted** values (post-flip-resolution).

### 2.3 `app/(studio)/services/_deductions.ts` — NEW pure helpers

```ts
import { DEFAULT_CARD_FEE_CENTS } from "@/lib/services/card-fee-default";

export type EffectiveCardFeeInput = {
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
};

/** Resolve the cents the salon deducts for card processing.
 *  Returns 0 for 'exempt' (never null) so callers always have a number to subtract. */
export function effectiveCardFeeCents(input: EffectiveCardFeeInput): number {
  if (input.card_fee_mode === "exempt") return 0;
  if (input.card_fee_mode === "custom") return input.card_fee_custom_cents ?? 0;
  return DEFAULT_CARD_FEE_CENTS;
}

export type NetToTechInput = {
  /** Use price_cents for fixed-price, price_from_cents (or 0) for variable-price. */
  service_price_cents: number;
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
  /** null when Supply is off. */
  supply_amount_cents: number | null;
};

export type NetToTechResult = {
  net_cents: number;
  card_fee_cents: number;
  supply_cents: number;
};

export function computeNetToTechCents(input: NetToTechInput): NetToTechResult {
  const card_fee_cents = effectiveCardFeeCents({
    card_fee_mode: input.card_fee_mode,
    card_fee_custom_cents: input.card_fee_custom_cents,
  });
  const supply_cents = input.supply_amount_cents ?? 0;
  const net_cents = Math.max(0, input.service_price_cents - card_fee_cents - supply_cents);
  return { net_cents, card_fee_cents, supply_cents };
}
```

### 2.4 `lib/services/card-fee-default.ts` — NEW constant

```ts
/** Single source of truth for the hardcoded card-fee default in Phase 1.
 *  Phase 2 replaces this with `loadCardFeePolicy().amount_cents`. */
export const DEFAULT_CARD_FEE_CENTS = 300;

/** Render helper used by chip text and the Segmented control label. */
export function formatDefaultCardFeeLabel(): string {
  // Lacquer currency convention: whole dollars as "$3", non-whole as "$3.50".
  // 300 cents renders as "$3" (never "$3.00").
  const dollars = DEFAULT_CARD_FEE_CENTS / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
```

---

## 3. Validation rules — `app/(studio)/services/_validation.ts`

The four new validators extend the existing `ValidationErrorCode` union with one new value (`amount_too_large` — shared by both cap checks). Permission-matrix concerns continue to live in `permissions.ts`.

### 3.1 Extend `ValidationErrorCode`

```ts
export type ValidationErrorCode =
  // … existing 008 codes …
  | "invalid_card_fee_mode"
  | "invalid_card_fee_custom"        // empty/invalid format when mode='custom'
  | "card_fee_custom_too_large"      // > $50
  | "invalid_supply_amount"          // empty/invalid/zero/negative when supply on
  | "supply_amount_too_large"        // > $50
  | "invalid_supply_label"           // empty/whitespace-only when supply on
  | "supply_label_too_long";         // > 64 chars after trim
```

### 3.2 `validateCardFeeMode(input: string): CardFeeMode`

- Returns the mode if `input` is exactly `'default'`, `'custom'`, or `'exempt'`.
- Throws `ValidationError("invalid_card_fee_mode")` otherwise.

### 3.3 `validateCardFeeCustomDollars(input: string): number`

- Required when `mode = 'custom'` (the caller decides; this validator just enforces the format).
- Allowed: `'0'`, `'0.00'`, `'4'`, `'4.50'`, `'4.5'`, `'50'`, `'50.00'` (any non-negative decimal with ≤ 2 fractional digits, up to and including $50).
- Throws `ValidationError("invalid_card_fee_custom")` on empty, negative, malformed, or non-decimal input.
- Throws `ValidationError("card_fee_custom_too_large")` when the parsed value exceeds 5000 cents.
- Returns the parsed integer cents.

### 3.4 `validateSupplyAmountDollars(input: string): number`

- Required when Supply is on.
- Allowed: strictly positive decimals with ≤ 2 fractional digits, up to and including $50 (e.g. `'0.01'`, `'5'`, `'5.00'`, `'5.50'`, `'50'`).
- Throws `ValidationError("invalid_supply_amount")` on empty, zero (`'0'`, `'0.0'`, `'0.00'`), negative, or malformed input.
- Throws `ValidationError("supply_amount_too_large")` when the parsed value exceeds 5000 cents.
- Returns the parsed integer cents.

### 3.5 `validateSupplyLabel(input: string): string`

- Required when Supply is on.
- Trims whitespace. Empty after trim → `ValidationError("invalid_supply_label")`.
- Length after trim > 64 → `ValidationError("supply_label_too_long")`.
- Returns the trimmed value.

### 3.6 Validation orchestration in `actions.ts`

`addService` and `updateService` follow the same prelude. Pseudocode for the deduction branch:

```ts
const cardFeeMode = validateCardFeeMode(String(formData.get("card_fee_mode") ?? ""));
let cardFeeCustomCents: number | null;
if (cardFeeMode === "custom") {
  cardFeeCustomCents = validateCardFeeCustomDollars(String(formData.get("card_fee_custom") ?? ""));
} else {
  cardFeeCustomCents = null; // per FR-014: clear on mode flip
}

const supplyOn = formData.get("supply_on") === "on";
let supplyAmountCents: number | null;
let supplyLabel: string | null;
if (supplyOn) {
  supplyAmountCents = validateSupplyAmountDollars(String(formData.get("supply_amount") ?? ""));
  supplyLabel = validateSupplyLabel(String(formData.get("supply_label") ?? ""));
} else {
  supplyAmountCents = null; // per FR-021: clear on toggle off
  supplyLabel = null;
}
```

The four values are then handed to the existing `INSERT` / `UPDATE` builder alongside the 008 fields.

---

## 4. Audit payload extensions

### 4.1 `SERVICE_DIFF_KEYS` — extend

The constant in `actions.ts` grows by four entries:

```ts
const SERVICE_DIFF_KEYS = [
  // … existing 10 keys …
  "card_fee_mode",
  "card_fee_custom_cents",
  "supply_amount_cents",
  "supply_label",
] as const;
```

### 4.2 `ServiceDiffSnapshot` — extend

```ts
type ServiceDiffSnapshot = {
  // … existing 10 fields …
  card_fee_mode: CardFeeMode;
  card_fee_custom_cents: number | null;
  supply_amount_cents: number | null;
  supply_label: string | null;
};
```

### 4.3 Payload shape

- **`service.added`**: the echoed-fields list grows by four (`card_fee_mode`, `card_fee_custom_cents`, `supply_amount_cents`, `supply_label`). For brand-new services these are always `'default'` / `null` / `null` / `null` because the panel's Add mode renders the defaults; but the payload echoes whatever was persisted.
- **`service.updated`**: the `changes` map's diff loop naturally picks up the four new keys. The `before` and `after` snapshots gain the four fields. Per FR-030, deduction fields appear in the diff payload **only when they actually changed in this save** (the diff is per-key; unchanged keys don't appear).

Full shapes are documented in [contracts/audit-payload.contract.md](./contracts/audit-payload.contract.md).

---

## 5. State transitions

### 5.1 Card-fee mode lifecycle

```
   default ─┐
            ├──→ custom (sets card_fee_custom_cents to validated value)
   exempt ──┘

   custom ──→ default (clears card_fee_custom_cents to null)
   custom ──→ exempt  (clears card_fee_custom_cents to null)
   default ↔ exempt   (neither requires card_fee_custom_cents)
```

Invariant: `card_fee_custom_cents IS NOT NULL` iff `card_fee_mode = 'custom'`. Enforced by `services_card_fee_custom_pair_chk` AND by the Server Action's null-on-flip behavior (FR-014).

**In-memory draft buffer** (per FR-014): the draft `card_fee_custom_dollars` string is **preserved** when the mode flips so a fat-finger toggle doesn't lose typed input. On Save, the persisted `card_fee_custom_cents` is `null` whenever the saved `card_fee_mode` is not `'custom'`.

### 5.2 Supply lifecycle

```
   off ──→ on  (renders amount default $5.00, label empty + focused)
   on  ──→ off (clears both columns on save)
```

Invariant: `supply_amount_cents` and `supply_label` are both null or both non-null. Enforced by `services_supply_pair_chk` AND by the Server Action's clear-on-toggle behavior (FR-021).

**In-memory draft buffer** (per FR-021): the draft `supply_amount_dollars` and `supply_label` strings are **preserved** when the toggle flips off so a fat-finger off doesn't lose typed input. On Save, the persisted columns are both null whenever the saved Supply state is off.

### 5.3 Backfill state (existing rows post-migration)

```
   { mode: 'default', custom: null, supply_amount: null, supply_label: null }
```

This is the only initial state every pre-feature service occupies. SC-003 verifies the migration produces 100% of existing rows in this state.

---

## 6. Invariants (cross-cutting)

| Invariant | Where enforced |
|---|---|
| `card_fee_mode ∈ {'default', 'custom', 'exempt'}` | `services_card_fee_mode_chk` (DB) + `validateCardFeeMode` (app) |
| `card_fee_custom_cents IS NOT NULL ⇔ card_fee_mode = 'custom'` | `services_card_fee_custom_pair_chk` (DB) + Server Action null-on-flip (app) |
| `card_fee_custom_cents ∈ [0, 5000]` when set | Pair CHECK (DB) + `validateCardFeeCustomDollars` (app) |
| `supply_amount_cents IS NULL ⇔ supply_label IS NULL` | `services_supply_pair_chk` (DB) + Server Action clear-on-toggle (app) |
| `supply_amount_cents ∈ [1, 5000]` when set | Pair CHECK (DB) + `validateSupplyAmountDollars` (app) |
| `length(trim(supply_label)) ∈ [1, 64]` when set | Pair CHECK (DB) + `validateSupplyLabel` (app) |
| All writes preserved in `audit_log` with the diff payload | Server Action: awaits `recordAudit` before redirect (existing 008 path) |
| `service.taxable` ignored by deduction math | `computeNetToTechCents` does not consult `taxable` (Phase 1 omission; Phase 3 may revisit) |
| `assignment_count` ignored by deduction math | Same — assignments are a separate concept |

---

## 7. Migration SQL — `supabase/migrations/0016_services_deductions.sql`

The migration is documented in [contracts/db-migration.contract.md](./contracts/db-migration.contract.md). Outline:

```sql
-- 0016_services_deductions.sql
-- Feature: 021-services-deductions
--
-- Adds per-service card-fee mode + supply deduction columns to public.services.
-- Backfills existing rows via column defaults; CHECK constraints follow.

-- 1. Columns (idempotent).
alter table public.services
  add column if not exists card_fee_mode text not null default 'default';
alter table public.services
  add column if not exists card_fee_custom_cents int;
alter table public.services
  add column if not exists supply_amount_cents int;
alter table public.services
  add column if not exists supply_label text;

-- 2. Column-level CHECK on card_fee_mode (defensive; the default fixes existing rows).
alter table public.services
  drop constraint if exists services_card_fee_mode_chk;
alter table public.services
  add constraint services_card_fee_mode_chk
  check (card_fee_mode in ('default', 'custom', 'exempt'));

-- 3. Cross-column CHECK: card_fee_custom_cents required iff mode = 'custom', capped at 5000.
alter table public.services
  drop constraint if exists services_card_fee_custom_pair_chk;
alter table public.services
  add constraint services_card_fee_custom_pair_chk check (
    (card_fee_mode = 'custom'
     and card_fee_custom_cents is not null
     and card_fee_custom_cents between 0 and 5000)
    or
    (card_fee_mode <> 'custom'
     and card_fee_custom_cents is null)
  );

-- 4. Cross-column CHECK: supply_amount + supply_label both null or both non-null;
--    amount in [1, 5000]; trimmed label length in [1, 64].
alter table public.services
  drop constraint if exists services_supply_pair_chk;
alter table public.services
  add constraint services_supply_pair_chk check (
    (supply_amount_cents is null and supply_label is null)
    or
    (supply_amount_cents is not null
     and supply_label is not null
     and supply_amount_cents between 1 and 5000
     and length(trim(supply_label)) between 1 and 64)
  );
```

After this migration is applied, `npx supabase gen types typescript --local > lib/db/types.ts` regenerates the types so `services.Row` includes the four new fields with correct nullability.
