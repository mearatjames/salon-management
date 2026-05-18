"use server";

// Server Actions for the supply-types catalog (Edit Policy sheet on the
// services surface). Four mutation verbs:
//   - createSupplyType / createSupplyTypeForPicker (T020 — two callable shapes)
//   - renameSupplyType (T021)
//   - archiveSupplyType (T022)
//   - reactivateSupplyType (T023)
//
// Plus one module-internal helper:
//   - revalidateSupplyTypeConsumers (T024) — NOT exported (a `"use server"`
//     file's exports are auto Server Actions; this helper must stay local).
//
// All four actions follow the prelude established by 008/021:
//   1. requireStudioSession           (auth — throws AuthRedirectError)
//   2. assertCanWriteCatalog          (owner OR manager — defense in depth)
//   3. parse + validate FormData      (per-action; via _validation.ts)
//   4. load target row                (skipped for createSupplyType)
//   5. (no per-target matrix — step 2 is the entire check)
//   6. mutate via service-role client (RLS-bypassing INSERT/UPDATE)
//   7. await recordAudit              (no redirect until audit row commits)
//   8. revalidateSupplyTypeConsumers + redirect (success: ?toast=…; failure: ?error=…)
//
// Contracts:
//   - specs/022-supply-types-catalog/contracts/server-actions.contract.md §§ 1–4
//   - specs/022-supply-types-catalog/contracts/audit-payload.contract.md §§ 1–4

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";
import { canonicalizeName } from "@/lib/policy/canonicalize-name";

import { ValidationError, type ValidationErrorCode } from "../../services/_validation";
import { assertCanWriteCatalog, PermissionError } from "./permissions";
import { validateSupplyTypeName } from "./_validation";
import { validateSupplyTypeId } from "../../services/_validation";

const POLICY_REDIRECT = "/services?policy=open";
const PG_UNIQUE_VIOLATION = "23505";

// Module-internal: NOT exported. The `"use server"` directive above makes
// every exported function a Server Action; this helper must stay local
// per research § R6 and the orchestrator's hard constraint.
function revalidateSupplyTypeConsumers(): void {
  revalidatePath("/services");
  revalidatePath("/settings/staff");
}

// ── Shared internal impl for create ─────────────────────────────────────

export type CreateResult =
  | { kind: "idle" }
  | { kind: "ok"; id: string; name: string }
  | {
      kind: "error";
      code: "name_too_short" | "name_too_long" | "name_taken" | "db_failure" | "forbidden";
    };

// Module-internal: NOT exported (would become a Server Action). Shared
// validation + INSERT + audit + revalidate. Both `createSupplyType`
// (form-based, redirects) and `createSupplyTypeForPicker` (programmatic,
// returns CreateResult) go through this.
async function _createSupplyTypeImpl(name: string, viewer: StudioViewer): Promise<CreateResult> {
  const admin = createSupabaseServiceRoleClient();
  const { data, error } = await admin
    .from("supply_types")
    .insert({ name })
    .select("id, name")
    .single();

  if (error) {
    // Map PG 23505 (partial unique on name_canonical where archived=false)
    // to the public `name_taken` code.
    if (error.code === PG_UNIQUE_VIOLATION) {
      return { kind: "error", code: "name_taken" };
    }
    console.error("createSupplyType insert failed", error);
    return { kind: "error", code: "db_failure" };
  }

  await recordAudit(
    "supply_type.created",
    viewer.deviceUserId,
    data.id,
    { name: data.name },
    viewer.staff.id
  );

  revalidateSupplyTypeConsumers();
  return { kind: "ok", id: data.id, name: data.name };
}

// ── 1a. createSupplyType — form-based, redirects ─────────────────────────

export async function createSupplyType(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();

  let name: string;
  try {
    assertCanWriteCatalog(viewer.staff.role);
    name = validateSupplyTypeName(String(formData.get("name") ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`${POLICY_REDIRECT}&error=${encodeURIComponent(err.code)}`);
    }
    if (err instanceof PermissionError) {
      redirect(`${POLICY_REDIRECT}&error=forbidden`);
    }
    throw err;
  }

  const result = await _createSupplyTypeImpl(name, viewer);
  if (result.kind !== "ok") {
    // `idle` shouldn't surface from the impl; treat defensively as db_failure.
    const code = result.kind === "error" ? result.code : "db_failure";
    redirect(`${POLICY_REDIRECT}&error=${encodeURIComponent(code)}`);
  }
  redirect(`${POLICY_REDIRECT}&toast=supply_type_created&name=${encodeURIComponent(result.name)}`);
}

