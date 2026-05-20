// /checkout/[ticketId] — single-screen cart Server Component.
//
// Loads the ticket + items + active staff roster + service catalog in
// parallel via the cookie-aware Supabase client (which respects the
// `select to authenticated` RLS policies added by 0004).
//
// Render branches:
//   - status === 'paid'      → <DoneScreen chargedCents={totalCents} />
//   - status === 'discarded' → defensive placeholder + link to dashboard
//   - status === 'open'      → <CheckoutScreen /> client island
//
// `force-dynamic` because the page reads operator-scoped data via the
// request cookie store.

import "../checkout.css";

import Link from "next/link";
import { notFound } from "next/navigation";

import { CheckoutScreen } from "../checkout-screen.client";
import { DoneScreen } from "@/components/lacquer/checkout/done-screen";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSetting } from "@/lib/settings/read";

export const dynamic = "force-dynamic";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CheckoutTicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  await requireStudioSession();

  const { ticketId } = await params;
  if (!UUID_SHAPE.test(ticketId)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();

  const ticketPromise = supabase
    .from("tickets")
    .select(
      "id, status, subtotal_cents, tax_cents, total_cents, opened_by_staff_id, closed_at, closed_by_staff_id"
    )
    .eq("id", ticketId)
    .maybeSingle();

  // US2 (015 — Square Terminal): the checkout screen needs to know whether
  // Square is connected, which device is default, and whether reconnect
  // is required. These read from the singleton oauth row + paired devices.
  const squareOauthPromise = supabase
    .from("square_oauth")
    .select("merchant_id, refresh_failed_at")
    .eq("id", true)
    .maybeSingle();
  const squareDevicesPromise = supabase
    .from("square_devices")
    .select("square_device_id, friendly_name, is_default");

  // For the paid render branch: surface "Paid by {method}" on the Done
  // screen. Pick the most recent succeeded payment row for this ticket;
  // for a single-method close that's authoritative. (Split-tender is out
  // of scope per spec; if/when added this query would need to summarize
  // the mix instead of picking one.)
  const lastSucceededPaymentPromise = supabase
    .from("payments")
    .select("method")
    .eq("ticket_id", ticketId)
    .eq("status", "succeeded")
    .order("processed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  // Feature 018 (US2): load every non-failed leg so the client island can
  // hydrate the split-tender footer when one or more drafts/pendings/
  // succeededs already exist (covers reload-in-the-middle, US3 auto-entry
  // from partial-gift, etc.).
  const paymentLegsPromise = supabase
    .from("payments")
    .select("id, method, amount_cents, status, gift_card_id")
    .eq("ticket_id", ticketId)
    .in("status", ["draft", "pending", "succeeded"])
    .order("created_at", { ascending: true });

  const itemsPromise = supabase
    .from("ticket_items")
    .select(
      "id, kind, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed, discount_pct, note"
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  const staffPromise = supabase
    .from("staff")
    .select("id, display_name, role, color_token")
    .eq("active", true)
    .is("removed_at", null)
    .order("display_name", { ascending: true });

  const servicesPromise = supabase
    .from("services")
    .select(
      "id, name, category, duration_min, price_cents, variable_price, price_from_cents, price_to_cents, variable_price_note, presets"
    )
    .eq("active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  // US4 (T040): fetch the three salon-info settings keys in parallel with
  // the rest of the page data so the BillSheet's masthead can render
  // without a second round trip. Missing keys fall back to safe strings
  // per the spec's "Salon settings missing" edge case.
  const salonNamePromise = getSetting<string>("salon.name");
  const salonAddressPromise = getSetting<string>("salon.address");
  const salonPhonePromise = getSetting<string>("salon.phone");

  const [
    ticketRes,
    itemsRes,
    staffRes,
    servicesRes,
    salonName,
    salonAddress,
    salonPhone,
    squareOauthRes,
    squareDevicesRes,
    lastSucceededPaymentRes,
    paymentLegsRes,
  ] = await Promise.all([
    ticketPromise,
    itemsPromise,
    staffPromise,
    servicesPromise,
    salonNamePromise,
    salonAddressPromise,
    salonPhonePromise,
    squareOauthPromise,
    squareDevicesPromise,
    lastSucceededPaymentPromise,
    paymentLegsPromise,
  ]);

  const salonInfo = {
    name: salonName ?? "Tang Nails",
    address: salonAddress ?? "",
    phone: salonPhone ?? "",
  };

  if (ticketRes.error) throw new Error(`ticket load failed: ${ticketRes.error.message}`);
  if (!ticketRes.data) notFound();
  if (itemsRes.error) throw new Error(`items load failed: ${itemsRes.error.message}`);
  if (staffRes.error) throw new Error(`staff load failed: ${staffRes.error.message}`);
  if (servicesRes.error) throw new Error(`services load failed: ${servicesRes.error.message}`);

  const ticket = ticketRes.data;

  if (ticket.status === "paid") {
    const paidByMethod: "cash" | "card" =
      lastSucceededPaymentRes.data?.method === "card" ? "card" : "cash";
    return (
      <div className="checkout-shell" data-slot="checkout-paid">
        <DoneScreen chargedCents={ticket.total_cents} method={paidByMethod} />
      </div>
    );
  }

  if (ticket.status === "discarded") {
    return (
      <div
        className="checkout-shell"
        data-slot="checkout-discarded"
        style={{
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-12)",
          textAlign: "center",
          gap: "var(--space-3)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-lg)",
            color: "var(--foreground)",
            fontWeight: 500,
          }}
        >
          This ticket was discarded.
        </p>
        <Link
          href="/dashboard"
          style={{
            color: "var(--primary)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
            textDecoration: "underline",
          }}
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  // 013-cart-polish T022 (US2): build a service lookup so initial-load
  // (server-hydrated) cart lines can carry `serviceMeta` from the moment
  // the page renders. Without this, opening the override sheet on a row
  // that was already on the ticket at page load shows the generic
  // "Adjust price for this sale" context and renders no preset chips —
  // the metadata only flowed in via `handlePickService` (optimistically
  // added lines). The CHECK on `services.presets` (migration 0006)
  // guarantees the cast shape.
  const servicesById = new Map<string, (typeof servicesRes.data)[number]>();
  for (const s of servicesRes.data ?? []) servicesById.set(s.id, s);

  // US2 (015): derive Square props for the checkout screen.
  const squareConnected = Boolean(squareOauthRes.data);
  const requiresReconnect = Boolean(squareOauthRes.data?.refresh_failed_at);
  const pairedDevices = (squareDevicesRes.data ?? []).map((d) => ({
    squareDeviceId: d.square_device_id,
    friendlyName: d.friendly_name,
    isDefault: d.is_default ?? false,
  }));
  const defaultDevice = pairedDevices.find((d) => d.isDefault) ?? null;

  // Feature 018 (US2): resolve last-4 masks for any gift-card legs we
  // loaded. The check is conditional — only run the secondary read when
  // we actually have a gift leg on this ticket.
  const legRows = paymentLegsRes.data ?? [];
  const giftCardIds = Array.from(
    new Set(legRows.map((r) => r.gift_card_id).filter((id): id is string => Boolean(id)))
  );
  const giftLast4ById = new Map<string, string>();
  if (giftCardIds.length > 0) {
    const { data: giftRows } = await supabase
      .from("gift_cards")
      .select("id, last4_mask")
      .in("id", giftCardIds);
    for (const g of giftRows ?? []) {
      giftLast4ById.set(g.id, g.last4_mask);
    }
  }
  const initialLegs = legRows
    .filter((r) => r.method === "cash" || r.method === "card" || r.method === "gift")
    .map((r) => ({
      id: r.id,
      method: r.method as "cash" | "card" | "gift",
      amountCents: r.amount_cents,
      status: r.status as "draft" | "pending" | "succeeded",
      last4Mask: r.gift_card_id ? (giftLast4ById.get(r.gift_card_id) ?? null) : null,
    }));

  // Feature 043-checkout-ephemeral-draft (T028): a single-tender card or
  // whole-ticket gift payment inserts ONE `pending` row that covers the
  // FULL ticket total (no `draft` leg, no remainder). When the ephemeral
  // card-send / gift-redeem persists the ticket and the client
  // `router.replace`s onto this route, the card-waiting / gift-card-waiting
  // screen must rehydrate so the realtime/polling settlement path keeps
  // running — identical to the pre-043 in-session wait (FR-003). Detect
  // exactly that shape — one non-failed `pending` leg whose amount equals
  // `total_cents` — and seed the client's stage. A partial-gift leg
  // (amount < total — a remainder is still owed) is the split-tender path
  // and stays in `initialLegs` so the split footer rehydrates instead.
  const loneFullCoverLeg =
    initialLegs.length === 1 &&
    initialLegs[0].status === "pending" &&
    initialLegs[0].amountCents === ticket.total_cents
      ? initialLegs[0]
      : null;
  const loneCardWaitingLeg = loneFullCoverLeg?.method === "card" ? loneFullCoverLeg : null;
  const loneGiftWaitingLeg = loneFullCoverLeg?.method === "gift" ? loneFullCoverLeg : null;

  // Feature 043 (T028): when the ephemeral gift-redeem covered only PART
  // of the ticket (`partial_split`), the persisted ticket has one
  // `pending` gift leg whose amount is short of `total_cents`. After the
  // `router.replace` onto this route the split-tender continuation must
  // re-open the second-leg method picker for the remainder — exactly what
  // the in-session `partial_split` branch does. Detect that shape and seed
  // the picker amount so the rehydrated client re-opens it.
  const nonFailedSettledOrPending = initialLegs.filter(
    (l) => l.status === "pending" || l.status === "succeeded"
  );
  const partialGiftRemainderCents =
    initialLegs.length >= 1 &&
    initialLegs.every((l) => l.method === "gift" && l.status === "pending") &&
    nonFailedSettledOrPending.reduce((sum, l) => sum + l.amountCents, 0) < ticket.total_cents
      ? ticket.total_cents - nonFailedSettledOrPending.reduce((s, l) => s + l.amountCents, 0)
      : null;

  // status === 'open' — render the cart island with the loaded snapshot.
  return (
    <CheckoutScreen
      ticketId={ticket.id}
      salonInfo={salonInfo}
      squareConnected={squareConnected}
      defaultDeviceId={defaultDevice?.squareDeviceId ?? null}
      defaultDeviceFriendlyName={defaultDevice?.friendlyName ?? null}
      pairedDevices={pairedDevices}
      requiresReconnect={requiresReconnect}
      // When the lone leg is a full-cover pending card or whole-ticket
      // gift, hand it to the card-waiting / gift-card-waiting stage instead
      // of the split-tender footer (see above).
      initialLegs={loneFullCoverLeg ? [] : initialLegs}
      initialCardStage={loneCardWaitingLeg ? "waiting" : "cart"}
      initialActiveCardPaymentId={loneCardWaitingLeg ? loneCardWaitingLeg.id : null}
      initialGiftStage={loneGiftWaitingLeg ? "waiting" : "idle"}
      initialActiveGiftPaymentId={loneGiftWaitingLeg ? loneGiftWaitingLeg.id : null}
      initialMethodPickerAmountCents={partialGiftRemainderCents}
      initialItems={(itemsRes.data ?? [])
        // US3 (T031): both service AND discount rows now surface. Discount
        // rows have ref_id=null / assigned_staff_id=null (CHECK-enforced in
        // 0006) and carry `discount_pct` + `note`. Service rows still need
        // both fk fields populated to be valid.
        .filter((row) => {
          if (row.kind === "discount") return true;
          return row.kind === "service" && row.ref_id !== null && row.assigned_staff_id !== null;
        })
        .map((row) => {
          if (row.kind === "discount") {
            return {
              id: row.id,
              serviceId: null,
              name: row.name_snapshot,
              unitPriceCents: row.unit_price_cents,
              qty: row.qty,
              priceUnconfirmed: false,
              assignedStaffId: null,
              kind: "discount" as const,
              note: (row.note as string | null) ?? null,
              discountPct: row.discount_pct != null ? Number(row.discount_pct as unknown) : null,
              serviceMeta: null,
            };
          }
          const svc = servicesById.get(row.ref_id as string);
          return {
            id: row.id,
            serviceId: row.ref_id as string,
            name: row.name_snapshot,
            unitPriceCents: row.unit_price_cents,
            qty: row.qty,
            priceUnconfirmed: row.price_unconfirmed,
            assignedStaffId: row.assigned_staff_id as string,
            kind: "service" as const,
            note: null,
            discountPct: null,
            // T022 (US2): pre-fill the variable-price metadata so the
            // override path renders the same preset chips + context note
            // as the in-session optimistic insert path. `null` when the
            // source service is no longer in the active catalog (archived
            // mid-session) — the sheet falls back to the generic context.
            serviceMeta: svc
              ? {
                  variable: svc.variable_price,
                  priceFromCents: svc.price_from_cents,
                  priceToCents: svc.price_to_cents,
                  variableNote: svc.variable_price_note,
                  presets:
                    (svc.presets as
                      | Array<{ label: string; price_cents: number }>
                      | null
                      | undefined) ?? null,
                }
              : null,
          };
        })}
      staff={(staffRes.data ?? []).map((s) => ({
        id: s.id,
        display_name: s.display_name,
        color_token: s.color_token,
      }))}
      services={(servicesRes.data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        duration_min: s.duration_min,
        price_cents: s.price_cents,
        variable_price: s.variable_price,
        price_from_cents: s.price_from_cents,
        price_to_cents: s.price_to_cents,
        variable_price_note: s.variable_price_note,
        // `presets` is a `jsonb` column whose schema is enforced by a DB
        // CHECK (added in migration 0006) — an array of `{label, price_cents}`
        // objects. Coerce the typed-out unknown[] back to the shape the
        // checkout client expects; the CHECK guarantees correctness.
        presets:
          (s.presets as Array<{ label: string; price_cents: number }> | null | undefined) ?? null,
      }))}
    />
  );
}
