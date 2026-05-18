// Typed read helper for the supply-types catalog. Used by the services
// page (T030) to source the picker's `supplyTypes` prop AND by the Edit
// Policy sheet's section component (T041) to render rows with their
// usage counts + sub-row services.
//
// Two parallel queries via the cookie-aware Supabase server client:
//   1. select id, name, archived from supply_types order by archived, name
//   2. select supply_type_id, services.id, services.name, services.color_token,
//      services.supply_amount_cents
//      from services where active = true and supply_type_id is not null
//      order by services.name
//
// The JS layer fans out the per-type `services` array + `usage_count`,
// then splits into `{ active, archived }`. Both arrays sorted by `name`
// ASC.
//
// Contract: specs/022-supply-types-catalog/data-model.md § 2.2
//           specs/022-supply-types-catalog/research.md § R5

import { createSupabaseServerClient } from "@/lib/db/server";

export type SupplyTypeServiceRow = {
  id: string;
  name: string;
  color_token: string;
  supply_amount_cents: number;
};

export type SupplyTypeRow = {
  id: string;
  name: string;
  archived: boolean;
  usage_count: number;
  services: SupplyTypeServiceRow[];
};

export type SupplyTypesCatalog = {
  active: SupplyTypeRow[];
  archived: SupplyTypeRow[];
};

export async function loadSupplyTypesCatalog(): Promise<SupplyTypesCatalog> {
  const supabase = await createSupabaseServerClient();

  const typesPromise = supabase
    .from("supply_types")
    .select("id, name, archived")
    .order("archived", { ascending: true })
    .order("name", { ascending: true });

  const servicesPromise = supabase
    .from("services")
    .select("id, name, color_token, supply_amount_cents, supply_type_id")
    .eq("active", true)
    .not("supply_type_id", "is", null)
    .order("name", { ascending: true });

  const [typesRes, servicesRes] = await Promise.all([typesPromise, servicesPromise]);

  if (typesRes.error) {
    throw new Error(`Failed to load supply types: ${typesRes.error.message}`);
  }
  if (servicesRes.error) {
    throw new Error(`Failed to load supply-type service refs: ${servicesRes.error.message}`);
  }

  // Bucket services by their supply_type_id (already filtered to non-null).
  const servicesByTypeId = new Map<string, SupplyTypeServiceRow[]>();
  for (const row of servicesRes.data ?? []) {
    if (!row.supply_type_id || row.supply_amount_cents === null) continue;
    const bucket = servicesByTypeId.get(row.supply_type_id) ?? [];
    bucket.push({
      id: row.id,
      name: row.name,
      color_token: row.color_token,
      supply_amount_cents: row.supply_amount_cents,
    });
    servicesByTypeId.set(row.supply_type_id, bucket);
  }

  const active: SupplyTypeRow[] = [];
  const archived: SupplyTypeRow[] = [];
  for (const t of typesRes.data ?? []) {
    const services = servicesByTypeId.get(t.id) ?? [];
    const row: SupplyTypeRow = {
      id: t.id,
      name: t.name,
      archived: t.archived,
      usage_count: services.length,
      services,
    };
    if (t.archived) archived.push(row);
    else active.push(row);
  }

  // The DB query orders by (archived, name) but split into separate
  // arrays both sorted by name ASC — already guaranteed by the ORDER BY
  // clause; explicit re-sort below for defense-in-depth.
  active.sort((a, b) => a.name.localeCompare(b.name));
  archived.sort((a, b) => a.name.localeCompare(b.name));

  return { active, archived };
}
