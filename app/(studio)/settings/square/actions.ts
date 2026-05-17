"use server";

// Server Actions for Settings → Square.
//
// Each action follows the shared prelude documented in
// `specs/015-square-terminal-payment/contracts/server-actions.md`:
//   1. requireStudioSession() → auth resolver (throws AuthRedirectError).
//   2. parse + validate args (per-action; zod).
//   3. mutate via the service-role client (bypasses RLS — writes have no
//      `authenticated` policy on square_oauth / square_devices).
//   4. recordAudit() with controlled-vocab verbs from lib/auth/audit.ts.
//   5. revalidatePath() so the Server Component page picks up the change.
//   6. Return typed result — no `redirect()` from inside actions (the
//      client island handles navigation).
//
// Error contract: every error is a typed class from `_errors.ts`. The
// client island catches the throw, reads `.code`, and surfaces a toast.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { requireStudioSession } from "@/lib/auth/session";
import { revokeAndDelete, startOAuth } from "@/lib/square/oauth";

import { DeviceNotFoundError, InvalidDeviceNameError, SquareNotConnectedError } from "./_errors";

const SQUARE_PATH = "/settings/square";

// Resolve the request origin so the OAuth redirect_uri matches what Square
// rounds back to us. `headers()` is request-scoped — available inside a
// Server Action.
async function resolveOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (!host) throw new Error("connectSquareStart: no host header");
  return `${proto}://${host}`;
}

// ─── connectSquareStart ─────────────────────────────────────────────────

export async function connectSquareStart(): Promise<{ authorizationUrl: string }> {
  await requireStudioSession();
  const origin = await resolveOrigin();
  const authorizationUrl = await startOAuth(origin);
  return { authorizationUrl };
}

// ─── disconnectSquare ───────────────────────────────────────────────────

export async function disconnectSquare(): Promise<{ ok: true }> {
  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Defensive: refuse if no connection exists.
  const { data: existing } = await supabase
    .from("square_oauth")
    .select("merchant_id")
    .eq("id", true)
    .maybeSingle();

  if (!existing) throw new SquareNotConnectedError();

  await revokeAndDelete();

  await recordAudit(
    "integration.square_disconnected",
    viewer.deviceUserId,
    null,
    { merchant_id: existing.merchant_id },
    viewer.staff.id
  );

  revalidatePath(SQUARE_PATH);
  return { ok: true };
}

// ─── renameDevice ───────────────────────────────────────────────────────

const renameDeviceSchema = z.object({
  deviceId: z.string().min(1, "deviceId required"),
  newName: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 1 && s.length <= 60, {
      message: "name must be 1..60 chars",
    }),
});

export async function renameDevice(deviceId: string, newName: string): Promise<{ ok: true }> {
  const viewer = await requireStudioSession();

  const parsed = renameDeviceSchema.safeParse({ deviceId, newName });
  if (!parsed.success) throw new InvalidDeviceNameError();

  const supabase = createSupabaseServiceRoleClient();
  const { data: row, error: readErr } = await supabase
    .from("square_devices")
    .select("id, friendly_name, square_device_id")
    .eq("square_device_id", parsed.data.deviceId)
    .maybeSingle();

  if (readErr) throw new Error(`square_devices read failed: ${readErr.message}`);
  if (!row) throw new DeviceNotFoundError();

  const oldName = row.friendly_name;
  const { error: updErr } = await supabase
    .from("square_devices")
    .update({ friendly_name: parsed.data.newName, updated_at: new Date().toISOString() })
    .eq("square_device_id", parsed.data.deviceId);

  if (updErr) throw new Error(`square_devices update failed: ${updErr.message}`);

  await recordAudit(
    "integration.square_device_renamed",
    viewer.deviceUserId,
    row.id,
    {
      square_device_id: row.square_device_id,
      old_name: oldName,
      new_name: parsed.data.newName,
    },
    viewer.staff.id
  );

  revalidatePath(SQUARE_PATH);
  return { ok: true };
}

// ─── setDefaultDevice ───────────────────────────────────────────────────

export async function setDefaultDevice(deviceId: string | null): Promise<{ ok: true }> {
  const viewer = await requireStudioSession();
  const supabase = createSupabaseServiceRoleClient();

  // Look up the previous default so the audit payload can record both.
  const { data: prevDefault } = await supabase
    .from("square_devices")
    .select("id, square_device_id")
    .eq("is_default", true)
    .maybeSingle();

  // Look up the target if non-null.
  let target: { id: string; square_device_id: string } | null = null;
  if (deviceId !== null) {
    const { data: row, error: readErr } = await supabase
      .from("square_devices")
      .select("id, square_device_id")
      .eq("square_device_id", deviceId)
      .maybeSingle();
    if (readErr) throw new Error(`square_devices read failed: ${readErr.message}`);
    if (!row) throw new DeviceNotFoundError();
    target = row;
  }

  // Step 1: clear existing default(s). The partial unique index guarantees
  // at most one row is_default=true, but the UPDATE WHERE is broad so this
  // is safe regardless.
  const { error: clearErr } = await supabase
    .from("square_devices")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("is_default", true);
  if (clearErr) throw new Error(`clear default failed: ${clearErr.message}`);

  // Step 2: set the new default (if any).
  if (target) {
    const { error: setErr } = await supabase
      .from("square_devices")
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq("square_device_id", target.square_device_id);
    if (setErr) throw new Error(`set default failed: ${setErr.message}`);
  }

  await recordAudit(
    "integration.square_device_default_set",
    viewer.deviceUserId,
    target?.id ?? null,
    {
      previous_default_square_device_id: prevDefault?.square_device_id ?? null,
      new_default_square_device_id: target?.square_device_id ?? null,
    },
    viewer.staff.id
  );

  revalidatePath(SQUARE_PATH);
  return { ok: true };
}
