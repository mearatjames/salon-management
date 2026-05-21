// /checkout/[ticketId]/receipt — printable receipt Server Component.
//
// Lives under `app/(receipt-print)/` (a sibling route group to
// `app/(studio)/`) so the studio chrome layout does NOT wrap it. Route
// groups in parentheses do not appear in the URL, so the public path
// remains `/checkout/[ticketId]/receipt`. This is the App Router idiom
// for "break out of the parent shell" — see research.md § R4 and the
// adjacent `(receipt-print)/layout.tsx`.
//
// Gated on a signed-in studio session (FR-026 — anonymous GETs must NOT
// see receipt content). `requireStudioSession()` throws AuthRedirectError
// on failure, which the edge proxy (`proxy.ts`) translates into a 307
// redirect to `/login`.
//
// Loads ticket + items + the single cash `payments` row in parallel via
// the cookie-aware Supabase client. Returns 404 on:
//   - non-existent ticketId
//   - ticket.status !== 'paid' (receipts are only for completed sales)
//   - no cash payment row exists for the ticket (defensive)
//
// `salonName` source: there is no `settings` table in v1 (data-model.md
// § 8 — Out of Scope). Hardcoded "Tang Nails Studio" per T044 spec. When a
// settings surface ships, swap the literal for a SELECT against
// `public.settings`.

import "@/app/(studio)/checkout/checkout.css";

import { notFound } from "next/navigation";

import { ReceiptView } from "@/components/lacquer/checkout/receipt-view";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

export const dynamic = "force-dynamic";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReceiptPage({ params }: { params: Promise<{ ticketId: string }> }) {
  // FR-026 enforcement: throw before any DB reads so the response body
  // contains no receipt content for anonymous callers.
  await requireStudioSession();

  const { ticketId } = await params;
  if (!UUID_SHAPE.test(ticketId)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();

  const ticketPromise = supabase
    .from("tickets")
    .select("id, subtotal_cents, tax_cents, total_cents, closed_at, status")
    .eq("id", ticketId)
    .maybeSingle();

  const itemsPromise = supabase
    .from("ticket_items")
    .select("id, name_snapshot, unit_price_cents, qty")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  const paymentPromise = supabase
    .from("payments")
    .select("id, method, amount_cents, processed_at")
    .eq("ticket_id", ticketId)
    .eq("method", "cash")
    .maybeSingle();

  const [ticketRes, itemsRes, paymentRes] = await Promise.all([
    ticketPromise,
    itemsPromise,
    paymentPromise,
  ]);

  if (ticketRes.error) throw new Error(`ticket load failed: ${ticketRes.error.message}`);
  if (!ticketRes.data) notFound();
  if (ticketRes.data.status !== "paid") notFound();
  if (itemsRes.error) throw new Error(`items load failed: ${itemsRes.error.message}`);
  if (paymentRes.error) throw new Error(`payment load failed: ${paymentRes.error.message}`);
  if (!paymentRes.data) notFound();
  if (paymentRes.data.method !== "cash") notFound();

  const ticket = ticketRes.data;
  const items = itemsRes.data ?? [];
  const payment = paymentRes.data;

  // Hardcoded per T044 — no `settings` table in v1 (data-model.md § 8).
  const salonName = "Tang Nails Studio";

  return (
    <ReceiptView
      ticket={{
        id: ticket.id,
        subtotal_cents: ticket.subtotal_cents,
        tax_cents: ticket.tax_cents,
        total_cents: ticket.total_cents,
        closed_at: ticket.closed_at,
      }}
      items={items.map((it) => ({
        id: it.id,
        name_snapshot: it.name_snapshot,
        unit_price_cents: it.unit_price_cents,
        qty: it.qty,
      }))}
      payment={{
        id: payment.id,
        method: "cash",
        amount_cents: payment.amount_cents,
        processed_at: payment.processed_at,
      }}
      salonName={salonName}
    />
  );
}