// ── 1b. createSupplyTypeForPicker — programmatic, returns CreateResult ──

export async function createSupplyTypeForPicker(
  _prev: CreateResult,
  formData: FormData
): Promise<CreateResult> {
  let viewer: StudioViewer;
  try {
    viewer = await requireStudioSession();
  } catch {
    // Auth redirect errors aren't catchable as `CreateResult` — the picker
    // surfaces this as a generic forbidden / re-auth path. Map to forbidden.
    return { kind: "error", code: "forbidden" };
  }

  let name: string;
  try {
    assertCanWriteCatalog(viewer.staff.role);
    name = validateSupplyTypeName(String(formData.get("name") ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      // Narrow: only the picker-surfaced codes are in the public union.
      const code = err.code as ValidationErrorCode;
      if (code === "name_too_short" || code === "name_too_long") {
        return { kind: "error", code };
      }
      return { kind: "error", code: "db_failure" };
    }
    if (err instanceof PermissionError) {
      return { kind: "error", code: "forbidden" };
    }
    console.error("createSupplyTypeForPicker unexpected error", err);
    return { kind: "error", code: "db_failure" };
  }

  return await _createSupplyTypeImpl(name, viewer);
}

// ── 2. renameSupplyType ─────────────────────────────────────────────────

export async function renameSupplyType(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();

  let supplyTypeId: string;
  let name: string;
  try {
    assertCanWriteCatalog(viewer.staff.role);
    supplyTypeId = validateSupplyTypeId(String(formData.get("supply_type_id") ?? ""));
    name = validateSupplyTypeName(String(formData.get("name") ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`${POLICY_REDIRECT}&error=${encodeURIComponent(err.code)}`);
    }
    if (err instanceof PermissionError) {
      redirect(`${POLICY_REDIRECT}&error=forbidden`);
    }
    throw err;
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: existingRow, error: loadErr } = await admin
    .from("supply_types")
    .select("id, name, archived")
    .eq("id", supplyTypeId)
    .maybeSingle();

  if (loadErr) {
    console.error("renameSupplyType load failed", loadErr);
    redirect(`${POLICY_REDIRECT}&error=db_failure`);
  }
  if (!existingRow) {
    redirect(`${POLICY_REDIRECT}&error=type_not_found`);
  }
  if (existingRow.archived) {
    redirect(`${POLICY_REDIRECT}&error=type_archived`);
  }

  // No-changes short-circuit: case-insensitive + whitespace-canonical
  // comparison. No audit row written per audit-payload.contract.md § 2.
  if (canonicalizeName(name) === canonicalizeName(existingRow.name)) {
    revalidateSupplyTypeConsumers();
    redirect(`${POLICY_REDIRECT}&error=no_changes`);
  }

  const { error: updateErr } = await admin
    .from("supply_types")
    .update({ name })
    .eq("id", supplyTypeId);
  if (updateErr) {
    if (updateErr.code === PG_UNIQUE_VIOLATION) {
      redirect(`${POLICY_REDIRECT}&error=name_taken`);
    }
    console.error("renameSupplyType update failed", updateErr);
    redirect(`${POLICY_REDIRECT}&error=db_failure`);
  }

  await recordAudit(
    "supply_type.renamed",
    viewer.deviceUserId,
    supplyTypeId,
    { before: { name: existingRow.name }, after: { name } },
    viewer.staff.id
  );

  revalidateSupplyTypeConsumers();
  redirect(`${POLICY_REDIRECT}&toast=supply_type_renamed`);
}

// ── 3. archiveSupplyType ────────────────────────────────────────────────

export async function archiveSupplyType(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();

  let supplyTypeId: string;
  try {
    assertCanWriteCatalog(viewer.staff.role);
    supplyTypeId = validateSupplyTypeId(String(formData.get("supply_type_id") ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`${POLICY_REDIRECT}&error=${encodeURIComponent(err.code)}`);
    }
    if (err instanceof PermissionError) {
      redirect(`${POLICY_REDIRECT}&error=forbidden`);
    }
    throw err;
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: targetRow, error: loadErr } = await admin
    .from("supply_types")
    .select("id, name, archived")
    .eq("id", supplyTypeId)
    .maybeSingle();
  if (loadErr) {
    console.error("archiveSupplyType load failed", loadErr);
    redirect(`${POLICY_REDIRECT}&error=db_failure`);
  }
  if (!targetRow) {
    redirect(`${POLICY_REDIRECT}&error=type_not_found`);
  }
  if (targetRow.archived) {
    redirect(`${POLICY_REDIRECT}&error=type_already_archived`);
  }

  // Pre-check: at least one active service references this type → block.
  const { count, error: countErr } = await admin
    .from("services")
    .select("id", { count: "exact", head: true })
    .eq("supply_type_id", supplyTypeId)
    .eq("active", true);
  if (countErr) {
    console.error("archiveSupplyType count failed", countErr);
    redirect(`${POLICY_REDIRECT}&error=db_failure`);
  }
  if ((count ?? 0) > 0) {
    redirect(`${POLICY_REDIRECT}&error=type_in_use&blocked_count=${count}`);
  }

  const { error: updateErr } = await admin
    .from("supply_types")
    .update({ archived: true })
    .eq("id", supplyTypeId);
  if (updateErr) {
    console.error("archiveSupplyType update failed", updateErr);
    redirect(`${POLICY_REDIRECT}&error=db_failure`);
  }

  await recordAudit(
    "supply_type.archived",
    viewer.deviceUserId,
    supplyTypeId,
    { name: targetRow.name },
    viewer.staff.id
  );

  revalidateSupplyTypeConsumers();
  redirect(
    `${POLICY_REDIRECT}&toast=supply_type_archived&name=${encodeURIComponent(targetRow.name)}`
  );
}

// ── 4. reactivateSupplyType ─────────────────────────────────────────────

export async function reactivateSupplyType(formData: FormData): Promise<void> {
  const viewer = await requireStudioSession();

  let supplyTypeId: string;
  try {
    assertCanWriteCatalog(viewer.staff.role);
    supplyTypeId = validateSupplyTypeId(String(formData.get("supply_type_id") ?? ""));
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`${POLICY_REDIRECT}&error=${encodeURIComponent(err.code)}`);
    }
    if (err instanceof PermissionError) {
      redirect(`${POLICY_REDIRECT}&error=forbidden`);
    }
    throw err;
  }

  const admin = createSupabaseServiceRoleClient();
  const { data: targetRow, error: loadErr } = await admin
    .from("supply_types")
    .select("id, name, archived")
    .eq("id", supplyTypeId)
    .maybeSingle();
  if (loadErr) {
    console.error("reactivateSupplyType load failed", loadErr);
    redirect(`${POLICY_REDIRECT}&error=db_failure`);
  }
  if (!targetRow) {
    redirect(`${POLICY_REDIRECT}&error=type_not_found`);
  }
  if (!targetRow.archived) {
    redirect(`${POLICY_REDIRECT}&error=type_already_active`);
  }

  const { error: updateErr } = await admin
    .from("supply_types")
    .update({ archived: false })
    .eq("id", supplyTypeId);
  if (updateErr) {
    // Reactivating could collide with an existing active type's canonical
    // name on the partial unique index.
    if (updateErr.code === PG_UNIQUE_VIOLATION) {
      redirect(`${POLICY_REDIRECT}&error=name_taken`);
    }
    console.error("reactivateSupplyType update failed", updateErr);
    redirect(`${POLICY_REDIRECT}&error=db_failure`);
  }

  await recordAudit(
    "supply_type.reactivated",
    viewer.deviceUserId,
    supplyTypeId,
    { name: targetRow.name },
    viewer.staff.id
  );

  revalidateSupplyTypeConsumers();
  redirect(
    `${POLICY_REDIRECT}&toast=supply_type_reactivated&name=${encodeURIComponent(targetRow.name)}`
  );
}
