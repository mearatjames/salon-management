# Services Page redesign — phased `/speckit-specify` prompts

Source design: `https://api.anthropic.com/v1/design/h/UfMaeHHNrPDPrx6K-N_PSg?open_file=Services+Page.html`
Variation chosen by the user: **V1 · Refined two-pane** (V2 "Payout-first table" was a comparison fork — not what we're building).

Builds on the existing implementation in feature `008-services-catalog`.

## What the design proposes

The handoff is "Services Page · with card fee + supply deductions." It introduces three new concerns on top of today's `/services` catalog:

1. **Per-service card fee** — hybrid mode: `default` (uses global) · `custom` (per-service amount) · `exempt`
2. **Per-service supply deduction** — flat cents amount + free-text label (e.g. "GelX tips & gel"), always applies regardless of payment method
3. **Global salon policy** — default card-fee amount, which payment methods trigger it, which categories opt in by default, and which techs are exempt from all deductions

Plus a **layout shift**: today's "list + drawer overlay" becomes **list-left + always-visible edit-panel-right**, with a slim **policy strip** above and the **Edit Policy sheet** (560px right-side) for the global controls. Deduction chips appear inline on rows; the edit panel shows a live "Net to tech (card)" preview.

Explicitly out of scope per the design's own rationale card: pedi-tier deductions, and any downstream consumer (checkout / payouts) that actually *uses* these values.

## Recommended phased chunking

Too big for one spec. Three phases, each independently shippable:

| Phase | Spec branch | What ships |
|---|---|---|
| **1** | `021-services-deductions-per-service` | DB columns, two-pane refactor, Deductions section in edit panel, deduction chips on rows, live net-to-tech preview. Card fee `default` mode resolves against a hard-coded `$3` for now. |
| **2** | `022-services-policy-sheet` | `salon_policy` table (or settings rows), policy strip on `/services`, `EditPolicySheet`, exempt techs, default amount/methods/categories editable. `default` mode now resolves against this policy. |
| **3** (future) | `023-deductions-checkout-payout` | Apply effective card-fee + supply + exempt-tech rules at checkout / payout time. Genuinely separate feature — defer until 1 and 2 are merged. |

## Prerequisite — refresh the vendored design system

Before running `/speckit-specify` on either phase, copy these from the design handoff into `design-system/` (per CLAUDE.md's "re-export the handoff zip and replace `design-system/`" instructions):

- `Services Page.html`
- `ServicesV1.jsx`
- `ServicesV2.jsx`
- `EditPolicySheet.jsx`
- `services-data.jsx`
- Updated `colors_and_type.css` (the new `--avatar-purple/teal/orange/slate` OKLCH tokens)

Without this, `/speckit-plan` and the `speckit-design-auditor` can't read the prototypes the specs reference.

## Prompts to feed into `/speckit-specify`

### Phase 1 — Per-service deductions + two-pane layout

```
Upgrade the existing Services catalog (`/services`, feature 008) with
per-service deductions and refactor the layout from drawer-overlay to
two-pane. Reference design: `design-system/Services Page.html` /
`ServicesV1.jsx` (the "V1 · Refined two-pane" variation — V2 is a
comparison fork and is NOT what we're building).

What it does: each service gains two new concepts. (1) Card fee with
three modes — `default` (a hardcoded $3 for this phase; Phase 2 will
make it a global policy), `custom` (per-service cents amount), and
`exempt` (no card fee, ever). (2) Supply deduction: a flat cents
amount plus a short free-text label (e.g. "GelX tips & gel", "Chrome
powder", "OPI bottle wear"). Supply applies regardless of payment
method; card fee applies when paid by card or gift card. Neither value
is consumed by checkout yet — this phase only captures and displays
them.

UI changes: replace the current right-side drawer with a two-pane
layout — grouped catalog list on the left (~440px), always-visible
edit panel on the right, like the design's V1. The "Add service"
button reveals the edit panel in add-mode with a fresh draft;
clicking a list row reveals it in edit-mode for that service.
List rows gain small deduction chips inline (e.g. blue "$3 card fee",
amber "$5 GelX tips & gel", muted "No fees" for exempt). The edit
panel keeps the existing fields (name/category/duration/price/color/
taxable/variable-price) and adds a new "Deductions" section with:
a segmented `Default · Custom · Exempt` control for card fee, a
toggle + amount + label row for supply, and a live "Net to tech
(card)" preview that subtracts the effective card fee + supply from
the service price.

Entry point: same as today, `/services`. Reuse: the existing list +
edit primitives in `components/lacquer/services/*`, the validators
in `_validation.ts`, and the Server Action in `actions.ts` — extend
them, don't replace. Pull layout idioms (always-visible panel,
deduction chip styling, segmented control, color tokens) directly
from `design-system/ServicesV1.jsx`. Per-tech staff assignments
stay deferred (matches the 008 amendment).

DB: migration adds `card_fee_mode` (enum: default/custom/exempt,
default 'default'), `card_fee_custom_cents` (int, nullable),
`supply_amount_cents` (int, nullable), and `supply_label` (text,
nullable) to the `services` table. CHECK constraints: `custom_cents`
is non-null iff `mode = 'custom'`; supply amount and label are both
non-null or both null. Existing services backfill to `mode =
'default'` and `supply = null`.

Authorization: unchanged — owner/manager can write deductions,
technicians/front-desk see them read-only. The Server Action
validates and writes; an `audit_log` row with
`action='settings.updated'` records the change.

Out of scope: global policy entity and the policy strip / Edit Policy
sheet (Phase 2). Wiring deductions into checkout, receipts, or
payouts (Phase 3). Pedi-tier deductions from the Day Report
prototype. V2 payout-first table. Per-tech staff assignments
(remain deferred).
```

### Phase 2 — Global policy + Policy strip + Edit Policy sheet

```
Add the global salon deductions policy and surface it on the
Services page. Reference design: `design-system/EditPolicySheet.jsx`
and the policy strip in `design-system/ServicesV1.jsx`. Builds on
Phase 1 (per-service `default` card-fee mode now resolves against
this policy instead of the hardcoded $3).

What it does: introduces a single salon-wide deductions policy with
four knobs. (1) `card_fee_default_cents` — the default amount taken
from a tech's payout per qualifying service (e.g. $3). (2)
`card_fee_methods` — which payment methods trigger the default fee
(Card, Gift card, Cash, Venmo/Zelle). (3) `card_fee_categories` —
which service categories opt in by default (Manicure, Pedicure,
Enhancement, etc.). (4) `exempt_tech_ids` — staff who never have any
deduction taken (typically owners, family, senior leads). Per-
service overrides from Phase 1 always beat the policy: a service
flagged `custom` or `exempt` ignores the policy default and method/
category filters.

UI changes: on `/services`, add a slim 4-column policy strip above
the two-pane body — `Card fee default · Supply deductions count ·
Exempt techs (avatars) · Edit policy ›`. "Edit policy" opens a
560px right-side animated sheet (mount: 200ms; Esc/scrim/X close)
with three sections matching the prototype: (a) Card fee default —
amount input, payment-method chip multi-select, 2-column category
checkbox grid showing the count of active services per category,
and a small "default · custom · exempt" summary row computed live.
(b) Exempt techs — chips with avatar + role + remove, plus an
inline searchable picker that adds techs from the staff roster.
(c) Supply deductions — read-only roll-up of active services with
a supply line, each row jumps to that service in the edit panel
and closes the sheet. Sheet save is gated on dirty state.

Net-to-tech preview in the per-service edit panel now uses the
policy default + methods + categories when resolving `default` mode.

Entry point: `/services` (same page; sheet overlays it). Reuse:
existing two-pane layout, the validators, and the `audit_log` write
pattern.

DB: migration creates a single-row `salon_policy` table (or, if
cleaner given existing conventions, extends a singleton settings
table) with `card_fee_default_cents int`, `card_fee_methods text[]`,
`card_fee_categories text[]`, and a join table `exempt_techs (staff_id
fk, …)`. Seed the row at migration time with sensible defaults
($3 / Card+Gift / all primary categories / no exempt techs). The
Server Action that writes the policy is owner-only (manager can read
but not write — confirm against `staff.role` semantics in existing
permissions.ts).

Authorization: only owner can edit the policy (single-tenant
salon-wide setting feels higher-stakes than per-service edits).
Manager and below can read; technician/front-desk see the policy
strip but the "Edit policy" affordance is hidden. Every save writes
an `audit_log` row with `action='settings.updated'` and a payload
diff so we can trace policy changes.

Out of scope: applying these policy values to actual checkout / cash
totals / payouts (Phase 3 — a separate feature). Per-payment-method
deductions on cash/Venmo (UI captures the option, but Phase 3 will
decide how cash treatment actually flows through). Historical
recompute — the sheet copy already explains "changes take effect on
new appointments and payouts; settled days are not recalculated."
```

### Phase 3 — Apply deductions in checkout/payout (deferred)

Hold off on writing this `/speckit-specify` prompt until Phases 1 and 2 are merged. By then the exact contract for "what's the effective card fee + supply for service S, paid by method M, performed by tech T?" will be locked in, and the spec can be tight. Listed here so it isn't forgotten.
