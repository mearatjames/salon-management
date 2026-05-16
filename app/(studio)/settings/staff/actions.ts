"use server";

// Server Actions for Settings → Staff. Each action follows the shared
// prelude documented in server-actions.contract.md § Shared prelude:
//   1. requireStudioSession           (auth resolver — throws AuthRedirectError)
//   2. operator-role gate             (owner or manager — defense in depth)
//   3. parse + validate FormData      (per-action; via _validation.ts)
//   4. load target + isLastOwner      (skipped for addStaff; no target yet)
//   5. assertMutationAllowed          (permission matrix; the trust boundary)
//   6. mutate                         (INSERT/UPDATE via service-role client)
//   7. await recordAudit              (no row before audit row commits)
//   8. revalidatePath + redirect      (success: `?toast=…`; failure: `?error=…`)
//
// US2 (this commit) implements `addStaff`. US3+ append updateStaff,
// setStaffPin, deactivateStaff, reactivateStaff, removeStaff.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/auth/audit";
import { hashPin } from "@/lib/auth/pin";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession, type StudioViewer } from "@/lib/auth/session";

import {
  PermissionError,
  assertMutationAllowed,
  type StaffAction,
  type StudioRole,
} from "./permissions";
import {
  ValidationError,
  validateColor,
  validateDisplayName,
  validatePinShape,
  validateRole,
} from "./_validation";

const STAFF_PATH = "/settings/staff";

/**
 * Defense-in-depth role gate. The settings layout (T014) already redirects
 * non-owner/manager visitors to `/dashboard`; this lives in every Server
 * Action so a direct `page.request.post()` against the action endpoint
 * still fails closed without leaking through to the DB.
 */
function assertCanEnterSettings(viewer: StudioViewer): void {
  if (viewer.staff.role !== "owner" && viewer.staff.role !== "manager") {
    redirect("/dashboard?error=forbidden");
  }
}

/**
 * Map a thrown error to the documented `?error=<code>` redirect. Per the
 * contract, ValidationError and PermissionError both surface as page-level
 * `?error=`; anything else propagates so Next can render the error page.
 *
 * Note: `redirect()` throws internally so it terminates the action.
 *
 * If `selectedId` is provided, the redirect preserves `?selected=<id>` so
 * the edit panel stays open on the row that triggered the failure
 * (matches updateStaff/setStaffPin/etc.).
 */
function handleKnownError(err: unknown, selectedId?: string | null): never {
  const selectedSuffix = selectedId ? `&selected=${encodeURIComponent(selectedId)}` : "";
  if (err instanceof ValidationError) {
    redirect(`${STAFF_PATH}?error=${encodeURIComponent(err.code)}${selectedSuffix}`);
  }
  if (err instanceof PermissionError) {
    redirect(`${STAFF_PATH}?error=${encodeURIComponent(err.code)}${selectedSuffix}`);
  }
  throw err;
}

/**
 * addStaff — create a new staff row.
 *
 * Contract: server-actions.contract.md § 1.
 *
 * **PIN-required deviation** (noted in plan): the `staff` table CHECK
 * constraint `(pin_hash IS NOT NULL OR user_id IS NOT NULL)` would reject
 * any new row that has neither a PIN nor a linked Supabase user. The Add
 * wizard does not link a Supabase user, so v1 makes PIN required on Add.
 * The contract's `pin` field is documented as optional but the wizard
 * always submits one (the success path in quickstart.md § US2 confirms
 * this). If callers submit without a PIN, validatePinShape throws
 * `invalid_pin_shape` and the wizard returns to step 2.
 */
