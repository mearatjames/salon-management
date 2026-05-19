// /checkout entry page. Server Component (Feature 042 — Ephemeral Cart).
//
// Renders the cart-building UI directly. NO eager ticket row is
// created — the previous flow (`createEmptyTicket` /
// `resumeOrCreateTicket` → redirect) is replaced with an in-memory
// cart that only commits on payment submit (US1/2/3).
//
// `force-dynamic` because the page reads operator-scoped data
// (active staff roster, service catalog) via the request cookie
// store. No more `?fresh=1` branching.

import "./checkout.css";

import { requireStudioSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";

import { CartBuildingScreen } from "./checkout-screen.client";
import { CartProvider } from "./_cart-context";

export const dynamic = "force-dynamic";

export default async function CheckoutEntryPage() {
  await requireStudioSession();

  const supabase = await createSupabaseServerClient();

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

  // Feature 042 (T019) — Square state for the Card tile + Send-to-Terminal
  // CTA. The cart-build UI mirrors `sendCardToTerminal`'s connection +
  // device resolution: connected iff a non-failed `square_oauth` row
  // exists; default device wins over a single-device fallback.
  const squareOauthPromise = supabase
    .from("square_oauth")
    .select("id, refresh_failed_at")
    .eq("id", true)
    .maybeSingle();

  const squareDevicesPromise = supabase
    .from("square_devices")
    .select("square_device_id, is_default")
    .order("is_default", { ascending: false });

  const [staffRes, servicesRes, squareOauthRes, squareDevicesRes] = await Promise.all([
    staffPromise,
    servicesPromise,
    squareOauthPromise,
    squareDevicesPromise,
  ]);

  if (staffRes.error) throw new Error(`staff load failed: ${staffRes.error.message}`);
  if (servicesRes.error) throw new Error(`services load failed: ${servicesRes.error.message}`);
  // Square reads are non-fatal — a missing row just disables the Card
  // tile. Errors fall through to "not connected" so the page still
  // renders even if Supabase RLS gets weird.
  const oauthRow = squareOauthRes.error ? null : squareOauthRes.data;
  const deviceRows = squareDevicesRes.error ? [] : (squareDevicesRes.data ?? []);

  const squareConnected = Boolean(oauthRow) && !oauthRow?.refresh_failed_at;
  const devicesAvailable = deviceRows.length;
  // Mirror sendCardToTerminal's resolution: default flag wins; otherwise
  // a single-device fallback. Anything else needs explicit operator pick
  // (a future enhancement; null for now is fine — the action falls back
  // to its own resolver).
  let defaultDeviceId: string | null = null;
  const defaulted = deviceRows.find((r) => r.is_default);
  if (defaulted?.square_device_id) {
    defaultDeviceId = defaulted.square_device_id as string;
  } else if (deviceRows.length === 1 && deviceRows[0].square_device_id) {
    defaultDeviceId = deviceRows[0].square_device_id as string;
  }

  const staff = (staffRes.data ?? []).map((s) => ({
    id: s.id,
    display_name: s.display_name,
    color_token: s.color_token,
  }));

  const services = (servicesRes.data ?? []).map((s) => ({
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
    // CHECK (migration 0006). Coerce to the typed shape the catalog
    // tile expects.
    presets:
      (s.presets as Array<{ label: string; price_cents: number }> | null | undefined) ?? null,
  }));

  return (
    <CartProvider>
      <CartBuildingScreen
        staff={staff}
        services={services}
        squareConnected={squareConnected}
        devicesAvailable={devicesAvailable}
        defaultDeviceId={defaultDeviceId}
      />
    </CartProvider>
  );
}
