// /checkout entry — cart-build phase (Feature 042 — Ephemeral Cart).
//
// Server Component. Renders the SAME <CheckoutScreen> client island as
// /checkout/[ticketId], just without a `ticketId` (the screen branches
// internally into "cart mode": every cart-edit handler mutates local
// React state; the four payment submits call `submitXxxFromCart` Server
// Actions which create the ticket + items + first payment atomically
// and redirect to /checkout/<new-id>).
//
// No eager `createEmptyTicket` / `resumeOrCreateTicket`. Visiting this
// page writes nothing to the database (SC-001, SC-002, SC-003). The
// dashboard CTA, sidebar Checkout link, and DoneScreen "New sale" link
// all land here.

import "./checkout.css";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

import { CheckoutScreen } from "./[ticketId]/checkout-screen.client";

export const dynamic = "force-dynamic";

export default async function CheckoutEntryPage() {
  await requireStudioSession();

  const supabase = await createSupabaseServerClient();

  // Same lookups the [ticketId] page does, minus the ticket-specific ones:
  // active staff for the avatar row, active services for the catalog,
  // Square OAuth + paired devices so the Card tile in PaymentTiles can
  // light up when the salon is set up.
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

  const squareOauthPromise = supabase
    .from("square_oauth")
    .select("merchant_id, refresh_failed_at")
    .eq("id", true)
    .maybeSingle();

  const squareDevicesPromise = supabase
    .from("square_devices")
    .select("square_device_id, friendly_name, is_default");

  const [staffRes, servicesRes, squareOauthRes, squareDevicesRes] = await Promise.all([
    staffPromise,
    servicesPromise,
    squareOauthPromise,
    squareDevicesPromise,
  ]);

  if (staffRes.error) throw new Error(`staff load failed: ${staffRes.error.message}`);
  if (servicesRes.error) throw new Error(`services load failed: ${servicesRes.error.message}`);

  const squareConnected = Boolean(squareOauthRes.data);
  const requiresReconnect = Boolean(squareOauthRes.data?.refresh_failed_at);
  const pairedDevices = (squareDevicesRes.data ?? []).map((d) => ({
    squareDeviceId: d.square_device_id,
    friendlyName: d.friendly_name,
    isDefault: d.is_default ?? false,
  }));
  const defaultDevice = pairedDevices.find((d) => d.isDefault) ?? null;

  return (
    <CheckoutScreen
      // No `ticketId` → cart mode. Every cart-edit handler runs locally;
      // the four payment buttons call the submitXxxFromCart actions.
      squareConnected={squareConnected}
      defaultDeviceId={defaultDevice?.squareDeviceId ?? null}
      defaultDeviceFriendlyName={defaultDevice?.friendlyName ?? null}
      pairedDevices={pairedDevices}
      requiresReconnect={requiresReconnect}
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
        presets:
          (s.presets as Array<{ label: string; price_cents: number }> | null | undefined) ?? null,
      }))}
    />
  );
}