export async function addStaff(formData: FormData): Promise<void> {
  // 1 + 2: session + role gate.
  const viewer = await requireStudioSession();
  assertCanEnterSettings(viewer);

  let displayName: string;
  let role: StudioRole;
  let colorToken: string;
  let pinPlain: string;
  let pinHash: string;
  let pinSet: boolean;

  try {
    // 3: parse + validate FormData.
    displayName = validateDisplayName(String(formData.get("display_name") ?? ""));
    role = validateRole(String(formData.get("role") ?? ""));
    colorToken = validateColor(String(formData.get("color_token") ?? ""));
    pinPlain = validatePinShape(String(formData.get("pin") ?? ""));

    // 5: permission matrix (no step 4 — addStaff has no target).
    assertMutationAllowed(
      { operator: viewer.staff, target: null, isLastOwner: false },
      "add",
      role
    );

    // 6a: hash the PIN before INSERT — the raw PIN never touches the DB.
    pinHash = await hashPin(pinPlain);
    pinSet = true;
  } catch (err) {
    handleKnownError(err);
  }

  // 6b: INSERT via the service-role client (the `staff` table has no INSERT
  // policy for `authenticated`; service-role bypasses RLS). The returned id
  // becomes the redirect's `?selected=` target and the audit row's
  // entity_id.
  const admin = createSupabaseServiceRoleClient();
  const { data: inserted, error: insertErr } = await admin
    .from("staff")
    .insert({
      display_name: displayName!,
      role: role!,
      color_token: colorToken!,
      pin_hash: pinHash!,
      active: true,
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    // The last-owner trigger fires on UPDATE/DELETE, not INSERT, so the
    // only realistic failure here is the (pin_hash | user_id) CHECK
    // violation — already prevented by the PIN-required path above. Any
    // other DB error is logged and surfaces as a generic `?error=`.
    console.error("addStaff INSERT failed", insertErr);
    redirect(`${STAFF_PATH}?error=not_found`);
  }

  const newId = inserted!.id;

  // 7: audit row — awaited before redirect per Constitution III.
  // Payload shape per audit.contract.md § staff.added. Raw PIN never in
  // the payload; only the boolean `pin_set`.
  await recordAudit("staff.added", viewer.deviceUserId, newId, {
    display_name: displayName!,
    role: role!,
    color_token: colorToken!,
    pin_set: pinSet!,
  });

  // 8: revalidate the roster cache, then redirect.
  revalidatePath(STAFF_PATH);
  redirect(
    `${STAFF_PATH}?selected=${encodeURIComponent(newId)}&toast=staff_added&name=${encodeURIComponent(displayName!)}`
  );
}

// ── updateStaff ──────────────────────────────────────────────────────────
//
// Contract: server-actions.contract.md § 2. Atomic edit of any of
// `display_name`, `role`, `color_token`, `active`. The Server Action
// computes the diff against the saved row, evaluates the permission matrix
// once per changed field, UPDATEs the changed columns in a single statement,
// and writes one `staff.updated` audit row with a diff-aware payload.
//
// Diff-aware payload (audit.contract.md § staff.updated):
//   {
//     changes: { <field>: [before, after], ... },  // only changed keys
//     before:  { display_name, role, color_token, active },
//     after:   { display_name, role, color_token, active },
//   }
//
// Permission-check ordering matches the StaffAction enum order so test
// expectations are deterministic when multiple gates would fire:
// name → role → color → active.

type StaffSnapshot = {
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
};

type StaffRowFromDb = StaffSnapshot & {
  id: string;
  removed_at: string | null;
};

/** Ordered (name → role → color → active) so the first failure is deterministic. */
const UPDATE_FIELD_TO_ACTION: ReadonlyArray<{
  key: keyof StaffSnapshot;
  action: StaffAction;
}> = [
  { key: "display_name", action: "update_name" },
  { key: "role", action: "update_role" },
  { key: "color_token", action: "update_color" },
  { key: "active", action: "update_active" },
];

export async function updateStaff(formData: FormData): Promise<void> {
  // 1 + 2: session + role gate.
  const viewer = await requireStudioSession();
  assertCanEnterSettings(viewer);

  // 3: parse the staff_id first — it is needed for the failure-path redirect
  // so the panel stays open on the right row when an error fires.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${STAFF_PATH}?error=not_found`);
  }

  // 4: load the target row.
  const admin = createSupabaseServiceRoleClient();
  const { data: targetRow, error: loadErr } = await admin
    .from("staff")
    .select("id, display_name, role, color_token, active, removed_at")
    .eq("id", staffId)
    .single();

  if (loadErr || !targetRow || targetRow.removed_at !== null) {
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }
  const target: StaffRowFromDb = {
    id: targetRow!.id,
    display_name: targetRow!.display_name,
    role: targetRow!.role as StudioRole,
    color_token: targetRow!.color_token,
    active: targetRow!.active,
    removed_at: targetRow!.removed_at,
  };

  // Compute isLastOwner: count active, non-removed owners excluding the
  // target. If target is owner and the count is 0, target IS the last owner.
  let isLastOwner = false;
  if (target.role === "owner") {
    const { count, error: countErr } = await admin
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner")
      .eq("active", true)
      .is("removed_at", null)
      .neq("id", target.id);
    if (countErr) {
      console.error("updateStaff isLastOwner count failed", countErr);
      redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
    }
    isLastOwner = (count ?? 0) === 0;
  }

  // 5: validate field shapes + diff + permission matrix per changed field.
  let nextSnapshot: StaffSnapshot;
  let changedKeys: (keyof StaffSnapshot)[];

  try {
    const proposed: StaffSnapshot = {
      display_name: validateDisplayName(String(formData.get("display_name") ?? "")),
      role: validateRole(String(formData.get("role") ?? "")),
      color_token: validateColor(String(formData.get("color_token") ?? "")),
      // FormData encodes unchecked switches by omission; "on" means checked.
      active: formData.get("active") === "on",
    };

    // Compute diff.
    changedKeys = UPDATE_FIELD_TO_ACTION.filter(({ key }) => proposed[key] !== target[key]).map(
      ({ key }) => key
    );

    if (changedKeys.length === 0) {
      // Defense-in-depth: the UI's Save button is disabled when there's no
      // diff, so this is unreachable in practice. Surface it as a soft error
      // anyway so a direct POST fails cleanly.
      redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=no_changes`);
    }

    // Evaluate the matrix once per changed field. First throw wins
    // (deterministic order: name → role → color → active).
    for (const { key, action } of UPDATE_FIELD_TO_ACTION) {
      if (!changedKeys.includes(key)) continue;
      const newRole = action === "update_role" ? proposed.role : undefined;
      assertMutationAllowed(
        {
          operator: viewer.staff,
          target: {
            id: target.id,
            role: target.role,
            active: target.active,
          },
          isLastOwner,
        },
        action,
        newRole
      );
    }

    nextSnapshot = proposed;
  } catch (err) {
    handleKnownError(err, staffId);
  }

  // 6: UPDATE only the changed columns. Single statement, atomic.
  const updatePatch: Partial<StaffSnapshot> = {};
  for (const key of changedKeys!) {
    // TypeScript: narrowed via the constant array above.
    (updatePatch as Record<string, unknown>)[key] = nextSnapshot![key];
  }

  const { error: updateErr } = await admin.from("staff").update(updatePatch).eq("id", target.id);

  if (updateErr) {
    // The last-owner trigger raises check_violation. We treat any
    // constraint-style error class as last_owner here because the only
    // constraint defined on staff updates in this feature is the trigger;
    // unknown errors still surface via the catch-all below.
    const code = (updateErr as { code?: string }).code;
    if (code === "23514" || code === "P0001") {
      redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=last_owner`);
    }
    console.error("updateStaff UPDATE failed", updateErr);
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  // 7: audit row — diff-aware payload. Only changed keys appear in
  // `changes`; `before` and `after` are always the full 4-field snapshot.
  const changes: Record<string, [unknown, unknown]> = {};
  for (const key of changedKeys!) {
    changes[key] = [target[key], nextSnapshot![key]];
  }
  const beforeSnap: StaffSnapshot = {
    display_name: target.display_name,
    role: target.role,
    color_token: target.color_token,
    active: target.active,
  };

  await recordAudit("staff.updated", viewer.deviceUserId, target.id, {
    changes,
    before: beforeSnap,
    after: nextSnapshot!,
  });

  // 8: revalidate + redirect. If `active` flipped true → false, the redirect
  // surfaces the dedicated "deactivated" toast. Otherwise it's "changes_saved".
  revalidatePath(STAFF_PATH);

  const deactivated =
    changedKeys!.includes("active") && target.active === true && nextSnapshot!.active === false;
  if (deactivated) {
    redirect(
      `${STAFF_PATH}?selected=${encodeURIComponent(target.id)}&toast=staff_deactivated&name=${encodeURIComponent(nextSnapshot!.display_name)}`
    );
  }
  redirect(`${STAFF_PATH}?selected=${encodeURIComponent(target.id)}&toast=changes_saved`);
}

