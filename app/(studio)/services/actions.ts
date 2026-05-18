"use server";

// Server Actions for Services catalog (top-level /services route, reached
// from the studio sidebar). Each action follows the shared
// prelude documented in `contracts/server-actions.contract.md § Shared prelude`:
//   1. requireStudioSession           (auth resolver — throws AuthRedirectError)
//   2. assertCanWriteCatalog          (owner OR manager — defense in depth)
//   3. parse + validate FormData      (per-action; via `_validation.ts`)
//   4. load target row                (skipped for addService)
//   5. (no per-target matrix in this feature — step 2 is the entire check)
//   6. mutate via service-role client (RLS-bypassing INSERT/UPDATE)
//   7. await recordAudit              (no redirect until audit row commits)
//   8. revalidatePath + redirect      (success: `?toast=…`; failure: `?error=…`)
//
// Phase 5 ships `updateService` end-to-end alongside the typed projection
// `loadServiceWithAssignments` (NOT a Server Action — pure helper consumed
// by the RSC page).
//
// Note on transactions: the supabase-js client doesn't expose Postgres
// transactions directly.
//   - `addService` runs the `services` INSERT first then each
//     `staff_services` INSERT; on any assignment failure it deletes the
//     just-inserted service to roll back manually.
//   - `updateService` snapshots the baseline row + assignments, applies the
//     services UPDATE then the assignment ops (delete → insert → update);
//     on any failure it replays the inverse ops to restore the baseline.
// Both match the "user-visible outcome is both succeed or both fail"
// contract clause. A future migration could shift either to a SQL function
// (e.g. `public.update_service_with_assignments(json)`) for a single-
// statement transaction if production hits race issues; for now this stays
// minimal per Constitution V (Scope Discipline).

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";

import { SERVICE_DIFF_KEYS, buildChanges, type ServiceDiffSnapshot } from "./_audit-diff";
import { PermissionError, assertCanWriteCatalog } from "./permissions";
import { staffAssignmentDiff } from "./_diff";
import type { CardFeeMode, ServiceAssignment } from "./_types";
import {
  ValidationError,
  validateBoundDollars,
  validateBoundsConsistency,
  validateCardFeeCustomDollars,
  validateCardFeeMode,
  validateCategory,
  validateColor,
  validateDurationMin,
  validateFixedPriceDollars,
  validateName,
  validateOverrideMin,
  validateSupplyAmountDollars,
  validateSupplyTypeId,
} from "./_validation";

// Accepts any 36-char `8-4-4-4-12` hyphenated hex group. Looser than
// `validateUuid` (which insists on RFC v4 shape) because the staff_id we
// receive in `staff_ids[]` originated from `staff.id` rows that may have
// been seeded with non-v4 placeholders (e.g. `10000000-0000-0000-0000-
// 000000000001`). The DB FK constraint is the real check — this is just a
// cheap shape filter to drop bogus form payloads.
const UUID_SHAPE_LOOSE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVICES_PATH = "/services";

/**
 * Map a thrown known error to a `?error=<code>` redirect, preserving the
 * `?selected=<id>` query param when in scope so the drawer stays open on
 * the row that triggered the failure.
 *
 * `redirect()` throws internally; this function is `: never`.
 */
function handleKnownError(err: unknown, selectedId?: string | null): never {
  const selectedSuffix = selectedId ? `&selected=${encodeURIComponent(selectedId)}` : "";
  if (err instanceof ValidationError) {
    redirect(`${SERVICES_PATH}?error=${encodeURIComponent(err.code)}${selectedSuffix}`);
  }
  if (err instanceof PermissionError) {
    redirect(`${SERVICES_PATH}?error=${encodeURIComponent(err.code)}${selectedSuffix}`);
  }
  throw err;
}

/**
 * Map a Postgres error from supabase-js into the `?error=db_failure` redirect.
 * Logs the raw error for operator triage. Preserves `selectedId` when set.
 */
function mapDbError(err: unknown, where: string, selectedId?: string | null): never {
  console.error(`services action db error (${where})`, err);
  const selectedSuffix = selectedId ? `&selected=${encodeURIComponent(selectedId)}` : "";
  redirect(`${SERVICES_PATH}?error=db_failure${selectedSuffix}`);
}

