// /checkout — paramless ephemeral-draft entry page. Server Component.
//
// Feature 043-checkout-ephemeral-draft (T012): every checkout entry now
// lands here directly. There is NO DB ticket — the in-progress cart is an
// ephemeral in-memory draft held entirely in the CheckoutScreen client
// island. Nothing is written to the database until the first payment-
// initiating action (which calls `pos_create_ticket_from_draft`).
//
// This page therefore:
//   - takes NO route params and NO `?fresh=1` query (both removed),
//   - does NO ticket DB read and creates no `tickets` row,
//   - loads only the catalog/roster/Square/salon-settings data the
//     CheckoutScreen needs to render an empty draft cart,
//   - renders `<CheckoutScreen ticketId={null} initialItems={[]}
//     initialLegs={[]} ... />` directly — no redirect.
//
// `[ticketId]/page.tsx` stays the post-submission surface (paid →
// DoneScreen, etc.); after a successful draft-path payment the client
// `router.replace`s onto `/checkout/<ticketId>`.
//
// `force-dynamic` because the page reads operator-scoped data via the
// request cookie store.

import "./checkout.css";

import { CheckoutScreen } from "./checkout-screen.client";
import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSetting } from "@/lib/settings/read";

export const dynamic = "force-dynamic";

export default async function CheckoutEntryPage() {
  await requireStudioSession();

  const supabase = await createSupabaseServerClient();

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
  // the rest of the page data so the ReceiptSheet's masthead can render
  // without a second round trip. Missing keys fall back to safe strings
  // per the spec's "Salon settings missing" edge case.
  const salonNamePromise = getSetting<string>("salon.name");
  const salonAddressPromise = getSetting<string>("salon.address");
  const salonPhonePromise = getSetting<string>("salon.phone");

  const [
    staffRes,
    servicesRes,
    salonName,
    salonAddress,
    salonPhone,
    squareOauthRes,
    squareDevicesRes,
  ] = await Promise.all([
    staffPromise,
    servicesPromise,
    salonNamePromise,
    salonAddressPromise,
    salonPhonePromise,
    squareOauthPromise,
    squareDevicesPromise,
  ]);

  const salonInfo = {
    name: salonName ?? "Tang Nails Studio",
    address: salonAddress ?? "",
    phone: salonPhone ?? "",
  };

  if (staffRes.error) throw new Error(`staff load failed: ${staffRes.error.message}`);
  if (servicesRes.error) throw new Error(`services load failed: ${servicesRes.error.message}`);

  // US2 (015): derive Square props for the checkout screen.
  const squareConnected = Boolean(squareOauthRes.data);
  const requiresReconnect = Boolean(squareOauthRes.data?.refresh_failed_at);
  const pairedDevices = (squareDevicesRes.data ?? []).map((d) => ({
    squareDeviceId: d.square_device_id,
    friendlyName: d.friendly_name,
    isDefault: d.is_default ?? false,
  }));
  const defaultDevice = pairedDevices.find((d) => d.isDefault) ?? null;

  // Ephemeral draft: render the cart island with an empty in-memory cart
  // and no payment legs. `ticketId={null}` flips the island into ephemeral
  // mode — cart edits mutate local React state only and the first payment
  // action persists the whole cart at once.
  return (
    <CheckoutScreen
      ticketId={null}
      salonInfo={salonInfo}
      squareConnected={squareConnected}
      defaultDeviceId={defaultDevice?.squareDeviceId ?? null}
      defaultDeviceFriendlyName={defaultDevice?.friendlyName ?? null}
      pairedDevices={pairedDevices}
      requiresReconnect={requiresReconnect}
      initialLegs={[]}
      initialItems={[]}
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
