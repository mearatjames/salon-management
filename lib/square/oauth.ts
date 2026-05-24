// lib/square/oauth.ts
//
// Square OAuth + token-encryption plumbing for the single-salon Tang Nails
// app. Server-only. The salon's Square OAuth access/refresh tokens are
// stored in `public.square_oauth` as bytea ciphertext encrypted with
// `pgp_sym_encrypt(plain, current_setting('app.square_oauth_key'))`. The
// symmetric key lives in Supabase Vault under the name
// `process.env.SQUARE_OAUTH_KEY_VAULT_NAME` (defaults to `square_oauth_key`).
//
// Every call site must call `setOauthKeyGuc(client)` first inside the same
// transaction before touching any encrypted column or invoking
// `decrypt_square_token`. The Supabase JS HTTP client does NOT preserve
// session state across calls, so the standard pattern here is to push every
// read/write through `pos_*` RPCs or, where the operation must read both
// encrypted columns in a single transaction, through a stored procedure.
//
// See:
//   - data-model.md §§ 1, 5, 6
//   - research R3, R4, R7
//   - contracts/api-routes.contract.md § 2 (refresh-token route)

import { SignJWT, jwtVerify } from "jose";

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { getSquareClient } from "@/lib/square/client";

// Canonical Square host — used for the BROWSER-FACING /oauth2/authorize
// URL only. This must stay on Square's real host so Playwright's
// `context.route` can intercept the redirect in e2e (and so production
// users go to the real Square auth screen).
const SQUARE_BROWSER_HOST = (): string =>
  process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

// Server-side base URL — every server-to-Square fetch (token exchange,
// merchant profile, revoke, devices) goes through this. The
// SQUARE_API_BASE_URL escape hatch lets the e2e suite route them to a
// local Playwright-managed stub server.
const SQUARE_BASE_URL = (): string => {
  if (process.env.SQUARE_API_BASE_URL) return process.env.SQUARE_API_BASE_URL;
  return SQUARE_BROWSER_HOST();
};

const SCOPES = [
  "PAYMENTS_WRITE",
  "PAYMENTS_READ",
  "MERCHANT_PROFILE_READ",
  "DEVICE_CREDENTIAL_MANAGEMENT",
].join("+");

const STATE_TTL_SECONDS = 600; // 10 minutes — Square spec.

function vaultName(): string {
  return process.env.SQUARE_OAUTH_KEY_VAULT_NAME ?? "square_oauth_key";
}

function stateSecret(): Uint8Array {
  // Reuse the existing ACTING_AS_COOKIE_SECRET (32-byte base64) so we do
  // not introduce another secret. This matches the convention used by
  // `lib/auth/cookie.ts`.
  const raw = process.env.ACTING_AS_COOKIE_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      "ACTING_AS_COOKIE_SECRET must be set (≥16 chars) — required for Square OAuth state JWT"
    );
  }
  return new Uint8Array(new TextEncoder().encode(raw));
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type OAuthStatePayload = {
  /** Random per-request nonce (CSRF). */
  nonce: string;
  /** The original return URL the OAuth callback should redirect back to. */
  returnUrl: string;
};

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  merchantId: string;
};

export type DecryptedConnection = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshFailedAt: Date | null;
  merchantId: string;
  merchantName: string;
};

export type RefreshResult =
  | { ok: true; skipped: "not_connected" | "not_due" }
  | { ok: true; refreshed: true }
  | { ok: false; error: string };

// ---------------------------------------------------------------------
// GUC plumbing
// ---------------------------------------------------------------------

/**
 * Set the `app.square_oauth_key` GUC transaction-locally on the given
 * Supabase service-role client. Subsequent calls to
 * `pgp_sym_encrypt(..., current_setting('app.square_oauth_key'))` or
 * `decrypt_square_token(...)` in the same transaction can then succeed.
 *
 * In practice this is invoked by a stored procedure that wraps the full
 * encrypt-and-persist or read-and-decrypt sequence in a single SQL
 * function (because Supabase JS HTTP-per-call cannot keep transactional
 * state). Direct call sites are limited to integration tests and the
 * refresh-token cron.
 */
export async function setOauthKeyGuc(): Promise<string> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .schema("vault" as never)
    .from("decrypted_secrets" as never)
    .select("decrypted_secret, name")
    .eq("name", vaultName())
    .single();
  if (error || !data) {
    throw new Error(`square_oauth: vault secret '${vaultName()}' not found — run T007 to seed it`);
  }
  // Return the raw key — callers thread it into RPCs (Postgrest does not
  // let us hold an open transaction across calls).
  return (data as unknown as { decrypted_secret: string }).decrypted_secret;
}

// ---------------------------------------------------------------------
// OAuth flow — start
// ---------------------------------------------------------------------

