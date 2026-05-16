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

import { CheckoutScreen } from "./checkout-screen.client";
import { DoneScreen } from "@/components/lacquer/checkout/done-screen";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

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

  const itemsPromise = supabase
    .from("ticket_items")
    .select(
      "id, ref_id, name_snapshot, unit_price_cents, qty, assigned_staff_id, price_unconfirmed"
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
    .select("id, name, category, duration_min, price_cents, variable_price, price_from_cents")
    .eq("active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  const [ticketRes, itemsRes, staffRes, servicesRes] = await Promise.all([
    ticketPromise,
    itemsPromise,
    staffPromise,
    servicesPromise,
  ]);

  if (ticketRes.error) throw new Error(`ticket load failed: ${ticketRes.error.message}`);
  if (!ticketRes.data) notFound();
  if (itemsRes.error) throw new Error(`items load failed: ${itemsRes.error.message}`);
  if (staffRes.error) throw new Error(`staff load failed: ${staffRes.error.message}`);
  if (servicesRes.error) throw new Error(`services load failed: ${servicesRes.error.message}`);

  const ticket = ticketRes.data;

  if (ticket.status === "paid") {
    return (
      <div className="checkout-shell" data-slot="checkout-paid">
        <DoneScreen chargedCents={ticket.total_cents} />
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

  // status === 'open' — render the cart island with the loaded snapshot.
  return (
    <CheckoutScreen
      ticketId={ticket.id}
      initialItems={(itemsRes.data ?? []).map((row) => ({
        id: row.id,
        serviceId: row.ref_id,
        name: row.name_snapshot,
        unitPriceCents: row.unit_price_cents,
        qty: row.qty,
        priceUnconfirmed: row.price_unconfirmed,
        assignedStaffId: row.assigned_staff_id,
      }))}
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
      }))}
    />
  );
}