// ── setStaffPin ──────────────────────────────────────────────────────────
//
// Contract: server-actions.contract.md § 3. Hashes and persists a new PIN
// for a staff member. Used by both the "Set PIN" (target has null pin_hash)
// and "Change" (target has existing pin_hash) flows in the edit panel —
// they're the same operation server-side; the only difference is the
// `previous_pin_set` boolean recorded in the audit payload.
//
// Permission matrix action: `set_pin`. Allowed: owner × any target,
// manager × non-owner target, any × self. Rejected: manager × owner →
// `forbidden_target`.
//
// Audit payload shape (audit.contract.md § staff.pin_set):
//   { previous_pin_set: boolean }
// The raw PIN is NEVER in the payload (Constitution III + spec FR-030).

export async function setStaffPin(formData: FormData): Promise<void> {
  // 1 + 2: session + role gate.
  const viewer = await requireStudioSession();
  assertCanEnterSettings(viewer);

  // 3a: parse the staff_id first so the failure-path redirect keeps the
  // panel open on the right row.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${STAFF_PATH}?error=not_found`);
  }

  // 4: load the target row. We need `pin_hash` to compute `previous_pin_set`
  // for the audit payload, plus `role` + `active` for the matrix check.
  const admin = createSupabaseServiceRoleClient();
  const { data: targetRow, error: loadErr } = await admin
    .from("staff")
    .select("id, display_name, role, color_token, active, removed_at, pin_hash")
    .eq("id", staffId)
    .single();

  if (loadErr || !targetRow || targetRow.removed_at !== null) {
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  const previousPinSet = targetRow!.pin_hash !== null;

  // Compute isLastOwner. setStaffPin doesn't reduce the owner count, but the
  // matrix's `set_pin` action ignores `isLastOwner` — we pass it anyway to
  // keep the call shape consistent with the other actions.
  let isLastOwner = false;
  if (targetRow!.role === "owner") {
    const { count, error: countErr } = await admin
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner")
      .eq("active", true)
      .is("removed_at", null)
      .neq("id", targetRow!.id);
    if (countErr) {
      console.error("setStaffPin isLastOwner count failed", countErr);
      redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
    }
    isLastOwner = (count ?? 0) === 0;
  }

  // 3b + 5: validate PIN shape, then run the matrix.
  let pinPlain: string;
  let pinHash: string;
  try {
    pinPlain = validatePinShape(String(formData.get("pin") ?? ""));

    assertMutationAllowed(
      {
        operator: viewer.staff,
        target: {
          id: targetRow!.id,
          role: targetRow!.role as StudioRole,
          active: targetRow!.active,
        },
        isLastOwner,
      },
      "set_pin"
    );

    // 6a: hash before UPDATE — the raw PIN never touches the DB.
    pinHash = await hashPin(pinPlain);
  } catch (err) {
    handleKnownError(err, staffId);
  }

  // 6b: UPDATE pin_hash.
  const { error: updateErr } = await admin
    .from("staff")
    .update({ pin_hash: pinHash! })
    .eq("id", targetRow!.id);

  if (updateErr) {
    console.error("setStaffPin UPDATE failed", updateErr);
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  // 7: audit row — payload contains ONLY `previous_pin_set`. The raw PIN
  // and hash are NEVER recorded (Constitution III + spec FR-030).
  await recordAudit("staff.pin_set", viewer.deviceUserId, targetRow!.id, {
    previous_pin_set: previousPinSet,
  });

  // 8: revalidate + redirect.
  revalidatePath(STAFF_PATH);
  redirect(`${STAFF_PATH}?selected=${encodeURIComponent(targetRow!.id)}&toast=pin_updated`);
}

// ── deactivateStaff / reactivateStaff / removeStaff ─────────────────────
//
// Contracts: server-actions.contract.md §§ 4–6. Three small mutations that
// share the lifecycle pattern: load target → compute isLastOwner →
// assertMutationAllowed (`deactivate`/`reactivate`/`remove`) → UPDATE →
// audit → redirect. The shared helper below extracts the load + isLastOwner
// step because all three actions need it.
//
// Pre-checks per contract:
//   - deactivateStaff: target.active must be true (else no-op via no_changes
//     soft error).
//   - reactivateStaff: target.active must be false (same soft error if
//     already active). The reactivate UI is a single click — no confirm
//     dialog (the confirm dialogs only fire for destructive variants).
//   - removeStaff: target.removed_at must be null (already removed → not_found).
//
// Last-owner trigger: the DB trigger backs up the matrix at the row level
// (data-model.md § 4). If the matrix somehow lets a last-owner mutation
// through, the trigger raises `check_violation` (errcode 23514) or
// `raise_exception` (P0001); we map both to `?error=last_owner`.

type StaffLifecycleRow = {
  id: string;
  display_name: string;
  role: StudioRole;
  color_token: string;
  active: boolean;
  removed_at: string | null;
};

/** Load the target row + compute isLastOwner, redirecting on lookup errors. */
async function loadLifecycleTarget(
  staffId: string
): Promise<{ target: StaffLifecycleRow; isLastOwner: boolean } | never> {
  const admin = createSupabaseServiceRoleClient();
  const { data: targetRow, error: loadErr } = await admin
    .from("staff")
    .select("id, display_name, role, color_token, active, removed_at")
    .eq("id", staffId)
    .single();

  if (loadErr || !targetRow) {
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  let isLastOwner = false;
  if (targetRow!.role === "owner") {
    const { count, error: countErr } = await admin
      .from("staff")
      .select("id", { count: "exact", head: true })
      .eq("role", "owner")
      .eq("active", true)
      .is("removed_at", null)
      .neq("id", targetRow!.id);
    if (countErr) {
      console.error("loadLifecycleTarget isLastOwner count failed", countErr);
      redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
    }
    isLastOwner = (count ?? 0) === 0;
  }

  const target: StaffLifecycleRow = {
    id: targetRow!.id,
    display_name: targetRow!.display_name,
    role: targetRow!.role as StudioRole,
    color_token: targetRow!.color_token,
    active: targetRow!.active,
    removed_at: targetRow!.removed_at,
  };
  return { target, isLastOwner };
}

/** Map the trigger's raise codes to `?error=last_owner`. */
function isLastOwnerTriggerError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "23514" || code === "P0001";
}

// ── 4. deactivateStaff ──────────────────────────────────────────────────

export async function deactivateStaff(formData: FormData): Promise<void> {
  // 1 + 2: session + role gate.
  const viewer = await requireStudioSession();
  assertCanEnterSettings(viewer);

  // 3: parse staff_id.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${STAFF_PATH}?error=not_found`);
  }

  // 4: load target + isLastOwner.
  const { target, isLastOwner } = await loadLifecycleTarget(staffId);

  // Pre-check: already inactive → soft no-op. Prevents writing a redundant
  // audit row when a stale tab re-submits.
  if (!target.active || target.removed_at !== null) {
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=no_changes`);
  }

  // 5: matrix.
  try {
    assertMutationAllowed(
      {
        operator: viewer.staff,
        target: { id: target.id, role: target.role, active: target.active },
        isLastOwner,
      },
      "deactivate"
    );
  } catch (err) {
    handleKnownError(err, staffId);
  }

  // 6: UPDATE active=false.
  const admin = createSupabaseServiceRoleClient();
  const { error: updateErr } = await admin
    .from("staff")
    .update({ active: false })
    .eq("id", target.id);

  if (updateErr) {
    if (isLastOwnerTriggerError(updateErr)) {
      redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=last_owner`);
    }
    console.error("deactivateStaff UPDATE failed", updateErr);
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  // 7: audit row — empty payload per audit.contract.md § staff.deactivated.
  await recordAudit("staff.deactivated", viewer.deviceUserId, target.id, {});

  // 8: revalidate + redirect.
  revalidatePath(STAFF_PATH);
  redirect(
    `${STAFF_PATH}?selected=${encodeURIComponent(target.id)}&toast=staff_deactivated&name=${encodeURIComponent(target.display_name)}`
  );
}

