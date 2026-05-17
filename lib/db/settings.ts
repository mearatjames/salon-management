// lib/db/settings.ts
// -----------------------------------------------------------------------------
// Tiny read helper for the public.settings key/value table. Server-only.
//
// The dashboard reads `salon.timezone` from this table on every request to
// compute its local-time period boundaries; if the row is missing the helper
// falls back to America/Los_Angeles per FR-008.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

export class InvalidSettingError extends Error {
  readonly key: string;
  readonly value: unknown;

  constructor(key: string, value: unknown) {
    super(
      `Setting "${key}" has an unexpected jsonb shape (got ${typeof value}: ${JSON.stringify(value)})`
    );
    this.name = "InvalidSettingError";
    this.key = key;
    this.value = value;
  }
}

/**
 * Reads a single `public.settings` row by key.
 *
 * Returns:
 *  - the unwrapped jsonb `value` cast to `T` when the row exists,
 *  - `null` when the row is missing,
 *  - throws `InvalidSettingError` when the caller specified a typed `T`
 *    (e.g. `<string>`) but the stored jsonb is the wrong shape.
 *
 * Type-mismatch detection is best-effort: when `T = unknown` we cannot tell
 * if anything is wrong, so we just hand the value back. When `T = string`
 * we explicitly verify `typeof value === "string"`. This keeps the dashboard
 * defensive against future bad data without trying to encode runtime type
 * info for arbitrary generics.
 */
export async function getSetting<T = unknown>(
  supabase: SupabaseClient<Database>,
  key: string,
  check?: (v: unknown) => v is T
): Promise<T | null> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }
  // `data.value` is jsonb — typed as `Json` upstream but we accept unknown.
  const value = (data as { value: unknown }).value;
  if (check && !check(value)) {
    throw new InvalidSettingError(key, value);
  }
  return value as T;
}

/**
 * Reads the salon's local IANA timezone identifier from `salon.timezone`.
 * Falls back to `America/Los_Angeles` when the row is missing.
 * Throws `InvalidSettingError` if the row exists but is not a string.
 */
export async function getSalonTimezone(supabase: SupabaseClient<Database>): Promise<string> {
  const value = await getSetting<unknown>(supabase, "salon.timezone");
  if (value === null) {
    return "America/Los_Angeles";
  }
  if (typeof value !== "string") {
    throw new InvalidSettingError("salon.timezone", value);
  }
  return value;
}
