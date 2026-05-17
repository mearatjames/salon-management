# Phase 0 — Research: Checkout — Cart Polish

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Decisions the plan depends on. Each entry is Decision / Rationale / Alternatives sized to the smallest defensible answer. Numbering picks up from the phase-2 research (this file does not duplicate decisions already locked there; references to R1–R9 in `specs/011-cash-sale-checkout/research.md` are valid here).

---

## R10. Variable-price sheet — single component, three open paths

**Decision**: A single `<PriceSheet/>` component (`components/lacquer/checkout/price-sheet.tsx`) is opened by the parent client island in three modes, driven by props rather than separate components:

| Trigger | Mode | `isOverride` | Remove rendered? |
|---|---|---|---|
| Tap a tile whose `services.variable_price = true` | auto-open | `false` | yes (per FR-008) |
| Tap the price button on an unconfirmed cart row | manual | `false` | yes |
| Tap the price button on a confirmed cart row | override | `true` | NO (per FR-008 + clarification Q1) |

The Cancel button always closes the sheet without persisting — never removes the row (clarification Q1). The Save button is enabled only when the working amount is > 0 (FR-006). On save the parent calls `setLinePrice(...)`, which writes `unit_price_cents` and flips `price_unconfirmed = false`.

**Rationale**:

- One component is easier to keep visually in sync with the prototype's `PriceSheet` than three near-duplicates. The mode differences (Remove visibility, context note) are two prop-driven branches.
- The auto-open path is driven by the parent reading `addServiceLine`'s return value (`{ lineId, price_unconfirmed: true }`) — no extra state machine in the action layer.
- The clarification removed the previous Cancel/Remove ambiguity; modeling them as two distinct buttons everywhere makes the prototype mapping mechanical.

**Alternatives considered**:

- **Three separate components** (one per open path). Rejected — copy-paste maintenance hazard for a sheet that should look identical across paths.
- **A "mode" enum on the component itself** (`mode: 'auto' | 'manual' | 'override'`). Rejected — the only behavioral split is the Remove visibility rule, which `isOverride` captures cleanly. Adding a three-valued enum gives no extra information.

---

## R11. Percent-discount recompute timing

**Decision**: Percent-discount amounts are recomputed server-side on every cart mutation. The existing `recomputeTicketTotals` helper (currently in `app/(studio)/checkout/actions.ts`) is extended to:

1. Read all `ticket_items` for the ticket.
2. Compute `service_subtotal` = sum of `unit_price_cents * qty` over `kind = 'service' AND price_unconfirmed = false`.
3. For each row where `kind = 'discount' AND discount_pct IS NOT NULL`, write back `unit_price_cents = -round(discount_pct * service_subtotal / 100)` (banker's-rounding via Postgres `round()` semantics; we round to whole cents).
4. Re-read the ticket's `ticket_items` (the percent-discount writes in step 3 changed amounts).
5. Compute `discount_total` = sum of `unit_price_cents * qty` over `kind = 'discount'` (already negative).
6. `tickets.subtotal_cents = max(0, service_subtotal + discount_total)`; `tickets.total_cents = tickets.subtotal_cents` (tax stays 0 this phase).

`recomputeTicketTotals` is called from every mutating action: `addServiceLine`, `removeLine`, `setLinePrice`, `addDiscountLine`, `removeDiscountLine`. (Phase 2's `addServiceLine` and `removeLine` already call it; this phase adds the new entry points but keeps the helper as the single recompute path.)

**Rationale**:

- The spec (SC-004 + AS-3 in US3) says the percent must persist and the amount must reflect the live service subtotal at charge time. Doing the recompute at every mutation guarantees the on-screen running total matches what `pos_take_cash` will charge — there is no separate "recompute at charge" path that could disagree.
- Storing the recomputed `unit_price_cents` on the discount row (not just the percent) means `pos_take_cash`'s single `tickets.total_cents` read still represents the truth. The percent is a parameter; the amount is the derived value.
- Doing the recompute server-side keeps Constitution Principle II honest (the client never decides what a discount costs).

**Alternatives considered**:

- **Compute the discount amount only at charge time** inside `pos_take_cash`. Rejected — the on-screen total would diverge from `tickets.total_cents` until charge, which makes the "Charge $X" button label dishonest.
- **Compute it client-side and submit the amount with each mutation.** Forbidden by Principle II (client never sends money). Also creates a race where two near-simultaneous mutations could land discordant percent recomputes.

---

## R12. `settings` table shape

**Decision**: A single key/JSONB-value table:

```sql
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

RLS: `select-to-authenticated`. Writes go through the service-role client (no insert/update/delete policies). The migration seeds four keys for this phase:

| key | value | purpose |
|---|---|---|
| `salon.name` | `"Tang Nails"` | bill masthead |
| `salon.address` | `"218 Hayes St · San Francisco, CA"` | bill masthead |
| `salon.phone` | `"(415) 555-0140"` | bill masthead |
| `discount.manager_threshold_cents` | `null` | read by `addDiscountLine` (FR-018); UI deferred to phase 8 |

A tiny helper `lib/settings/read.ts` exports:

```ts
export async function getSetting<T = unknown>(key: string): Promise<T | null>;
```

Returns `value as T` (the JSONB column is parsed by Supabase's typed client; we cast at the call site).

**Rationale**:

- A JSONB value column gives us typed values (string, integer, null, future objects) without a column-per-type matrix. The cost — a JSON cast at read time — is negligible at the read volume this phase has (the bill RSC reads three keys, the discount save reads one).
- Same shape pattern as `audit_log.payload` (already JSONB in the schema). Reviewers know what to look for.
- Future keys (`tax.rate`, `tip.presets`, future-phase manager-threshold for refunds) land as new rows, not new columns.

**Alternatives considered**:

- **Column-per-type table** (`value_text text, value_int int, value_jsonb jsonb`). Rejected — schema noise for marginal type safety; nothing prevents both columns being populated on the same row.
- **One settings row holding a single JSONB blob** (`(id smallint pk default 1, data jsonb)`). Rejected — every read pulls the whole blob; every write is a read-modify-write race vector. Per-key rows give us natural concurrency without a transaction.
- **A typed dedicated table per setting family** (e.g., `salon_info`, `discount_config`). Rejected — overkill for v1; the spec explicitly says admin UI for settings is out of scope.

---

## R13. Print-only CSS scoping for the bill sheet

**Decision**: A targeted `@media print` block in `app/(studio)/checkout/checkout.css`:

```css
@media print {
  /* Hide every page region… */
  body * { visibility: hidden; }
  /* …then re-show only the bill DOM. */
  .lacquer-bill-doc, .lacquer-bill-doc * { visibility: visible; }
  /* Pull the bill out of the modal stack so it prints at top-left. */
  .lacquer-bill-doc {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 12mm;
    background: white;
  }
  /* Keep the bill in mm to match thermal-receipt printer paper width. */
  .lacquer-bill-doc { max-width: 80mm; }
}
```

The `BillSheet` root `<div>` carries the `.lacquer-bill-doc` class. Print uses the browser's `window.print()` — no JS-side selector manipulation, no detached print window.

**Rationale**:

- Using `visibility: hidden` + selective `visibility: visible` reliably hides everything outside the bill (including the sheet backdrop, the cart, the studio sidebar, the page header) without depending on a positive list of selectors. The existing receipt route's print path uses a different selector (`.studio-chrome { display: none }`) because it's in its own route with chrome-less layout; the bill sheet sits ON TOP of the studio chrome, so the receipt's approach would leak the sidebar.
- `position: absolute; inset: 0` pulls the bill out of the modal's stacking context so the browser's print engine lays it out at the page origin rather than at the modal's mid-screen position.
- mm units make Chrome's print preview render at a consistent physical size across desktop monitors and tablet screens, and matches the thermal-receipt paper width assumption from `FlowSingleExtras.jsx`'s prototype.

**Alternatives considered**:

- **Open a new window with only the bill HTML and print there.** Rejected — popup blockers, no shared CSS, the print preview UX is worse (a flash of a separate window).
- **JS-driven node move (detach the bill DOM to `<body>` for print, restore on `afterprint`).** Rejected — fragile (React would re-render mid-print on state changes), inconsistent across browsers' `afterprint` event timing.
- **A dedicated `/bill/[ticketId]` print route** (a la the receipt). Rejected — the bill is a pre-payment artifact tied to the live cart, not a paid ticket. Adding a route would imply persistence, which is the wrong semantic (the bill is ephemeral; refreshing shouldn't re-render it).

---

## R14. Bill snapshot semantics

**Decision**: The `BillSheet` component is rendered with a `frozenLines` prop captured by the parent in `useState` at the moment the operator clicks the Bill button. Cart edits underneath while the sheet is open do NOT mutate the snapshot. Closing and re-opening the sheet calls the snapshot helper again, producing a fresh view.

```ts
// In checkout-screen.client.tsx (simplified):
const [billSnapshot, setBillSnapshot] = useState<CartSnapshot | null>(null);

function openBill() {
  setBillSnapshot({
    lines: structuredClone(cart.lines),
    serviceSubtotalCents: cart.serviceSubtotalCents,
    discountTotalCents: cart.discountTotalCents,
    totalCents: cart.totalCents,
    capturedAt: new Date().toISOString(),
  });
}
function closeBill() { setBillSnapshot(null); }
```

`onPrint` calls `window.print()` against the live DOM (which still shows the snapshot — the snapshot is what's rendered).  
`onEmail` calls `emailBillStub(...)` with the snapshot's lines as the audit payload.

**Rationale**:

- Restaurant convention: the printed bill is the bill that was on the table at the moment the server brought it out. If the kitchen retroactively adds a side, that's a different bill.
- Snapshot-on-open avoids a race where the operator edits the cart, hits print, and a re-render lands a different print payload than what they saw.
- The snapshot is local state, not persisted. There's no "previous bills" history in v1; that would need its own entity (deferred).

**Alternatives considered**:

- **Re-derive from the live cart on each render.** Rejected — what the operator prints could differ from what they read on screen the instant before.
- **Persist the snapshot to a `bill_snapshots` table.** Rejected — premature; the spec doesn't require a printed-bill audit beyond the `bill.emailed` event row.

---

## R15. Stub email Server Action

**Decision**: `emailBillStub({ ticketId, address, snapshot })` is a Server Action in `app/(studio)/checkout/actions.ts` that:

1. Resolves the studio session (`requireStudioSession()`).
2. Validates the ticket id (UUID shape) and the address with a small RFC-5322-lite regex — same regex used by `email-bill-dialog.tsx` client-side:

   ```ts
   const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
   ```

3. On invalid address: throws `EmailAddressInvalidError` (no audit row, no toast).
4. On valid address: calls `recordAudit("bill.emailed", viewer.deviceUserId, ticketId, { address, line_snapshot }, viewer.staff.id)` and returns `{ ok: true }`.
5. Does NOT dispatch any real mail. No external network call. No queue insert.

The post-v1 swap-in for real mail is a body change inside this action; the contract (and the `bill.emailed` audit verb) does not change.

**Rationale**:

- The spec is explicit (Out of Scope): real outbound email is post-v1; this phase must wire the audit row + success toast and nothing else.
- Server-side address validation is defense in depth — the client validates too, but a hand-crafted request bypassing the client must not bypass the audit-row's "address is well-formed" invariant.
- The small regex is intentionally permissive (RFC-5322 in full is famously hostile); it catches the obvious junk while letting any plausibly-typed address through. Real email delivery in the post-v1 phase will lean on the actual mail provider's bounce handling.

**Alternatives considered**:

- **No server validation, trust the client.** Rejected — Principle II says server is authoritative; a forged client request must be caught.
- **Strict RFC-5322 validation.** Rejected — false-positive rejections (legit addresses with `+` aliases, etc.) for no gain in v1.
- **Insert into a `mail_outbox` table for a future worker.** Rejected — that's the post-v1 swap-in design, not v1. Adding a table whose only consumer is a TODO is Principle V scope creep.

---

## R16. Prototype mapping

**Decision**: Two prototype components are adapted 1:1 into `components/lacquer/checkout/`:

| Prototype symbol | Source file | Target file |
|---|---|---|
| `PriceSheet` | `design-system/prototypes/transaction/components.jsx` | `components/lacquer/checkout/price-sheet.tsx` |
| `BillSheet` | `design-system/prototypes/transaction/FlowSingleExtras.jsx` | `components/lacquer/checkout/bill-sheet.tsx` |

The Lucide `Mail` and `Printer` icons used by `BillSheet`'s footer are imported from `lucide-react` (replacing the inline SVG fallbacks the prototype defines as a TI namespace shim). All other icons used by either sheet (`X`, `Edit`, `Backspace`) are already in use elsewhere in the studio.

The discount sheet has no prototype — it's a small new piece composed of shadcn/ui primitives (`Dialog`, `RadioGroup`, `Input`, `Label`, `Button`) styled with the existing checkout tokens. It follows the same visual language as the auth and settings sheets already shipping in `components/lacquer/`.

**Rationale**:

- Constitution Principle I + `CLAUDE.md` "Reuse the prototypes" — adapt, don't redraw.
- The prototype components are tightly factored (PriceSheet is ~100 lines, BillSheet is ~110 lines), so the adaptation cost is low.
- Importing Lucide icons properly (vs the prototype's inline SVG shim) keeps the icon stroke width consistent at 1.5px and the sizes consistent at 16/20/24 across the studio.

**Alternatives considered**:

- **Inline both sheets as anonymous JSX inside `checkout-screen.client.tsx`.** Rejected — would break the side-by-side prototype review and bury two distinct visual surfaces in the client island.

---

## R17. Audit-log additions

**Decision**: Extend the existing `AuditAction` union in `lib/auth/audit.ts` with four new verbs, all of `entity_type = 'ticket'`:

```ts
// Added in 013 (entity_type "ticket")
| "line.price_set"
| "discount.added"
| "discount.removed"
| "bill.emailed"
```

`deriveEntityType` gains three prefix branches (`line.*`, `discount.*`, `bill.*`) — each maps to `"ticket"` because every one of these verbs describes a write/observation against a single ticket. No new entity types are introduced.

No schema change to `public.audit_log`. The controlled vocabulary stays in TypeScript (existing convention since feature 008).

**Per-verb emission**:

| Action | Emitted by | `entity_id` | Required `payload` keys |
|---|---|---|---|
| `line.price_set` | `setLinePrice` Server Action | the affected `ticket_items.id` | `{ ticket_id, previous_unit_price_cents, new_unit_price_cents, was_unconfirmed }` |
| `discount.added` | `addDiscountLine` Server Action | the new `ticket_items.id` | `{ ticket_id, shape, value, note }` |
| `discount.removed` | `removeDiscountLine` Server Action | the deleted `ticket_items.id` | `{ ticket_id, shape, value, note }` |
| `bill.emailed` | `emailBillStub` Server Action | the `tickets.id` being billed | `{ address, line_snapshot }` |

**Rationale**:

- Consistent with how phase 2 added `ticket.*` and `payment.*` verbs. The reviewer-friendliness of the prefix-dispatch convention is the existing payoff.
- `entity_type = 'ticket'` for all four keeps the audit query surface narrow: "show me everything that happened to this ticket" is a single `entity_type = 'ticket' AND entity_id = $1` query.
- `bill.emailed` is the one verb whose emitter is intentionally still a Server Action (not SQL), because it has no money-side atomic-boundary requirement — there's no payment, no status flip; it's pure observability.

**Alternatives considered**:

- **`bill.printed` as a parallel verb.** Rejected — `window.print()` is a browser dialog; there is no server-side signal we can audit reliably. The spec only requires Email to leave a trail.
- **Per-shape verbs** (`discount.added.flat`, `discount.added.percent`). Rejected — the controlled vocabulary should be coarse-grained; the shape is a payload field, not part of the verb. Phase 8's manager-PIN gate will read the payload, not the verb.

---

## R18. Cart-totals helper extension

**Decision**: The existing `recomputeTicketTotals(supabase, ticketId)` in `app/(studio)/checkout/actions.ts` is extended (not rewritten) to handle the new line kinds. The new shape:

```ts
async function recomputeTicketTotals(
  supabase: SupabaseServiceRoleClient,
  ticketId: string
): Promise<{ subtotalCents: number; totalCents: number }> {
  const { data, error } = await supabase
    .from("ticket_items")
    .select("id, kind, unit_price_cents, qty, price_unconfirmed, discount_pct")
    .eq("ticket_id", ticketId);
  // 1) service subtotal — fixed-priced services only
  // 2) percent-discount recompute (UPDATE rows where discount_pct IS NOT NULL)
  // 3) re-read or fold into local state
  // 4) discount total — sum of all kind='discount' unit_price_cents
  // 5) write back tickets.subtotal_cents = max(0, service_subtotal + discount_total),
  //    tickets.total_cents = tickets.subtotal_cents
}
```

Step 2 is the only new write to `ticket_items` in the recompute path — and only for rows whose `discount_pct IS NOT NULL` and whose recomputed amount differs from the stored one (a short `if (newAmount !== row.unit_price_cents)` guard avoids spurious writes).

The pure function `computeTotals(items)` used by the Vitest unit test mirrors the same logic against an in-memory `items` array; it's the spec for the SQL helper's behavior. The unit test cases listed in plan.md § Testing exercise both the function and the migration's CHECK constraints (the latter via the action-level Vitest cases against a mocked supabase that simulates the Postgres exception).

**Rationale**:

- Same pure-function-as-spec approach phase 2 already uses for `computeTotals`. The unit test stays simple and fast; the action-level test runs against the mocked supabase to exercise the percent-recompute side effect.
- Folding the recompute into the existing helper means every action that mutates the cart already goes through the right code path — no risk of forgetting to call a second helper.

**Alternatives considered**:

- **A separate `recomputeDiscounts` helper called alongside `recomputeTicketTotals`.** Rejected — two helpers means two call sites per action, and the second one becomes the bug magnet.
- **A SQL function instead of a Node helper.** Considered, but the existing helper is already Node and well-tested in phase 2; moving it to SQL just to add percent recompute is more disruptive than the change is worth. We keep the option open for a future phase when the cart-totals math gets more complex (tax, tip-split).

---

## Open follow-ups (deferred to later phases)

- **Manager-PIN override UI** at the discount-save gate (FR-018) — phase 8 (refunds/approvals). The setting read is already wired; phase 8 plugs in the UI.
- **Real outbound email** for `bill.emailed` — post-v1. Body change inside `emailBillStub`; the audit verb and contract stay the same.
- **Operator-facing `settings` admin UI** — its own later feature; v1 seeds defaults and reads them.
- **Per-row quantity controls** for service and product lines — out of scope for this polish; tracked separately.
- **Cancel of an unconfirmed-line Charge attempt** (FR-010 already covers this) — no follow-up needed; flagged here as a non-issue resolved by phase 2's existing UI gate.
