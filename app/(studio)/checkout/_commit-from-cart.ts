// Server-side input contract + canonical-totals resolver for
// `/checkout` commit Server Actions (US1 cash/gift, US2 card, US3
// split). Every commit action must:
//
//   1. Validate the wire payload with `commitCartSchema` (rejects on
//      malformed UUIDs, empty items, out-of-range discounts, etc.).
//   2. Pass the parsed input into `resolveCartForCommit`, which
//      re-reads price/duration/name from the `services` table,
//      verifies tech + customer are active, and computes canonical
//      money values. The CLIENT preview totals are NEVER trusted at
//      money-time — Constitution Principle II.
//   3. Commit using the resolver's `resolved` payload as the source
//      of truth for `tickets`/`ticket_items` inserts.
//
// The resolver returns a discriminated union so each action can map
// `ok: false` codes to its own user-facing error toast.

import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

// Loose UUID validator. Zod v4's `.uuid()` enforces strict RFC 4122
// (version digit 1–8, variant 8/9/a/b) which rejects test fixtures and
// some legacy ids. The rest of the codebase normalizes on this exact
// shape (`UUID_SHAPE` in actions.ts, [ticketId]/page.tsx, the receipt
// route, the Square API routes…), so the wire contract mirrors it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = () => z.string().regex(UUID_RE, "must be a UUID");

const cartItemSchema = z.object({
  serviceId: uuid(),
  techId: uuid(),
  note: z.string().max(500).nullable(),
  /** Operator-set price in cents. REQUIRED for variable-priced services
   *  (the catalog has no canonical price). OPTIONAL for fixed-price
   *  services — null/absent means "use the catalog price"; non-null is
   *  a US2 row-level override and wins. The server still enforces
   *  bounds and active-service checks; this field doesn't grant the
   *  client money authority, only the affordance of variable-price
   *  entry. */
  unitPriceCents: z.number().int().min(0).nullable().optional().default(null),
});

const cartDiscountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), percent: z.number().min(0).max(100) }),
  z.object({ kind: z.literal("amount"), amountCents: z.number().int().min(0) }),
]);

export const commitCartSchema = z.object({
  customerId: uuid().nullable(),
  techId: uuid().nullable(),
  items: z.array(cartItemSchema).min(1),
  discount: cartDiscountSchema.nullable(),
  notes: z.string().max(1000).nullable(),
});

// Use `z.input` (not `z.infer`) so optional fields with `.default(null)`
// stay optional in the wire type. Callers — including the migrated
// unit-test fixtures that predate the variable-price wireup — can
// omit `unitPriceCents` per item and the parser fills in null.
export type EphemeralCartInput = z.input<typeof commitCartSchema>;

// ─── Resolved row shapes ────────────────────────────────────────────

/** What the commit action inserts into `tickets` (subset; opener fields
 *  are filled in by the action itself). */
export type ResolvedTicketRow = {
  subtotal_cents: number;
  tax_cents: number; // 0 at v1; column is NOT NULL
  total_cents: number;
  customer_id: string | null;
  // The cart's top-level techId is informational; the action picks the
  // operator/opener id from the session, so we surface it here for the
  // action to record on the ticket if it wants to (matches existing
  // /checkout/[ticketId] schema usage).
  primary_tech_id: string | null;
};

/** What the commit action inserts into `ticket_items` (one row per
 *  service). Discount lines are emitted at most once when a cart-level
 *  discount is present. */
export type ResolvedItemRow = {
  kind: "service" | "discount";
  ref_id: string | null;
  name_snapshot: string;
  unit_price_cents: number;
  qty: number;
  assigned_staff_id: string | null;
  price_unconfirmed: boolean;
  discount_pct: number | null;
  note: string | null;
};

export type ResolvedTotals = {
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
};

export type ResolveOk = {
  ok: true;
  resolved: {
    ticketRow: ResolvedTicketRow;
    itemRows: ResolvedItemRow[];
    totals: ResolvedTotals;
  };
};

export type ResolveErr =
  | { ok: false; code: "STALE_SERVICE"; serviceId: string }
  | { ok: false; code: "INACTIVE_TECH"; techId: string }
  | { ok: false; code: "STALE_CUSTOMER"; customerId: string }
  | { ok: false; code: "PRICE_REQUIRED"; serviceId: string }
  | { ok: false; code: "PRICE_OUT_OF_BOUNDS"; serviceId: string }
  | { ok: false; code: "LOOKUP_FAILED"; message: string };

export type ResolveResult = ResolveOk | ResolveErr;

// ─── Minimal Supabase surface ───────────────────────────────────────

/**
 * Loose Supabase typing so this module compiles whether it's handed a
 * cookie-aware server client or the service-role client. Each commit
 * action will pass its own. Using the full generated `Database` type
 * here would force a tight coupling on db.types regen; the queries
 * stay narrow so misuse stays caught.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

// ─── Resolver ───────────────────────────────────────────────────────

/**
 * Re-resolve a parsed cart against the database and compute canonical
 * money values. Returns a discriminated union so each commit action
 * can route `ok: false` codes into its own toast/error path.
 *
 * Pure async — does NOT write anything. The caller (commit action)
 * is responsible for the atomic insert/RPC chain.
 */
