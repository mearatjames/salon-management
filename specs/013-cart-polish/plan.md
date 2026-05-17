# Implementation Plan: Checkout — Cart Polish (Variable Pricing, Discounts, Bill Preview)

**Branch**: `worktree-013-cart-polish` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-cart-polish/spec.md`

## Summary

Polish the existing phase-2 single-screen checkout (`/checkout/[ticketId]`) with the three pieces it still lacks before the salon can charge real custom work: a working variable-price entry sheet, structured discount lines, and a restaurant-style "drop the bill" preview that prints or emails before payment. The variable-price sheet replaces the FR-016 placeholder dialog from phase 2; it opens automatically when a variable service is added and is re-opened by tapping the price control on any row (override). The discount sheet writes a new `ticket_items` row with `kind='discount'`, supporting flat amounts and percent discounts that recompute as service lines change. The bill preview is a read-only snapshot rendered as an overlay on the cart; Print uses `window.print()` against a print-only stylesheet, and Email writes an `audit_log` row + toasts success without dispatching real mail.

**Technical approach**: introduce one new migration `supabase/migrations/0005_cart_polish.sql` that extends `ticket_items` (`kind` enum adds `'discount'`; new nullable `discount_pct` and `note` columns; `ref_id` and `assigned_staff_id` relaxed to nullable with a kind-conditional CHECK), adds a `presets jsonb` column to `services`, creates a new `settings` key/value table seeded with the salon masthead defaults + the `discount.manager_threshold_cents` read-only setting, and ALTERS the `pos_take_cash` RPC so it floors the total (after discount lines) and refuses on `ticket_empty` exactly as today. Three new Server Actions ship in `app/(studio)/checkout/actions.ts`: `setLinePrice` (used by both auto-open and override paths), `addDiscountLine`, `removeDiscountLine`. A new `emailBillStub` Server Action lives in the same module, returns success without dispatching mail, and writes the `bill.emailed` audit row. The variable-price placeholder dialog (`components/lacquer/checkout/variable-price-placeholder-dialog.tsx`) is replaced by a real `price-sheet.tsx` component adapted from `design-system/prototypes/transaction/components.jsx::PriceSheet`. A new `bill-sheet.tsx` component is adapted from `design-system/prototypes/transaction/FlowSingleExtras.jsx::BillSheet`. The cart header gains a `+ Discount` affordance; the cart footer gains a `Bill` button alongside the existing Charge. The Charge button enable rule (already wired in phase 2 for unconfirmed lines) is extended: it also requires `total_cents > 0` after discount-line summation (server-trusted; the RPC enforces it too). No realtime, no Square, no manager-PIN UI, no real outbound email.

## Technical Context

**Language/Version**: TypeScript 5 on Node.js 22 (Next.js 16 App Router; Server Components + Server Actions). No language version change vs phase 2.

**Primary Dependencies**: Next.js 16, React 19, shadcn/ui (Radix primitives), Tailwind CSS, `lucide-react`, `@supabase/supabase-js` (existing typed clients in `lib/db/`). No new runtime dependencies. The bill print path uses the browser's built-in `window.print()` against a CSS `@media print` block — no PDF library, no thermal-printer driver.

**Storage**: Supabase Postgres (hosted preview + prod). One new migration `0005_cart_polish.sql`. Schema changes: extends `ticket_items` (enum + 2 new columns + 2 columns relaxed to nullable + 1 new CHECK constraint), extends `services` (1 new column), creates `settings` (new table). The migration is auto-applied by the existing `.github/workflows/db-migrate-{preview,prod}.yml` actions (Constitution § Schema drift forbidden). No new RLS principals — `settings` uses the same `select-to-authenticated` policy pattern; writes go through the service-role client. The `pos_take_cash` RPC is ALTERed in the same migration to handle the new "total after discounts" floor.

**Testing**: Vitest unit suite covers (a) the cart-totals helper extended to fold discount lines (`computeTotals(items)` — fixed-only / fixed+unconfirmed / fixed+flat-discount / fixed+percent-discount / fixed+discount-larger-than-subtotal → floored at zero), (b) the new `setLinePrice`, `addDiscountLine`, and `removeDiscountLine` Server Actions against a mocked supabase service-role client (kind-conditional CHECK exercised by error-path tests), (c) the percent-discount recompute behavior when service lines are added/removed/repriced before charge (SC-004). Playwright e2e suite adds four new specs: `checkout-variable-price.spec.ts` (US1 — auto-open, presets, adjusters, numpad, Save enables Charge), `checkout-price-override.spec.ts` (US2 — override on confirmed row; catalog row untouched), `checkout-discount.spec.ts` (US3 — flat + percent + note rendering + Charge floored-to-zero guard), `checkout-bill.spec.ts` (US4 — bill sheet opens, snapshot, print stylesheet hides chrome, Email writes audit row + toasts success). All e2e tests follow the existing `tests/e2e/_db.ts` cursor pattern (`newAuditCursor()` / `getAuditLogRowsSince()`) so the audit assertions don't race across workers.

**Target Platform**: Studio web shell on desktop browsers (Chromium/Safari/Firefox latest), shared salon devices (tablet/laptop class, landscape). Same surface profile as phase 2; the bill print path additionally exercises the browser's print dialog, which is uniformly available across the supported browsers.

**Project Type**: Web application — single Next.js app (no separate backend repo). Files live under `app/(studio)/checkout/`, `components/lacquer/checkout/`, `lib/auth/`, `styles/` (the existing `checkout.css` gains a print-only block scoped to the bill DOM), `supabase/migrations/`, and `tests/`. Phase 2's structure is unchanged; this phase adds files alongside existing ones.

**Performance Goals**: Bill-sheet open under 1s perceived latency from cart click (SC-006) — the sheet renders a server-snapshot of the cart already in memory, no extra DB roundtrip. Discount add / remove flows through a Server Action and rerenders the cart in well under 200ms under normal preview-DB conditions (cart totals recompute is the same single-query pattern as `recomputeTicketTotals` in phase 2). Price-sheet Save uses the same Server Action profile.

**Constraints**: Constitution Principle I — every visual value resolves to a token in `styles/tokens.css`; the price sheet, discount sheet, and bill sheet are 1:1 adaptations of the prototype components (no redraw); icons remain Lucide at 1.5px stroke (Mail and Printer icons are the two new ones, already defined inline in `FlowSingleExtras.jsx` as a fallback — this plan adopts the official Lucide imports, since the studio already pulls from `lucide-react`); tabular numerals on every currency render including the bill's suggested-gratuity all-in column. Principle II — every mutation is a Server Action; the discount-line write goes through the service-role client; the stub email action enforces server-side validation of the address shape regardless of client-side validation (FR-026). Principle III — audit emissions for `line.price_set`, `discount.added`, `discount.removed`, and `bill.emailed`; service catalog rows are never modified by a price override (FR-011); discount lines carry their own snapshotted `name_snapshot` (and optional `note`); the `pos_take_cash` RPC continues to read `tickets.total_cents` inside its FOR-UPDATE lock so the discount lines' contribution is summed by the server, not the client. Principle IV — Vitest + Playwright coverage as listed above, written red→green before the implementation that satisfies them. Principle V — the spec's Out of Scope section is normative; no manager-PIN UI, no real outbound email, no per-row quantity, no `product` kind.

**Scale/Scope**: One new migration (1 enum add, 2 column adds, 1 column add + 2 column relaxes + 1 CHECK on existing table, 1 new table). Three new Server Actions plus one stub-email action and one ALTER FUNCTION in the migration. Two new `components/lacquer/checkout/*` components (`price-sheet.tsx`, `bill-sheet.tsx`) replacing the existing placeholder dialog. The existing `cart-row-with-tech.tsx` gets a new `+ Discount` affordance in the cart header and a Note display under discount rows; the existing `checkout-screen.client.tsx` orchestrates the new sheets. ~5 new test files. Estimated ~700–900 LOC net change including the migration. No new top-level directories, no new dependencies.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.0.3.

| Principle | Status | How this plan satisfies it |
|-----------|--------|----------------------------|
| **I. Design System Fidelity (NON-NEGOTIABLE)** | PASS | `price-sheet.tsx` is adapted 1:1 from `design-system/prototypes/transaction/components.jsx::PriceSheet` (quick adjusters, presets, numpad-on-tap, Remove visibility rule). `bill-sheet.tsx` is adapted 1:1 from `design-system/prototypes/transaction/FlowSingleExtras.jsx::BillSheet` (masthead, meta block, itemized list, totals, suggested-gratuity 18/20/25). Discount sheet is a small new piece composed of existing shadcn/ui primitives (Dialog + RadioGroup + Input + Label) and follows the same token-scoped class names used by the rest of `components/lacquer/checkout/*`. The new affordances in the cart header (+ Discount) and footer (Bill) reuse `tx-btn` and `tx-link` token-styled buttons already in `checkout.css`. The two new Lucide icons (Mail, Printer) replace the inline SVG fallbacks from the prototype, sized 16/20/24 at 1.5px stroke. Side-by-side comparison against the prototype is the first verification step in `quickstart.md`. |
| **II. Server-Authoritative Architecture** | PASS | The four new mutating actions (`setLinePrice`, `addDiscountLine`, `removeDiscountLine`, `emailBillStub`) are Server Actions colocated in `app/(studio)/checkout/actions.ts`. The client island never writes to Supabase. The discount-percent recompute on subsequent service-line edits is server-side (the existing `recomputeTicketTotals` helper extends to fold discount lines and re-derive any percent discount's amount from the live `service_subtotal` at the moment of the write). The `pos_take_cash` RPC's pre-charge re-read of `tickets.total_cents` keeps the money invariant under the server's control even if the client's view is stale. `emailBillStub` enforces server-side address validation (defense in depth against bypassing client validation) before writing the `bill.emailed` audit row — and it is the only path to that audit verb. No new authorization surface; per FR-033 every action remains gated only on `requireStudioSession()`. |
| **III. Auditability & Money Integrity (NON-NEGOTIABLE)** | PASS | **Snapshotting**: discount lines carry their own `name_snapshot` (and optional `note`); the row never references a live catalog row, so it cannot drift. Price overrides write a new `unit_price_cents` to `ticket_items` without touching `services`. **Money invariants**: discount lines' negative `unit_price_cents` (or recomputed percent amount) is summed by `recomputeTicketTotals`; `pos_take_cash` re-reads the server-side total under FOR UPDATE; the `ticket_empty` guard in the RPC (already in place from phase 2 — `amount_cents > 0`) catches the over-discount case (FR-017) so a charge cannot fire at $0. **Audit**: four new verbs (`line.price_set`, `discount.added`, `discount.removed`, `bill.emailed`) added to the `AuditAction` union in `lib/auth/audit.ts`; `deriveEntityType` extends to map `bill.*` → `"ticket"` (the bill is a view of a ticket, not its own entity). Each mutating Server Action emits exactly one audit row per successful write; `bill.emailed` is emitted only on the success branch (validation failures emit nothing — they are not "mutations"). **Idempotency**: not needed here (no Square calls, no external API). **No silent money loss**: discount lines that drive total negative are floored in display AND in the RPC; the operator must reduce or remove the discount to charge. |
| **IV. Test-First for Critical Paths** | PASS | Charge eligibility (the FR-017 floor; the FR-010 unconfirmed-line gate) is a money critical path. Test order: (a) Vitest unit on `computeTotals(items)` with discount kinds — fixed-only / fixed+unconfirmed / fixed+flat-discount / fixed+percent / fixed+over-discount-floored-to-zero — red, then green. (b) Vitest unit on `setLinePrice`, `addDiscountLine`, `removeDiscountLine` against a mocked supabase service-role client — including the kind-conditional CHECK violation (insert a discount with `ref_id` set → expect Postgres error → typed throw) and the percent-discount recompute when a service line is appended after the discount lands. (c) Playwright `checkout-variable-price.spec.ts` — auto-open on add of `variable=true` service; preset chip sets value; +$5 adjuster nudges; numpad replaces; Save clears highlight, Charge enables. (d) Playwright `checkout-price-override.spec.ts` — tap a confirmed row's price button; price sheet shows no Remove; Save mutates only that row; the catalog row is unchanged (asserted by re-adding the service to a fresh ticket). (e) Playwright `checkout-discount.spec.ts` — flat discount with note → row shows note; percent discount with service-line edits → amount recomputes; over-discount → Charge disabled, total floored to $0. (f) Playwright `checkout-bill.spec.ts` — bill sheet snapshot under cart edits, print stylesheet hides studio chrome (Playwright `page.emulateMedia({ media: 'print' })` asserts `.studio-chrome` is hidden), Email submit writes audit row + toasts (asserted via `getAuditLogRowsSince()`). All e2e tests carry a `US{n}` describe-name suffix so the scoped intermediate gate from CLAUDE.md works (`-g "US1"` runs only the variable-price spec). |
| **V. Scope Discipline & Cost Restraint** | PASS | The spec's Out of Scope section is the normative scope guard for this plan. Specifically: no manager-PIN UI (only the threshold read), no real outbound email (the stub action returns success without dispatch), no per-row quantity controls, no `product` kind on `ticket_items`, no tax change (still $0), no Realtime, no operator-facing settings admin UI. The new `settings` table is seeded with safe defaults; the only key the runtime READS for behavior (vs the bill masthead, which is render-only) is `discount.manager_threshold_cents`, and the read is a one-line `getSetting('discount.manager_threshold_cents')` call whose return is ignored in v1 — the wire is in place so phase 8 can add the override prompt with no further plumbing. No new runtime dependencies. No new infrastructure. |

**Initial gate: PASS.** Re-checked after Phase 1 design — see "Post-design Constitution Re-check" below.

## Project Structure

### Documentation (this feature)

```text
specs/013-cart-polish/
├── plan.md                # This file
├── research.md            # Phase 0 — decisions: variable-price re-open strategy, discount recompute timing, settings shape, print-only CSS scoping, bill snapshot, email stub
├── data-model.md          # Phase 1 — 0005 migration shape: ticket_items extensions, services.presets, settings, RPC ALTER
├── contracts/
│   ├── server-actions.md  # Phase 1 — four new Server Action signatures + invariants
│   └── audit.contract.md  # Phase 1 — new AuditAction verbs (line.price_set, discount.added, discount.removed, bill.emailed)
├── quickstart.md          # Phase 1 — developer "build, run, verify" walkthrough
├── checklists/
│   └── requirements.md    # Spec quality checklist (from /speckit-specify)
└── spec.md                # /speckit-specify + /speckit-clarify output
```

### Source Code (repository root)

```text
supabase/
└── migrations/
    └── 0005_cart_polish.sql                       # NEW — see data-model.md
        # - ALTER TYPE public.ticket_item_kind ADD VALUE 'discount'
        # - ALTER TABLE public.ticket_items ADD COLUMN discount_pct numeric(5,2) NULL
        # - ALTER TABLE public.ticket_items ADD COLUMN note text NULL CHECK (length(coalesce(note,'')) <= 80)
        # - ALTER TABLE public.ticket_items ALTER COLUMN ref_id DROP NOT NULL
        # - ALTER TABLE public.ticket_items ALTER COLUMN assigned_staff_id DROP NOT NULL
        # - ALTER TABLE public.ticket_items ADD CONSTRAINT ticket_items_kind_columns_chk
        #     CHECK ((kind = 'service' AND ref_id IS NOT NULL AND assigned_staff_id IS NOT NULL AND discount_pct IS NULL)
        #         OR (kind = 'discount' AND ref_id IS NULL AND assigned_staff_id IS NULL))
        # - ALTER TABLE public.services ADD COLUMN presets jsonb NULL
        #     CHECK (presets IS NULL OR jsonb_typeof(presets) = 'array')
        # - CREATE TABLE public.settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz default now())
        # - RLS: select-to-authenticated on settings (matches the 0003/0004 pattern)
        # - INSERT INTO public.settings (key, value) VALUES seed rows for salon.name/address/phone + discount.manager_threshold_cents (jsonb null)
        # - CREATE OR REPLACE FUNCTION pos_take_cash(...) ... [same body as 0004 — already floors at total > 0 via 'ticket_empty' guard; no change needed]
        # - SAMPLE: a single `variable_price=true` row in 0003's seed (added by the seed update below) gains presets
supabase/
└── seed.sql                                       # MODIFY — seed presets onto the existing 'Nail art · medium' service row;
                                                  # seed settings row defaults

app/(studio)/checkout/
├── actions.ts                                     # MODIFY — add four Server Actions:
│                                                  #   setLinePrice({ ticketId, lineId, unitPriceCents })
│                                                  #   addDiscountLine({ ticketId, shape: 'flat'|'percent', value, note? })
│                                                  #   removeDiscountLine({ ticketId, lineId })
│                                                  #   emailBillStub({ ticketId, address, snapshot })
│                                                  # Extend `recomputeTicketTotals` to fold discount lines (kind='discount')
│                                                  # and recompute percent discounts against the live service-line subtotal.
├── _errors.ts                                     # MODIFY — add 3 new typed errors:
│                                                  #   InvalidPriceError, DiscountInvalidError, EmailAddressInvalidError
├── checkout.css                                   # MODIFY — add print-only block scoped to .lacquer-bill-doc:
│                                                  #   @media print {
│                                                  #     body * { visibility: hidden; }
│                                                  #     .lacquer-bill-doc, .lacquer-bill-doc * { visibility: visible; }
│                                                  #     .lacquer-bill-doc { position: absolute; inset: 0; }
│                                                  #   }
│                                                  # Plus the small adjustments to keep the bill at 80mm-equivalent width.
└── [ticketId]/
    └── checkout-screen.client.tsx                 # MODIFY — three concerns:
                                                  #   1) Wire auto-open of the price sheet on add of a variable service
                                                  #      (driven by the `addServiceLine` result's price_unconfirmed flag).
                                                  #   2) Add cart-header "+ Discount" affordance and footer "Bill" button.
                                                  #   3) Mount <PriceSheet/>, <DiscountSheet/>, <BillSheet/> as modals
                                                  #      controlled by local state; pass the cart snapshot to BillSheet
                                                  #      so it freezes its render at open time (FR-022).

components/lacquer/checkout/
├── price-sheet.tsx                                # NEW — adapted from prototype's PriceSheet:
│                                                  #   - props: { item: CartLine, isOverride: boolean, onSave, onCancel, onRemove? }
│                                                  #   - Remove rendered only when !isOverride AND item.price_unconfirmed
│                                                  #   - Quick adjusters −10/−5/+5/+10/+20 clamped at 0
│                                                  #   - Presets row rendered only when item.service?.presets length > 0
│                                                  #   - Numpad-on-tap with fresh-edit behavior
├── discount-sheet.tsx                             # NEW — small sheet:
│                                                  #   - Shape toggle: 'flat' | 'percent' (RadioGroup)
│                                                  #   - Amount input (currency for flat, integer 0-100 for percent)
│                                                  #   - Optional note input (max 80 chars; counter)
│                                                  #   - Save / Cancel
├── bill-sheet.tsx                                 # NEW — adapted from prototype's BillSheet:
│                                                  #   - Takes a frozen cart snapshot (rendered from the cart at open time)
│                                                  #   - Reads salon.name/address/phone from settings (passed as prop —
│                                                  #     the RSC parent fetches once)
│                                                  #   - Items list, totals, suggested-gratuity 18/20/25
│                                                  #   - Bottom-bar buttons: Print bill, Email
│                                                  #   - Print invokes window.print() — the @media print CSS does the rest
│                                                  #   - Email opens <EmailBillDialog/> below
├── email-bill-dialog.tsx                          # NEW — small dialog with one email input + Send button
│                                                  #   client-validates the address shape; on submit calls emailBillStub
│                                                  #   Server Action; on success closes and toasts; on failure shows
│                                                  #   inline error.
└── variable-price-placeholder-dialog.tsx          # DELETE — replaced by price-sheet.tsx
                                                  # (the FR-016 placeholder from phase 2 is no longer needed)

components/lacquer/checkout/cart-row-with-tech.tsx # MODIFY — three additions:
                                                  #   1) Tap-on-price-button opens <PriceSheet isOverride={!row.price_unconfirmed}/>
                                                  #      (replacing the placeholder dialog wire-up)
                                                  #   2) For kind='discount' rows: render as a discount row layout
                                                  #      (name + optional note + negative amount in destructive token)
                                                  #   3) Highlight ring on rows where price_unconfirmed = true
                                                  #      (matches the prototype's .variable class)

lib/auth/
└── audit.ts                                       # MODIFY — extend AuditAction with four new verbs:
                                                  #   "line.price_set", "discount.added", "discount.removed", "bill.emailed"
                                                  # Extend deriveEntityType:
                                                  #   action.startsWith("line.")     → "ticket"  (line is a row on a ticket)
                                                  #   action.startsWith("discount.") → "ticket"  (discount is a row on a ticket)
                                                  #   action.startsWith("bill.")     → "ticket"  (bill is a view of a ticket)

lib/settings/
└── read.ts                                        # NEW — a tiny server-only helper:
                                                  #   export async function getSetting<T>(key: string): Promise<T | null>
                                                  # Reads from public.settings via the service-role client. Used by:
                                                  #   - the bill RSC to fetch salon.name/address/phone in one go
                                                  #   - addDiscountLine to read discount.manager_threshold_cents
                                                  # (Wired but its return is ignored in v1 per FR-018; phase 8 plugs in the UI.)

lib/db/
└── types.ts                                       # MODIFY — regenerate from updated schema via `supabase gen types typescript`.

tests/
├── unit/
│   └── checkout/
│       ├── cart-totals.test.ts                    # MODIFY (existing from phase 2) — add cases:
│       │                                          #   fixed + flat-discount, fixed + percent-discount,
│       │                                          #   over-discount-floored-to-zero, percent recompute on subtotal change.
│       ├── set-line-price-action.test.ts          # NEW — mocked supabase; happy path; refuses on kind='discount' (CHECK).
│       ├── add-discount-line-action.test.ts       # NEW — flat + percent + note persistence; refuses on negative amount.
│       └── email-bill-stub-action.test.ts         # NEW — invalid address → throws without audit; valid → returns success +
│                                                  # audit row (asserted via mocked recordAudit).
└── e2e/
    ├── checkout-variable-price.spec.ts            # NEW — US1 happy path: tile tap auto-opens sheet; preset, adjuster, numpad,
    │                                                # Save; Charge button transitions disabled → enabled.
    ├── checkout-price-override.spec.ts            # NEW — US2: override a fixed-price row; catalog row unaffected.
    ├── checkout-discount.spec.ts                  # NEW — US3: flat + note; percent that recomputes on service-line edit;
    │                                                # over-discount disables Charge.
    └── checkout-bill.spec.ts                      # NEW — US4: bill sheet opens, snapshot, print-CSS chrome hidden,
                                                  # Email writes audit + toasts success.

CLAUDE.md                                          # MODIFY — point the SPECKIT marker to specs/013-cart-polish/plan.md
```

**Structure Decision**: Single Next.js project — Option 1 from the template. Phase 2 already created the route group (`/checkout` + `/checkout/[ticketId]` + receipt subroute) and the `components/lacquer/checkout/` subfolder; this phase adds files alongside them and modifies the client island + the actions module. No new top-level directories. The one genuinely new home is `lib/settings/read.ts`, mirroring the pattern of small server-only helpers like `lib/dashboard/`.

## Phase 0 — Research

See [research.md](./research.md). Summary:

1. **Variable-price sheet open paths**: a single `<PriceSheet/>` component handles three open paths driven by the parent — auto-open on add of a `variable=true` service (set by `addServiceLine` returning `price_unconfirmed: true`), tap-price-button on an unconfirmed row, tap-price-button on a confirmed row (override). The Remove button is rendered only when `!isOverride && item.price_unconfirmed`; Cancel always just closes the sheet (per clarification). Save calls `setLinePrice` which writes the new `unit_price_cents` and flips `price_unconfirmed = false`.
2. **Discount-percent recompute timing**: percent-discount amount is recomputed server-side on every cart mutation. `recomputeTicketTotals` is extended to (a) sum service-line subtotal first, (b) for each percent discount line, write back `unit_price_cents = -(pct/100 * service_subtotal)` to the discount row, (c) re-derive `tickets.subtotal_cents` and `tickets.total_cents = max(0, service_subtotal + sum(discount unit_price_cents))`. The floored-at-zero rule lives in the totals helper AND in `pos_take_cash`'s existing `ticket_empty` guard.
3. **Settings table shape**: single-row-per-key with a JSONB value column (`key text primary key, value jsonb not null`). JSONB gives us typed values without a column-per-type table; the helper does `value` as the generic. Migration seeds four keys: `salon.name`, `salon.address`, `salon.phone`, `discount.manager_threshold_cents` (null for v1, indicating no threshold).
4. **Print-only stylesheet scoping**: a top-level `@media print` block in `app/(studio)/checkout/checkout.css` that hides everything except `.lacquer-bill-doc` (and its children) via the `visibility: hidden / visible` trick, then positions the bill at `inset: 0`. This avoids the existing receipt route's `.studio-chrome` selector clash (the receipt page already uses a different print path; the bill is layered on top of the studio chrome, not in a chrome-less route).
5. **Bill snapshot semantics**: the BillSheet receives a `frozenLines` prop captured by the parent in `useState` at open time. Cart edits underneath do NOT mutate the snapshot; closing and re-opening the sheet calls the snapshot helper again. Print prints what the sheet shows.
6. **Stub email Server Action**: `emailBillStub` validates the address with a small RFC-5322-lite regex (server-side, mirroring the client-side check), writes the `bill.emailed` audit row with `payload = { address, line_snapshot }`, and returns `{ ok: true }`. No external network call. Phase post-v1 swaps in real mail by changing the action body; the contract (and the audit verb) stays.
7. **Prototype mapping**: `PriceSheet` (components.jsx), `BillSheet` (FlowSingleExtras.jsx). The discount sheet has no prototype — it's a small new piece composed from shadcn/ui primitives that follow the same tokens, with the visual language of the other small sheets in `components/lacquer/checkout/`.
8. **Audit-log additions**: four new verbs (`line.price_set`, `discount.added`, `discount.removed`, `bill.emailed`), all of `entity_type = 'ticket'`. No schema change to `audit_log`. The `deriveEntityType` helper gains three prefix branches.

## Phase 1 — Design & Contracts

**Prerequisites**: `research.md` complete.

### Entities → data-model.md

See [data-model.md](./data-model.md). The migration `0005_cart_polish.sql` extends three existing entities and adds one new one:

- **ticket_items (extended)** — `kind` enum gains `'discount'`; new nullable columns `discount_pct numeric(5,2)` (carries the percent so the amount can be recomputed on later service-line edits) and `note text` (max 80 chars, used by discount rows for the optional reason); `ref_id` and `assigned_staff_id` relaxed to nullable; a single CHECK constraint `ticket_items_kind_columns_chk` enforces the kind-conditional shape (service rows: both required, `discount_pct` must be null; discount rows: both forbidden).
- **services (extended)** — new nullable `presets jsonb` column (array of `{ label, price_cents }` objects). The migration ships with a `CHECK (jsonb_typeof(presets) = 'array')` guard. The seed file gains a presets array on the existing `Nail art · medium` row so the e2e tests have a target.
- **settings (NEW)** — single-row-per-key: `key text primary key`, `value jsonb not null`, `updated_at timestamptz default now()`. RLS: `select-to-authenticated` (matches the 0003/0004 pattern); writes go through the service-role client. Migration seeds four keys (`salon.name`, `salon.address`, `salon.phone`, `discount.manager_threshold_cents`).
- **pos_take_cash (RPC, unchanged)** — the existing function already refuses to charge on `total_cents <= 0` (the `ticket_empty` guard). The migration re-creates it with `CREATE OR REPLACE` to keep grants/permissions stable; no behavioral change is required because the discount-floor lives in `recomputeTicketTotals` (the RPC reads the post-floor `total_cents`).

### Interface contracts → contracts/

See [contracts/server-actions.md](./contracts/server-actions.md) and [contracts/audit.contract.md](./contracts/audit.contract.md).

The four new Server Actions and their invariants:

| Action | Invariant |
|---|---|
| `setLinePrice(input)` | Refuses if ticket is not `open` (`TicketNotOpenError`); refuses if `unitPriceCents <= 0` (`InvalidPriceError`); refuses if the named line is `kind='discount'` (price overrides apply to service lines only). Updates `unit_price_cents` and `price_unconfirmed = false` on the named row; recomputes ticket totals (the recompute folds the new price into the percent-discount recompute on any discount lines). Emits `line.price_set`, entity = `lineId`, payload `{ ticket_id, previous_unit_price_cents, new_unit_price_cents, was_unconfirmed }`. |
| `addDiscountLine(input)` | Refuses if ticket is not `open`. For `shape='flat'`: refuses if `value <= 0`. For `shape='percent'`: refuses if `value < 1` or `value > 100`. Reads `discount.manager_threshold_cents` (the read is wired but its return is ignored in v1 per FR-018). Inserts a `ticket_items` row with `kind='discount'`, `ref_id=null`, `assigned_staff_id=null`, `name_snapshot` from a small naming helper (`"Discount"` for flat, `"Discount · {pct}%"` for percent), `unit_price_cents` = the negative amount (recomputed by the totals helper for percent), `discount_pct` = the percent (null for flat), `note` from the input (nullable). Recomputes totals. Emits `discount.added`, entity = new `ticket_items.id`, payload `{ ticket_id, shape, value, note }`. |
| `removeDiscountLine(input)` | Refuses if ticket is not `open`; refuses if the named line is not `kind='discount'`. Deletes the row; recomputes totals. Emits `discount.removed`, entity = the deleted `lineId`, payload `{ ticket_id, shape, value, note }`. |
| `emailBillStub(input)` | Validates the address with the same RFC-5322-lite regex used by the client (server-side; defense in depth). On valid: writes the `bill.emailed` audit row with `entity_id = ticketId` and `payload = { address, line_snapshot }`, returns `{ ok: true }`. On invalid: throws `EmailAddressInvalidError` without inserting any audit row. Does NOT dispatch real mail in this phase. |

No public HTTP API, no webhook, no CLI — this is a studio-internal feature, same as phase 2.

### Quickstart → quickstart.md

See [quickstart.md](./quickstart.md). It walks an implementer through applying `0005_cart_polish.sql` locally, running the new unit + e2e tests, completing the variable-price loop / discount add / bill print by hand, and the local gate set.

### Agent context update

`CLAUDE.md`'s `<!-- SPECKIT START -->` block is updated to point at this plan in the same change set (the final write of `/speckit-plan`):

```text
<!-- SPECKIT START -->
Active feature plan: `specs/013-cart-polish/plan.md` — read it for the
current feature's technical context, project structure, and build steps.
<!-- SPECKIT END -->
```

### Post-design Constitution Re-check

| Principle | Re-check | Notes |
|-----------|----------|-------|
| I. Design System Fidelity | PASS | Phase 1 artifacts (data-model.md, contracts/, quickstart.md) name only existing tokens, the two new Lucide icons (Mail, Printer), and the two prototype components being adapted. Discount sheet composition is shadcn/ui primitives only. |
| II. Server-Authoritative | PASS | The four new Server Actions all run via the service-role client; `recomputeTicketTotals`'s percent-discount recompute is server-only; `emailBillStub` validates address server-side. |
| III. Auditability & Money Integrity | PASS | Audit verbs and emission points are concrete in `audit.contract.md`. The discount-line floor (FR-017) is enforced in two places: `recomputeTicketTotals` (display total) and `pos_take_cash` (charge guard). Snapshot fields (`name_snapshot`, `unit_price_cents`) are written at insert and never mutated by later service-catalog edits. |
| IV. Test-First | PASS | `quickstart.md` sequences red→green for the cart-totals unit cases, the three new action units, the email-stub unit, then the four Playwright specs. |
| V. Scope Discipline | PASS | All Out-of-Scope items remain out. No new dependencies, no new infrastructure, no new authorization surface. The settings table is a single new table, sized to the four keys this phase needs. |

**Re-check: PASS.**

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

No violations identified — the constitution check passes cleanly in both passes. The plan extends two existing tables (no new tables in the cart hot path), reuses the existing RPC, reuses the existing audit helper pattern, and adds only the one new helper (`lib/settings/read.ts`) the bill RSC and the discount-save path both call.

The one decision that warrants a one-line note (not a violation): `settings.value` is `jsonb` rather than `text` to support both string keys (`salon.name`) and integer keys (`discount.manager_threshold_cents`) without a column-per-type table. This trades the cost of a JSON cast at read time for schema simplicity, and matches the existing pattern of using JSONB on `audit_log.payload`.