/**
 * Parse the `staff_ids[]` array and the matching `override_min[<id>]` keys
 * out of the FormData, validating each id as a UUID and each override as a
 * positive integer (or null). Returns an ordered list — insertion order is
 * preserved so the audit payload's `assigned_staff_ids` array reads in the
 * order the UI submitted.
 */
function parseStaffAssignments(
  formData: FormData
): Array<{ staff_id: string; duration_min_override: number | null }> {
  const rawIds = formData.getAll("staff_ids[]");
  const seen = new Set<string>();
  const out: Array<{ staff_id: string; duration_min_override: number | null }> = [];
  for (const raw of rawIds) {
    const candidate = typeof raw === "string" ? raw.trim() : "";
    if (candidate.length === 0) continue;
    // Shape filter only — the DB foreign key on `staff_services.staff_id`
    // is the actual identity check. Use a loose `8-4-4-4-12` hex pattern so
    // non-v4 seeded ids (e.g. `10000000-0000-…`) are still accepted.
    if (!UUID_SHAPE_LOOSE.test(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const overrideRaw = formData.get(`override_min[${candidate}]`);
    const overrideStr = typeof overrideRaw === "string" ? overrideRaw : "";
    const overrideMin = validateOverrideMin(overrideStr);
    out.push({ staff_id: candidate, duration_min_override: overrideMin });
  }
  return out;
}

// ── 1. addService ────────────────────────────────────────────────────────

/**
 * Create a new service + its initial staff_services assignments.
 *
 * Contract: `contracts/server-actions.contract.md § 1`.
 *
 * Per Clarifications Q1 the persisted `price_cents` always reflects either
 * the fixed price (when `variable_price` is false) or `price_from_cents ?? 0`
 * (when `variable_price` is true). The `variable_price` flag is the sole
 * signal the catalog row uses to format the price label as a range.
 *
 * Per FR-029 / Clarifications Q4 the redirect lands on
 * `?selected=<newId>&toast=service_added&name=<encoded>` so the drawer stays
 * open and flips to Edit for the just-created service. When no techs were
 * assigned, the URL also gains `&secondary=no_techs_assigned` so the
 * URL-toast bridge (Phase 9) fires the secondary warning toast.
 */
export async function addService(formData: FormData): Promise<void> {
  // 1: session.
  const viewer = await requireStudioSession();

  // Validated field bindings. Declared outside the try so the post-validate
  // code can read them without TypeScript's definite-assignment quibble.
  let name: string;
  let category: string;
  let durationMin: number;
  let colorToken: string;
  let taxable: boolean;
  let variablePrice: boolean;
  let priceCents: number;
  let priceFromCents: number | null;
  let priceToCents: number | null;
  let variablePriceNote: string | null;
  let cardFeeMode: CardFeeMode;
  let cardFeeCustomCents: number | null;
  let supplyAmountCents: number | null;
  let supplyTypeId: string | null;
  let assignments: Array<{ staff_id: string; duration_min_override: number | null }>;

  try {
    // 2: role gate. Throws PermissionError → handleKnownError → redirect.
    assertCanWriteCatalog(viewer.staff.role);

    // 3: parse + validate every field.
    name = validateName(String(formData.get("name") ?? ""));
    category = validateCategory(String(formData.get("category") ?? ""));
    durationMin = validateDurationMin(String(formData.get("duration_min") ?? ""));
    colorToken = validateColor(String(formData.get("color_token") ?? ""));

    // FormData boolean convention: present "on" → true, absent → false.
    taxable = formData.get("taxable") === "on";
    variablePrice = formData.get("variable_price") === "on";

    if (variablePrice) {
      priceFromCents = validateBoundDollars(String(formData.get("price_from") ?? ""));
      priceToCents = validateBoundDollars(String(formData.get("price_to") ?? ""));
      validateBoundsConsistency(priceFromCents, priceToCents);
      // Per research § R1 the persisted `price_cents` is the lower bound (or
      // 0 when neither bound is set) so the cents column is always non-null.
      priceCents = priceFromCents ?? 0;
      const rawNote = String(formData.get("variable_price_note") ?? "").trim();
      variablePriceNote = rawNote.length > 0 ? rawNote : null;
    } else {
      priceCents = validateFixedPriceDollars(String(formData.get("price") ?? ""));
      priceFromCents = null;
      priceToCents = null;
      variablePriceNote = null;
    }

    // 021-services-deductions: card-fee mode + (when custom) the custom
    // amount; supply toggle + (when on) amount + label. The validators
    // ignore the buffer fields when their gating mode/toggle says they
    // shouldn't apply (per FR-014 / FR-021) — that's why the writes below
    // resolve to `null` outside the active branch.
    cardFeeMode = validateCardFeeMode(String(formData.get("card_fee_mode") ?? "default"));
    if (cardFeeMode === "custom") {
      cardFeeCustomCents = validateCardFeeCustomDollars(
        String(formData.get("card_fee_custom") ?? "")
      );
    } else {
      cardFeeCustomCents = null;
    }

    const supplyOn = formData.get("supply_on") === "on";
    if (supplyOn) {
      supplyAmountCents = validateSupplyAmountDollars(String(formData.get("supply_amount") ?? ""));
      // 022-supply-types-catalog: replaces validateSupplyLabel. Loose-UUID
      // shape filter only; the DB FK + defensive existence check below are
      // the real identity checks.
      supplyTypeId = validateSupplyTypeId(String(formData.get("supply_type_id") ?? ""));
    } else {
      supplyAmountCents = null;
      supplyTypeId = null;
    }

    assignments = parseStaffAssignments(formData);
  } catch (err) {
    handleKnownError(err);
  }

  const admin = createSupabaseServiceRoleClient();

  // 022-supply-types-catalog: defensive existence check (FR-016). The picker
  // already filters archived rows; this guards against a race where the
  // selected type was archived between picker render and form submit.
  if (supplyTypeId!) {
    const { data: typeRow, error: typeErr } = await admin
      .from("supply_types")
      .select("id")
      .eq("id", supplyTypeId!)
      .maybeSingle();
    if (typeErr) {
      mapDbError(typeErr, "supply_types.select");
    }
    if (!typeRow) {
      redirect(`${SERVICES_PATH}?error=invalid_supply_type`);
    }
  }

  // 6a: INSERT the service row via the service-role client (the `services`
  // table grants read to `authenticated` but no INSERT policy — service-role
  // bypasses RLS).
  const { data: inserted, error: insertErr } = await admin
    .from("services")
    .insert({
      name: name!,
      category: category!,
      duration_min: durationMin!,
      price_cents: priceCents!,
      color_token: colorToken!,
      taxable: taxable!,
      active: true,
      variable_price: variablePrice!,
      price_from_cents: priceFromCents!,
      price_to_cents: priceToCents!,
      variable_price_note: variablePriceNote!,
      // 021-services-deductions
      card_fee_mode: cardFeeMode!,
      card_fee_custom_cents: cardFeeCustomCents!,
      supply_amount_cents: supplyAmountCents!,
      // 022-supply-types-catalog
      supply_type_id: supplyTypeId!,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    mapDbError(insertErr, "services.insert");
  }

  const newId = inserted!.id;

  // 6b: INSERT each staff_services row. On any failure, delete the service
  // we just inserted to roll back the whole add (the user-visible outcome
  // is "both succeed or both fail").
  if (assignments!.length > 0) {
    const rows = assignments!.map((a) => ({
      service_id: newId,
      staff_id: a.staff_id,
      duration_min_override: a.duration_min_override,
    }));
    const { error: assignErr } = await admin.from("staff_services").insert(rows);
    if (assignErr) {
      // Manual rollback — no transaction available via supabase-js.
      const { error: cleanupErr } = await admin.from("services").delete().eq("id", newId);
      if (cleanupErr) {
        console.error("addService cleanup-after-assignment-failure also failed", cleanupErr);
      }
      mapDbError(assignErr, "staff_services.insert");
    }
  }

  // 7: audit row — awaited before redirect per Constitution III. Payload
  // shape per `contracts/audit.contract.md § 1`. The 5th arg
  // (`actingAsStaffId`) is the operator's staff id — distinct from `entity_id`
  // which is the just-created service.
  await recordAudit(
    "service.added",
    viewer.deviceUserId,
    newId,
    {
      name: name!,
      category: category!,
      duration_min: durationMin!,
      price_cents: priceCents!,
      color_token: colorToken!,
      taxable: taxable!,
      variable_price: variablePrice!,
      price_from_cents: priceFromCents!,
      price_to_cents: priceToCents!,
      variable_price_note: variablePriceNote!,
      // 021-services-deductions
      card_fee_mode: cardFeeMode!,
      card_fee_custom_cents: cardFeeCustomCents!,
      supply_amount_cents: supplyAmountCents!,
      // 022-supply-types-catalog
      supply_type_id: supplyTypeId!,
      assigned_staff_ids: assignments!.map((a) => a.staff_id),
    },
    viewer.staff.id
  );

  // 8: revalidate + redirect. Per Clarifications Q4 the drawer stays open
  // and flips to Edit mode — that's achieved by adding `?selected=<newId>`.
  // The `&secondary=no_techs_assigned` nudge was removed alongside the
  // staff-assignment UI; it has no actionable surface in the MVP.
  revalidatePath(SERVICES_PATH);
  redirect(
    `${SERVICES_PATH}?selected=${encodeURIComponent(newId)}&toast=service_added&name=${encodeURIComponent(name!)}`
  );
}

// ── 2. updateService ─────────────────────────────────────────────────────
//
// `SERVICE_DIFF_KEYS`, `ServiceDiffSnapshot`, and `buildChanges` live in
// the sibling module `./_audit-diff.ts` — `"use server"` files can only
// export async functions per Next 16's Server Action rules, so the
// constant + helper are factored out. The contract test imports them
// directly from `_audit-diff.ts`; this file's import keeps the same
// behavior the original in-line definition had.

/**
 * Update an existing service + its staff_services assignments.
 *
 * Contract: `contracts/server-actions.contract.md § 2`.
 *
 * Rollback strategy (per Phase 5 orchestrator note): snapshot the
 * baseline services row + the current staff_services rows; apply the
 * services UPDATE first, then the assignment ops (delete → insert →
 * update). If any step throws, replay the inverse ops to restore the
 * baseline.
 */
export async function updateService(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();

  // 1: parse service_id up front so error redirects can preserve `?selected=`.
  // Use the loose 8-4-4-4-12 hex shape (same as `parseStaffAssignments`) — the
  // strict RFC v4 check rejects seeded ids like `20000000-…-001` whose 3rd
  // group starts with `0`. The DB row read below is the real identity check.
  const rawId = String(formData.get("service_id") ?? "").trim();
  if (!UUID_SHAPE_LOOSE.test(rawId)) {
    redirect(`${SERVICES_PATH}?error=not_found`);
  }
  const serviceId = rawId;

  // 2: role gate.
  try {
    assertCanWriteCatalog(viewer.staff.role);
  } catch (err) {
    handleKnownError(err, serviceId!);
  }

  // 3: load baseline row + current assignments in parallel.
  const admin = createSupabaseServiceRoleClient();
  const baselineRowPromise = admin
    .from("services")
    .select(
      "id, name, category, duration_min, price_cents, color_token, taxable, active, variable_price, price_from_cents, price_to_cents, variable_price_note, card_fee_mode, card_fee_custom_cents, supply_amount_cents, supply_type_id"
    )
    .eq("id", serviceId!)
    .maybeSingle();
  const baselineAssignmentsPromise = admin
    .from("staff_services")
    .select("staff_id, duration_min_override")
    .eq("service_id", serviceId!);

  const [baselineRowRes, baselineAssignmentsRes] = await Promise.all([
    baselineRowPromise,
    baselineAssignmentsPromise,
  ]);

  if (baselineRowRes.error) {
    mapDbError(baselineRowRes.error, "services.select", serviceId!);
  }
  if (!baselineRowRes.data) {
    // Service id doesn't exist (deleted between page load and submit).
    redirect(`${SERVICES_PATH}?error=not_found`);
  }
  if (baselineAssignmentsRes.error) {
    mapDbError(baselineAssignmentsRes.error, "staff_services.select", serviceId!);
  }

  const baselineRow = baselineRowRes.data!;
  const baselineAssignments: ServiceAssignment[] = (baselineAssignmentsRes.data ?? []).map((r) => ({
    staff_id: r.staff_id,
    duration_min_override: r.duration_min_override,
  }));

  // 4: parse + validate every field from the FormData.
  let name: string;
  let category: string;
  let durationMin: number;
  let colorToken: string;
  let taxable: boolean;
  let variablePrice: boolean;
  let priceCents: number;
  let priceFromCents: number | null;
  let priceToCents: number | null;
  let variablePriceNote: string | null;
  let cardFeeMode: CardFeeMode;
  let cardFeeCustomCents: number | null;
  let supplyAmountCents: number | null;
  let supplyTypeId: string | null;
  let draftAssignments: ServiceAssignment[];

  try {
    name = validateName(String(formData.get("name") ?? ""));
    category = validateCategory(String(formData.get("category") ?? ""));
    durationMin = validateDurationMin(String(formData.get("duration_min") ?? ""));
    colorToken = validateColor(String(formData.get("color_token") ?? ""));
    taxable = formData.get("taxable") === "on";
    variablePrice = formData.get("variable_price") === "on";

    if (variablePrice) {
      priceFromCents = validateBoundDollars(String(formData.get("price_from") ?? ""));
      priceToCents = validateBoundDollars(String(formData.get("price_to") ?? ""));
      validateBoundsConsistency(priceFromCents, priceToCents);
      priceCents = priceFromCents ?? 0;
      const rawNote = String(formData.get("variable_price_note") ?? "").trim();
      variablePriceNote = rawNote.length > 0 ? rawNote : null;
    } else {
      priceCents = validateFixedPriceDollars(String(formData.get("price") ?? ""));
      priceFromCents = null;
      priceToCents = null;
      variablePriceNote = null;
    }

    // 021-services-deductions
    cardFeeMode = validateCardFeeMode(String(formData.get("card_fee_mode") ?? "default"));
    if (cardFeeMode === "custom") {
      cardFeeCustomCents = validateCardFeeCustomDollars(
        String(formData.get("card_fee_custom") ?? "")
      );
    } else {
      cardFeeCustomCents = null;
    }

    const supplyOn = formData.get("supply_on") === "on";
    if (supplyOn) {
      supplyAmountCents = validateSupplyAmountDollars(String(formData.get("supply_amount") ?? ""));
      // 022-supply-types-catalog: replaces validateSupplyLabel.
      supplyTypeId = validateSupplyTypeId(String(formData.get("supply_type_id") ?? ""));
    } else {
      supplyAmountCents = null;
      supplyTypeId = null;
    }

    draftAssignments = parseStaffAssignments(formData);
  } catch (err) {
    handleKnownError(err, serviceId!);
  }

  // 022-supply-types-catalog: defensive existence check (FR-016). Same
  // race window as addService — picker render → form submit → type was
  // archived/deleted in between.
  if (supplyTypeId!) {
    const { data: typeRow, error: typeErr } = await admin
      .from("supply_types")
      .select("id")
      .eq("id", supplyTypeId!)
      .maybeSingle();
    if (typeErr) {
      mapDbError(typeErr, "supply_types.select", serviceId!);
    }
    if (!typeRow) {
      redirect(
        `${SERVICES_PATH}?error=invalid_supply_type&selected=${encodeURIComponent(serviceId!)}`
      );
    }
  }

  // 5: compute the services patch + the assignment diff. The baseline's raw
  // `text` `card_fee_mode` is narrowed defensively (the DB check constraint
  // gates writes; this is a last-line guard so a malformed row never breaks
  // the diff).
  const baselineCardFeeMode: CardFeeMode =
    baselineRow.card_fee_mode === "custom" || baselineRow.card_fee_mode === "exempt"
      ? baselineRow.card_fee_mode
      : "default";

  const before: ServiceDiffSnapshot = {
    name: baselineRow.name,
    category: baselineRow.category,
    duration_min: baselineRow.duration_min,
    price_cents: baselineRow.price_cents,
    color_token: baselineRow.color_token,
    taxable: baselineRow.taxable,
    variable_price: baselineRow.variable_price,
    price_from_cents: baselineRow.price_from_cents,
    price_to_cents: baselineRow.price_to_cents,
    variable_price_note: baselineRow.variable_price_note,
    card_fee_mode: baselineCardFeeMode,
    card_fee_custom_cents: baselineRow.card_fee_custom_cents,
    supply_amount_cents: baselineRow.supply_amount_cents,
    supply_type_id: baselineRow.supply_type_id,
  };
  const after: ServiceDiffSnapshot = {
    name: name!,
    category: category!,
    duration_min: durationMin!,
    price_cents: priceCents!,
    color_token: colorToken!,
    taxable: taxable!,
    variable_price: variablePrice!,
    price_from_cents: priceFromCents!,
    price_to_cents: priceToCents!,
    variable_price_note: variablePriceNote!,
    card_fee_mode: cardFeeMode!,
    card_fee_custom_cents: cardFeeCustomCents!,
    supply_amount_cents: supplyAmountCents!,
    supply_type_id: supplyTypeId!,
  };

  const changes = buildChanges(before, after);
  const assignmentDiff = staffAssignmentDiff(baselineAssignments, draftAssignments!);
  const noServiceChange = Object.keys(changes).length === 0;
  const noAssignmentChange =
    assignmentDiff.added.length === 0 &&
    assignmentDiff.removed.length === 0 &&
    assignmentDiff.overrides_changed.length === 0;

  if (noServiceChange && noAssignmentChange) {
    redirect(`${SERVICES_PATH}?selected=${encodeURIComponent(serviceId!)}&error=no_changes`);
  }

  // 6: apply the services UPDATE (only when something changed) then
  //    the assignment ops (delete → insert → update). On failure, replay
  //    the inverse ops to restore the baseline.
  let serviceUpdateApplied = false;
  const appliedAssignmentOps: Array<
    | { kind: "delete"; staff_id: string; duration_min_override: number | null }
    | { kind: "insert"; staff_id: string }
    | { kind: "update"; staff_id: string; before: number | null }
  > = [];

  async function rollback(): Promise<void> {
    // Reverse the assignment ops first (LIFO).
    for (let i = appliedAssignmentOps.length - 1; i >= 0; i--) {
      const op = appliedAssignmentOps[i];
      try {
        if (op.kind === "insert") {
          await admin
            .from("staff_services")
            .delete()
            .eq("service_id", serviceId!)
            .eq("staff_id", op.staff_id);
        } else if (op.kind === "delete") {
          await admin.from("staff_services").insert({
            service_id: serviceId!,
            staff_id: op.staff_id,
            duration_min_override: op.duration_min_override,
          });
        } else {
          await admin
            .from("staff_services")
            .update({ duration_min_override: op.before })
            .eq("service_id", serviceId!)
            .eq("staff_id", op.staff_id);
        }
      } catch (rollbackErr) {
        console.error("updateService rollback step failed", rollbackErr);
      }
    }
    // Then restore the services row patch.
    if (serviceUpdateApplied) {
      try {
        await admin.from("services").update(before).eq("id", serviceId!);
      } catch (rollbackErr) {
        console.error("updateService services-row rollback failed", rollbackErr);
      }
    }
  }

  if (!noServiceChange) {
    // Build the patch as just the changed columns. (Even though the contract
    // permits writing all 10, narrowing here keeps the PG wire payload
    // small and makes the audit trail's diff symmetric with the SQL UPDATE.)
    const patch: Partial<ServiceDiffSnapshot> = {};
    for (const key of SERVICE_DIFF_KEYS) {
      if (key in changes) {
        // The runtime check above guarantees the cast is sound.
        (patch as Record<string, unknown>)[key] = after[key];
      }
    }
    const { error: updateErr } = await admin.from("services").update(patch).eq("id", serviceId!);
    if (updateErr) {
      mapDbError(updateErr, "services.update", serviceId!);
    }
    serviceUpdateApplied = true;
  }

  // Build a map for the rollback's "before override" lookup.
  const baselineByStaffId = new Map(
    baselineAssignments.map((a) => [a.staff_id, a.duration_min_override])
  );

  // Apply deletes first.
  for (const staffId of assignmentDiff.removed) {
    const { error } = await admin
      .from("staff_services")
      .delete()
      .eq("service_id", serviceId!)
      .eq("staff_id", staffId);
    if (error) {
      await rollback();
      mapDbError(error, "staff_services.delete", serviceId!);
    }
    appliedAssignmentOps.push({
      kind: "delete",
      staff_id: staffId,
      duration_min_override: baselineByStaffId.get(staffId) ?? null,
    });
  }

  // Then inserts.
  for (const row of assignmentDiff.added) {
    const { error } = await admin.from("staff_services").insert({
      service_id: serviceId!,
      staff_id: row.staff_id,
      duration_min_override: row.duration_min_override,
    });
    if (error) {
      await rollback();
      mapDbError(error, "staff_services.insert", serviceId!);
    }
    appliedAssignmentOps.push({ kind: "insert", staff_id: row.staff_id });
  }

  // Then override updates.
  for (const change of assignmentDiff.overrides_changed) {
    const { error } = await admin
      .from("staff_services")
      .update({ duration_min_override: change.after })
      .eq("service_id", serviceId!)
      .eq("staff_id", change.staff_id);
    if (error) {
      await rollback();
      mapDbError(error, "staff_services.update", serviceId!);
    }
    appliedAssignmentOps.push({
      kind: "update",
      staff_id: change.staff_id,
      before: change.before,
    });
  }

  // 7: audit row. Payload shape per `contracts/audit.contract.md § 2`.
  const baselineAssignmentIds = baselineAssignments.map((a) => a.staff_id);
  const afterAssignmentIds = draftAssignments!.map((a) => a.staff_id);
  await recordAudit(
    "service.updated",
    viewer.deviceUserId,
    serviceId!,
    {
      changes,
      assignment_changes: {
        added: assignmentDiff.added.map((a) => a.staff_id),
        removed: assignmentDiff.removed,
        overrides_changed: assignmentDiff.overrides_changed,
      },
      before: {
        name: baselineRow.name,
        category: baselineRow.category,
        duration_min: baselineRow.duration_min,
        price_cents: baselineRow.price_cents,
        color_token: baselineRow.color_token,
        taxable: baselineRow.taxable,
        active: baselineRow.active,
        variable_price: baselineRow.variable_price,
        price_from_cents: baselineRow.price_from_cents,
        price_to_cents: baselineRow.price_to_cents,
        variable_price_note: baselineRow.variable_price_note,
        // 021-services-deductions
        card_fee_mode: baselineCardFeeMode,
        card_fee_custom_cents: baselineRow.card_fee_custom_cents,
        supply_amount_cents: baselineRow.supply_amount_cents,
        // 022-supply-types-catalog
        supply_type_id: baselineRow.supply_type_id,
        assignment_ids: baselineAssignmentIds,
      },
      after: {
        name: name!,
        category: category!,
        duration_min: durationMin!,
        price_cents: priceCents!,
        color_token: colorToken!,
        taxable: taxable!,
        active: baselineRow.active, // unchanged by updateService
        variable_price: variablePrice!,
        price_from_cents: priceFromCents!,
        price_to_cents: priceToCents!,
        variable_price_note: variablePriceNote!,
        // 021-services-deductions
        card_fee_mode: cardFeeMode!,
        card_fee_custom_cents: cardFeeCustomCents!,
        supply_amount_cents: supplyAmountCents!,
        // 022-supply-types-catalog
        supply_type_id: supplyTypeId!,
        assignment_ids: afterAssignmentIds,
      },
    },
    viewer.staff.id
  );

  // 8: revalidate + redirect. The `&secondary=no_techs_assigned` nudge was
  // removed alongside the staff-assignment UI (FR-029 deferred to next phase).
  revalidatePath(SERVICES_PATH);
  redirect(`${SERVICES_PATH}?selected=${encodeURIComponent(serviceId!)}&toast=changes_saved`);
}

// ── 3. archiveService ────────────────────────────────────────────────────

/**
 * Flip a service to `active = false`.
 *
 * Contract: `contracts/server-actions.contract.md § 3`.
 *
 * Per FR-024 the lifecycle is reversible — `staff_services` is left
 * untouched so a later restore lands back on the same assignments.
 *
 * Per `contracts/audit.contract.md § 3` the audit payload is `{ name }`
 * only (captured here so the audit reads naturally even if the row is
 * later renamed).
 */
export async function archiveService(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();

  // 1: parse service_id. Same loose 8-4-4-4-12 hex shape as `updateService`
  // — the seeded ids (e.g. `20000000-…-001`) aren't strict RFC v4. The DB
  // row read below is the real identity check.
  const rawId = String(formData.get("service_id") ?? "").trim();
  if (!UUID_SHAPE_LOOSE.test(rawId)) {
    redirect(`${SERVICES_PATH}?error=not_found`);
  }
  const serviceId = rawId;

  // 2: role gate.
  try {
    assertCanWriteCatalog(viewer.staff.role);
  } catch (err) {
    handleKnownError(err, serviceId);
  }

  // 3: load target row to check current active state + capture the name
  // for the audit payload.
  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("services")
    .select("id, name, active")
    .eq("id", serviceId)
    .maybeSingle();

  if (loadErr) {
    mapDbError(loadErr, "services.select", serviceId);
  }
  if (!target) {
    redirect(`${SERVICES_PATH}?error=not_found`);
  }

  // 4: pre-check — already archived → ?error=no_changes (defense in depth
  // against a stale-tab re-submit).
  if (target.active === false) {
    redirect(`${SERVICES_PATH}?selected=${encodeURIComponent(serviceId)}&error=no_changes`);
  }

  // 5: UPDATE active = false.
  const { error: updateErr } = await admin
    .from("services")
    .update({ active: false })
    .eq("id", serviceId);
  if (updateErr) {
    mapDbError(updateErr, "services.update.archive", serviceId);
  }

  // 6: audit — awaited before redirect per Constitution III. Payload shape
  // per `contracts/audit.contract.md § 3` ({ name } only).
  await recordAudit(
    "service.archived",
    viewer.deviceUserId,
    serviceId,
    { name: target.name },
    viewer.staff.id
  );

  // 7: revalidate + redirect. The drawer stays open on the archived row so
  // the bottom-action button can flip to "Restore service" on the next render.
  revalidatePath(SERVICES_PATH);
  redirect(
    `${SERVICES_PATH}?selected=${encodeURIComponent(serviceId)}&toast=service_archived&name=${encodeURIComponent(target.name)}`
  );
}

// ── 4. restoreService ────────────────────────────────────────────────────

/**
 * Flip a service to `active = true`.
 *
 * Contract: `contracts/server-actions.contract.md § 4`.
 *
 * Mirror of `archiveService` with the active boolean inverted and the
 * verb / toast key swapped.
 */
export async function restoreService(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();

  // 1: parse service_id (same loose shape as archiveService).
  const rawId = String(formData.get("service_id") ?? "").trim();
  if (!UUID_SHAPE_LOOSE.test(rawId)) {
    redirect(`${SERVICES_PATH}?error=not_found`);
  }
  const serviceId = rawId;

  // 2: role gate.
  try {
    assertCanWriteCatalog(viewer.staff.role);
  } catch (err) {
    handleKnownError(err, serviceId);
  }

  // 3: load target row.
  const admin = createSupabaseServiceRoleClient();
  const { data: target, error: loadErr } = await admin
    .from("services")
    .select("id, name, active")
    .eq("id", serviceId)
    .maybeSingle();

  if (loadErr) {
    mapDbError(loadErr, "services.select", serviceId);
  }
  if (!target) {
    redirect(`${SERVICES_PATH}?error=not_found`);
  }

  // 4: pre-check — already active → ?error=no_changes.
  if (target.active === true) {
    redirect(`${SERVICES_PATH}?selected=${encodeURIComponent(serviceId)}&error=no_changes`);
  }

  // 5: UPDATE active = true.
  const { error: updateErr } = await admin
    .from("services")
    .update({ active: true })
    .eq("id", serviceId);
  if (updateErr) {
    mapDbError(updateErr, "services.update.restore", serviceId);
  }

  // 6: audit.
  await recordAudit(
    "service.restored",
    viewer.deviceUserId,
    serviceId,
    { name: target.name },
    viewer.staff.id
  );

  // 7: revalidate + redirect.
  revalidatePath(SERVICES_PATH);
  redirect(
    `${SERVICES_PATH}?selected=${encodeURIComponent(serviceId)}&toast=service_restored&name=${encodeURIComponent(target.name)}`
  );
}

// ── 5. loadServiceWithAssignments — moved to `./_load.ts` ────────────────
//
// Per `contracts/server-actions.contract.md § 5` the typed read helper was
// originally specified as a sibling export from `actions.ts`. Next.js's
// `"use server"` directive (line 1 of this file) forbids non-async exports,
// so the helper lives in `./_load.ts` instead. The page imports it
// directly from there; consumers should never need to import it from
// `actions.ts`. Documented as a Phase 5 deviation in the task report.