export async function resolveCartForCommit(
  cart: EphemeralCartInput,
  supabase: AnySupabase
): Promise<ResolveResult> {
  // ── 1. Re-resolve services (active only). ────────────────────────
  const serviceIds = Array.from(new Set(cart.items.map((i) => i.serviceId)));
  const techIds = Array.from(
    new Set([...cart.items.map((i) => i.techId), ...(cart.techId ? [cart.techId] : [])])
  );

  const servicesRes = await supabase
    .from("services")
    .select("id, name, price_cents, duration_min, variable_price, price_from_cents, price_to_cents")
    .in("id", serviceIds)
    .eq("active", true);

  if (servicesRes.error) {
    return { ok: false, code: "LOOKUP_FAILED", message: servicesRes.error.message };
  }
  type ResolvedService = {
    id: string;
    name: string;
    price_cents: number;
    duration_min: number;
    variable_price: boolean;
    price_from_cents: number | null;
    price_to_cents: number | null;
  };
  const servicesById = new Map<string, ResolvedService>();
  for (const s of (servicesRes.data ?? []) as ResolvedService[]) {
    servicesById.set(s.id, s);
  }
  for (const id of serviceIds) {
    if (!servicesById.has(id)) {
      return { ok: false, code: "STALE_SERVICE", serviceId: id };
    }
  }

  // ── 2. Re-resolve techs (active only, not removed). ──────────────
  if (techIds.length > 0) {
    const staffRes = await supabase
      .from("staff")
      .select("id")
      .in("id", techIds)
      .eq("active", true)
      .is("removed_at", null);

    if (staffRes.error) {
      return { ok: false, code: "LOOKUP_FAILED", message: staffRes.error.message };
    }
    const presentIds = new Set(((staffRes.data ?? []) as Array<{ id: string }>).map((r) => r.id));
    for (const id of techIds) {
      if (!presentIds.has(id)) {
        return { ok: false, code: "INACTIVE_TECH", techId: id };
      }
    }
  }

  // ── 3. Re-resolve customer if present. ───────────────────────────
  if (cart.customerId) {
    const custRes = await supabase
      .from("customers")
      .select("id")
      .eq("id", cart.customerId)
      .maybeSingle();
    if (custRes.error) {
      return { ok: false, code: "LOOKUP_FAILED", message: custRes.error.message };
    }
    if (!custRes.data) {
      return { ok: false, code: "STALE_CUSTOMER", customerId: cart.customerId };
    }
  }

  // ── 4. Snapshot lines from the canonical service rows. ───────────
  //
  // Price resolution rules (Principle II — server-authoritative):
  //   - Variable-priced service: operator MUST supply unitPriceCents.
  //     If missing, reject with PRICE_REQUIRED. If outside the
  //     [price_from_cents, price_to_cents] bounds (when set), reject
  //     with PRICE_OUT_OF_BOUNDS.
  //   - Fixed-priced service: unitPriceCents == null → use catalog price.
  //     Non-null is a US2 row-level override (e.g. operator comp / spot
  //     discount) and wins. Server keeps audit authority over the
  //     deviation via the ticket_items snapshot.
  const itemRows: ResolvedItemRow[] = [];
  for (const it of cart.items) {
    const svc = servicesById.get(it.serviceId)!;
    const operatorPrice = it.unitPriceCents;

    let unit_price_cents: number;
    if (svc.variable_price) {
      if (operatorPrice == null || operatorPrice <= 0) {
        return { ok: false, code: "PRICE_REQUIRED", serviceId: it.serviceId };
      }
      if (svc.price_from_cents != null && operatorPrice < svc.price_from_cents) {
        return { ok: false, code: "PRICE_OUT_OF_BOUNDS", serviceId: it.serviceId };
      }
      if (svc.price_to_cents != null && operatorPrice > svc.price_to_cents) {
        return { ok: false, code: "PRICE_OUT_OF_BOUNDS", serviceId: it.serviceId };
      }
      unit_price_cents = operatorPrice;
    } else {
      unit_price_cents =
        operatorPrice != null && operatorPrice > 0 ? operatorPrice : svc.price_cents;
    }

    itemRows.push({
      kind: "service",
      ref_id: it.serviceId,
      name_snapshot: svc.name,
      unit_price_cents,
      qty: 1,
      assigned_staff_id: it.techId,
      price_unconfirmed: false,
      discount_pct: null,
      note: it.note,
    });
  }

  const subtotal_cents = itemRows.reduce((acc, r) => acc + r.unit_price_cents * r.qty, 0);

  // ── 5. Discount (canonical, mirrors `previewTotals`). ────────────
  let discount_cents = 0;
  if (cart.discount) {
    if (cart.discount.kind === "percent") {
      discount_cents = Math.round((subtotal_cents * cart.discount.percent) / 100);
      // Emit a discount line so the receipt + ticket_items reflect it.
      itemRows.push({
        kind: "discount",
        ref_id: null,
        name_snapshot: `${cart.discount.percent}% discount`,
        unit_price_cents: -discount_cents,
        qty: 1,
        assigned_staff_id: null,
        price_unconfirmed: false,
        discount_pct: cart.discount.percent,
        note: null,
      });
    } else {
      discount_cents = cart.discount.amountCents;
      itemRows.push({
        kind: "discount",
        ref_id: null,
        name_snapshot: "Discount",
        unit_price_cents: -discount_cents,
        qty: 1,
        assigned_staff_id: null,
        price_unconfirmed: false,
        discount_pct: null,
        note: null,
      });
    }
  }
  if (discount_cents > subtotal_cents) discount_cents = subtotal_cents;

  const total_cents = subtotal_cents - discount_cents;

  return {
    ok: true,
    resolved: {
      ticketRow: {
        subtotal_cents,
        tax_cents: 0,
        total_cents,
        customer_id: cart.customerId,
        primary_tech_id: cart.techId,
      },
      itemRows,
      totals: { subtotal_cents, discount_cents, total_cents },
    },
  };
}