// ── 5. reactivateStaff ──────────────────────────────────────────────────

export async function reactivateStaff(formData: FormData): Promise<void> {
  // 1 + 2: session + role gate.
  const viewer = await requireStudioSession();
  assertCanEnterSettings(viewer);

  // 3: parse staff_id.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${STAFF_PATH}?error=not_found`);
  }

  // 4: load target + isLastOwner.
  const { target, isLastOwner } = await loadLifecycleTarget(staffId);

  // Pre-check: must be removed_at null AND currently inactive.
  if (target.removed_at !== null) {
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }
  if (target.active) {
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=no_changes`);
  }

  // 5: matrix.
  try {
    assertMutationAllowed(
      {
        operator: viewer.staff,
        target: { id: target.id, role: target.role, active: target.active },
        isLastOwner,
      },
      "reactivate"
    );
  } catch (err) {
    handleKnownError(err, staffId);
  }

  // 6: UPDATE active=true.
  const admin = createSupabaseServiceRoleClient();
  const { error: updateErr } = await admin
    .from("staff")
    .update({ active: true })
    .eq("id", target.id);

  if (updateErr) {
    console.error("reactivateStaff UPDATE failed", updateErr);
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  // 7: audit row — empty payload per audit.contract.md § staff.reactivated.
  await recordAudit("staff.reactivated", viewer.deviceUserId, target.id, {});

  // 8: revalidate + redirect. Per contract § 5 the reactivate success toast
  // is `changes_saved` (not a dedicated reactivated variant).
  revalidatePath(STAFF_PATH);
  redirect(`${STAFF_PATH}?selected=${encodeURIComponent(target.id)}&toast=changes_saved`);
}

// ── 6. removeStaff ──────────────────────────────────────────────────────

export async function removeStaff(formData: FormData): Promise<void> {
  // 1 + 2: session + role gate.
  const viewer = await requireStudioSession();
  assertCanEnterSettings(viewer);

  // 3: parse staff_id.
  const staffId = String(formData.get("staff_id") ?? "");
  if (!staffId) {
    redirect(`${STAFF_PATH}?error=not_found`);
  }

  // 4: load target + isLastOwner.
  const { target, isLastOwner } = await loadLifecycleTarget(staffId);

  // Pre-check: must not already be soft-removed.
  if (target.removed_at !== null) {
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  // 5: matrix.
  try {
    assertMutationAllowed(
      {
        operator: viewer.staff,
        target: { id: target.id, role: target.role, active: target.active },
        isLastOwner,
      },
      "remove"
    );
  } catch (err) {
    handleKnownError(err, staffId);
  }

  // 6: UPDATE removed_at=now() AND active=false in a single statement so the
  // /select-staff query (which filters on active=true) stays internally
  // consistent with the new removed_at filter.
  const admin = createSupabaseServiceRoleClient();
  const { error: updateErr } = await admin
    .from("staff")
    .update({
      removed_at: new Date().toISOString(),
      active: false,
    })
    .eq("id", target.id);

  if (updateErr) {
    if (isLastOwnerTriggerError(updateErr)) {
      redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=last_owner`);
    }
    console.error("removeStaff UPDATE failed", updateErr);
    redirect(`${STAFF_PATH}?selected=${encodeURIComponent(staffId)}&error=not_found`);
  }

  // 7: audit row — snapshot the display_name + role at removal time so the
  // audit log stays human-readable after the row is soft-deleted.
  await recordAudit("staff.removed", viewer.deviceUserId, target.id, {
    display_name_at_removal: target.display_name,
    role_at_removal: target.role,
  });

  // 8: revalidate + redirect. NO ?selected= — the row is gone and the panel
  // returns to its empty state.
  revalidatePath(STAFF_PATH);
  redirect(`${STAFF_PATH}?toast=staff_removed&name=${encodeURIComponent(target.display_name)}`);
}