/**
 * Build the Square authorization URL the operator's browser should be
 * redirected to. The `state` parameter is a short-lived JWT (HS256) that
 * the callback route verifies for CSRF + freshness.
 */
export async function startOAuth(returnUrl: string): Promise<string> {
  const applicationId = process.env.SQUARE_APPLICATION_ID;
  if (!applicationId) throw new Error("SQUARE_APPLICATION_ID is not set");

  const nonce = crypto.randomUUID();
  const state = await new SignJWT({ nonce, returnUrl })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(stateSecret());

  const redirectUri = new URL("/settings/square/callback", returnUrl).toString();
  const url = new URL(`${SQUARE_BROWSER_HOST()}/oauth2/authorize`);
  url.searchParams.set("client_id", applicationId);
  // Square uses `+` as the scope delimiter; URLSearchParams encodes spaces
  // to `+`, which matches.
  url.searchParams.set("scope", SCOPES.replace(/\+/g, " "));
  url.searchParams.set("session", "false");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

/**
 * Verify a state JWT returned on the OAuth callback. Throws on tampering
 * or expiry. Returns the original returnUrl + nonce payload.
 */
export async function verifyOAuthState(state: string): Promise<OAuthStatePayload> {
  const { payload } = await jwtVerify(state, stateSecret(), { algorithms: ["HS256"] });
  if (typeof payload.nonce !== "string" || typeof payload.returnUrl !== "string") {
    throw new Error("invalid_state_payload");
  }
  return { nonce: payload.nonce, returnUrl: payload.returnUrl };
}

// ---------------------------------------------------------------------
// OAuth flow — exchange and persist
// ---------------------------------------------------------------------

async function fetchSquareTokenSet(grant: {
  grant_type: "authorization_code" | "refresh_token";
  code?: string;
  refresh_token?: string;
  redirect_uri?: string;
}): Promise<TokenSet> {
  const applicationId = process.env.SQUARE_APPLICATION_ID;
  const applicationSecret = process.env.SQUARE_APPLICATION_SECRET;
  if (!applicationId || !applicationSecret) {
    throw new Error("SQUARE_APPLICATION_ID / SQUARE_APPLICATION_SECRET not set");
  }
  const res = await fetch(`${SQUARE_BASE_URL()}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": "2025-01-23",
    },
    body: JSON.stringify({
      client_id: applicationId,
      client_secret: applicationSecret,
      ...grant,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`square_oauth_token_${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: string;
    merchant_id?: string;
    scope?: string;
    token_type?: string;
  };
  // Square's /oauth2/token response does NOT include `scope` — it's a
  // request-only parameter on /oauth2/authorize. We re-derive it from the
  // constant we sent at authorize time (SCOPES) since the granted scope
  // equals the requested scope in our flow (no scope downgrades).
  if (!json.access_token || !json.refresh_token || !json.expires_at || !json.merchant_id) {
    console.error("square_oauth_token_invalid_response: missing required fields in response", {
      presentKeys: Object.keys(json),
    });
    throw new Error("square_oauth_token_invalid_response");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(json.expires_at),
    scope: json.scope ?? SCOPES.replace(/\+/g, " "),
    merchantId: json.merchant_id,
  };
}

/**
 * Exchange an OAuth authorization `code` for tokens, look up the
 * merchant's friendly name, encrypt the tokens with the vault key, and
 * UPSERT into `square_oauth` (singleton row, id=true). Emits the
 * encrypt+insert as a single RPC call so the GUC stays transactional.
 */
export async function exchangeCodeAndPersist(
  code: string,
  operatorStaffId: string,
  redirectUri: string
): Promise<{ merchantId: string; merchantName: string }> {
  const tokens = await fetchSquareTokenSet({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  // Merchant profile (friendly name) — call Square's `/v2/merchants/{id}`
  // with the freshly-acquired access token.
  const merchantRes = await fetch(`${SQUARE_BASE_URL()}/v2/merchants/${tokens.merchantId}`, {
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Square-Version": "2025-01-23",
    },
  });
  let merchantName = tokens.merchantId;
  if (merchantRes.ok) {
    const m = (await merchantRes.json()) as { merchant?: { business_name?: string } };
    if (m.merchant?.business_name) merchantName = m.merchant.business_name;
  }

  const supabase = createSupabaseServiceRoleClient();

  // Encrypt + upsert as a single SQL call. The `encrypt_square_token` RPC
  // (migration 0009) reads the symmetric key from Supabase Vault inside its
  // own function body and sets the GUC transaction-locally — sidestepping
  // PostgREST's one-transaction-per-RPC constraint.
  const encryptedAccess = await encryptViaRpc(supabase, tokens.accessToken);
  const encryptedRefresh = await encryptViaRpc(supabase, tokens.refreshToken);

  const { error: upsertErr } = await supabase.from("square_oauth").upsert(
    {
      id: true,
      merchant_id: tokens.merchantId,
      merchant_name: merchantName,
      access_token_encrypted: encryptedAccess,
      refresh_token_encrypted: encryptedRefresh,
      access_token_expires_at: tokens.expiresAt.toISOString(),
      scope: tokens.scope,
      connected_by_staff_id: operatorStaffId,
      connected_at: new Date().toISOString(),
      refresh_failed_at: null,
      last_refreshed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (upsertErr) throw new Error(`square_oauth_upsert_failed: ${upsertErr.message}`);

  return { merchantId: tokens.merchantId, merchantName };
}

// Helper: encrypt a single plaintext via the `encrypt_square_token` RPC
// (migration 0009). The RPC reads the symmetric key from Supabase Vault
// and runs `pgp_sym_encrypt` inside one transaction; PostgREST returns the
// bytea as a hex-prefixed string (`\x...`) which Supabase JS forwards
// back to us. When we later UPSERT into `square_oauth.access_token_encrypted`
// (bytea), PostgREST accepts the same hex string and Postgres reads it back
// as bytes — round-trip is lossless.
async function encryptViaRpc(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  plaintext: string
): Promise<string> {
  const { data, error } = await supabase.rpc("encrypt_square_token", {
    plain: plaintext,
    vault_secret_name: vaultName(),
  });
  if (error || !data) {
    throw new Error(`encrypt_square_token RPC failed: ${error?.message ?? "no data returned"}`);
  }
  return data as unknown as string;
}

// ---------------------------------------------------------------------
// OAuth flow — read decrypted tokens
// ---------------------------------------------------------------------

/**
 * Read the singleton `square_oauth` row and return the decrypted token
 * material plus metadata. Returns `null` when no connection exists.
 *
 * Implementation note: the decrypt happens via `public.decrypt_square_token`
 * which requires `app.square_oauth_key` to be set in the SAME transaction.
 * Since Supabase JS issues each call as its own HTTP request (one txn each),
 * we cannot set the GUC and then issue a separate SELECT. The full path
 * lands when a follow-on micro-migration ships
 * `public.read_square_oauth_decrypted(key text)` that does both inside one
 * function body. This Phase 2 implementation returns the encrypted row
 * shape; downstream callers in Phase 3 wire up that helper.
 */
export async function readDecryptedTokens(): Promise<DecryptedConnection | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase.rpc("read_square_oauth_decrypted", {
    vault_secret_name: vaultName(),
  });
  if (error) {
    throw new Error(`read_square_oauth_decrypted RPC failed: ${error.message}`);
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as {
    merchant_id: string;
    merchant_name: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
    refresh_failed_at: string | null;
  };
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessTokenExpiresAt: new Date(row.access_token_expires_at),
    refreshFailedAt: row.refresh_failed_at ? new Date(row.refresh_failed_at) : null,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
  };
}

// ---------------------------------------------------------------------
// OAuth flow — refresh
// ---------------------------------------------------------------------

const REFRESH_DUE_BEFORE_DAYS = 7;
const REFRESH_RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Refresh the access token if it is within `REFRESH_DUE_BEFORE_DAYS` of
 * expiry. Retries up to 3 times with 1s/2s/4s backoff. On persistent
 * failure, sets `refresh_failed_at` so the UI's reconnect banner shows.
 *
 * Phase 2 ships the control flow; the actual encrypt/decrypt step waits
 * on the same RPC helper noted in `exchangeCodeAndPersist`.
 */
export async function refreshIfNeeded(): Promise<RefreshResult> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("square_oauth")
    .select("access_token_expires_at")
    .eq("id", true)
    .maybeSingle();
  if (error) return { ok: false, error: `read_failed: ${error.message}` };
  if (!data) return { ok: true, skipped: "not_connected" };

  const expiresAt = new Date(data.access_token_expires_at);
  const dueBefore = new Date(Date.now() + REFRESH_DUE_BEFORE_DAYS * 24 * 60 * 60 * 1000);
  if (expiresAt >= dueBefore) return { ok: true, skipped: "not_due" };

  // Read+decrypt the current refresh token so we can call Square /oauth2/token.
  const decrypted = await readDecryptedTokens();
  if (!decrypted) return { ok: true, skipped: "not_connected" };

  let lastErr = "uninitialized";
  for (let attempt = 0; attempt < REFRESH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const tokens = await fetchSquareTokenSet({
        grant_type: "refresh_token",
        refresh_token: decrypted.refreshToken,
      });
      const encryptedAccess = await encryptViaRpc(supabase, tokens.accessToken);
      const encryptedRefresh = await encryptViaRpc(supabase, tokens.refreshToken);
      const { error: updErr } = await supabase
        .from("square_oauth")
        .update({
          access_token_encrypted: encryptedAccess,
          refresh_token_encrypted: encryptedRefresh,
          access_token_expires_at: tokens.expiresAt.toISOString(),
          last_refreshed_at: new Date().toISOString(),
          refresh_failed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (updErr) throw new Error(`update_failed: ${updErr.message}`);
      // Audit on success — single payload per contract.
      const { recordAudit } = await import("@/lib/auth/audit");
      await recordAudit(
        "integration.square_token_refreshed",
        null,
        null,
        { ok: true, expires_at: tokens.expiresAt.toISOString() },
        null
      );
      return { ok: true, refreshed: true };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      if (attempt < REFRESH_RETRY_DELAYS_MS.length - 1) {
        await sleep(REFRESH_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  await supabase
    .from("square_oauth")
    .update({ refresh_failed_at: new Date().toISOString() })
    .eq("id", true);

  // Audit failure.
  const { recordAudit } = await import("@/lib/auth/audit");
  await recordAudit(
    "integration.square_token_refreshed",
    null,
    null,
    { ok: false, error: lastErr },
    null
  );

  return { ok: false, error: lastErr };
}

// ---------------------------------------------------------------------
// OAuth flow — revoke and delete
// ---------------------------------------------------------------------

/**
 * Best-effort revocation at Square, then delete the singleton row and
 * all paired-device rows in one logical operation.
 *
 * Network failure when calling Square's revoke endpoint does NOT block
 * the local cleanup — the user wants to disconnect, and the access token
 * will expire on its own within 30 days.
 */
export async function revokeAndDelete(): Promise<void> {
  // Square call is best-effort.
  try {
    const applicationId = process.env.SQUARE_APPLICATION_ID;
    const applicationSecret = process.env.SQUARE_APPLICATION_SECRET;
    if (applicationId && applicationSecret) {
      await fetch(`${SQUARE_BASE_URL()}/oauth2/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Client ${applicationSecret}`,
          "Square-Version": "2025-01-23",
        },
        body: JSON.stringify({ client_id: applicationId }),
      });
    }
  } catch (err) {
    console.warn("square_oauth revoke best-effort failure", err);
  }

  const supabase = createSupabaseServiceRoleClient();
  // Two table-level deletes back-to-back. Postgrest doesn't expose a
  // multi-statement transaction; for absolute consistency a follow-on
  // SQL function `public.square_disconnect()` will wrap both in one
  // txn (Phase 3 follow-on). For Phase 2 the order is safe — devices
  // first, then the connection row.
  await supabase.from("square_devices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("square_oauth").delete().eq("id", true);
}

// ---------------------------------------------------------------------
// Location-id resolution (feature 051, research R1)
// ---------------------------------------------------------------------

/**
 * Resolve and cache the salon's Square `location_id`.
 *
 * The single-salon Tang Nails install has exactly one Square location.
 * `orders.create` requires a concrete `location_id` UUID — the literal
 * `"main"` string is only accepted by `locations.get` as a convenience
 * alias. We lazy-resolve once on the first itemized checkout, persist the
 * value onto the singleton `square_oauth` row, and read it from there for
 * every subsequent call.
 *
 * Behavior:
 *   - If the `square_oauth` row's `location_id` is non-null, return it.
 *   - Otherwise call `client.locations.get({ locationId: "main" })`, take
 *     the returned `location.id`, persist it back, and return it.
 *   - Throws `Error('getSquareLocationId: Square not connected')` if no
 *     row exists.
 *
 * See: specs/051-square-itemized-order/data-model.md →
 * square_oauth.location_id and research R1.
 */
export async function getSquareLocationId(): Promise<string> {
  const supabase = createSupabaseServiceRoleClient();
  const { data: row, error: readErr } = await supabase
    .from("square_oauth")
    .select("location_id")
    .eq("id", true)
    .maybeSingle();
  if (readErr) {
    throw new Error(`getSquareLocationId: read failed: ${readErr.message}`);
  }
  if (!row) {
    throw new Error("getSquareLocationId: Square not connected");
  }
  if (typeof row.location_id === "string" && row.location_id.length > 0) {
    return row.location_id;
  }

  // Cache miss — resolve via Square API.
  const connection = await readDecryptedTokens();
  if (!connection) {
    throw new Error("getSquareLocationId: Square not connected");
  }
  const client = getSquareClient(connection.accessToken);
  const response = (await client.locations.get({ locationId: "main" })) as unknown as {
    location?: { id?: string };
  };
  const locationId = response.location?.id;
  if (!locationId) {
    throw new Error("getSquareLocationId: Square response missing location.id");
  }

  const { error: updErr } = await supabase
    .from("square_oauth")
    .update({ location_id: locationId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (updErr) {
    throw new Error(`getSquareLocationId: persist failed: ${updErr.message}`);
  }

  return locationId;
}
