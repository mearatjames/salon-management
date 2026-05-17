// app/(studio)/settings/square/callback/route.ts
//
// GET handler — receives the OAuth redirect from Square's authorize page.
//
// Contract: `specs/015-square-terminal-payment/contracts/server-actions.md
// § "OAuth callback route handler"`.
//
// 1. requireStudioSession()  — owner/manager (no role gate; settings layout
//                              already restricted upstream).
// 2. Validate state JWT      — CSRF nonce + freshness ≤ 10 min.
// 3. Exchange code           — via `lib/square/oauth.ts:exchangeCodeAndPersist`.
// 4. Initial device sync     — via `lib/square/terminal.ts:listDevices()`.
// 5. Audit                   — `integration.square_connected`.
// 6. Redirect                — `/settings/square?connected=1`.
//
// On every known error path, redirect with `?error=<code>` instead of
// returning 5xx (the OAuth flow is user-visible — a 500 page would lose
// the user; a flash toast on the settings page is the recovery affordance).

import { NextResponse, type NextRequest } from "next/server";

import { recordAudit } from "@/lib/auth/audit";
import { requireStudioSession } from "@/lib/auth/session";
import { exchangeCodeAndPersist, verifyOAuthState } from "@/lib/square/oauth";
import { listDevices } from "@/lib/square/terminal";

const SQUARE_PATH = "/settings/square";

function redirectWithFlash(origin: string, params: Record<string, string>): NextResponse {
  const url = new URL(SQUARE_PATH, origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<Response> {
  const viewer = await requireStudioSession();

  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!state) {
    return redirectWithFlash(origin, { error: "invalid_state" });
  }

  try {
    await verifyOAuthState(state);
  } catch {
    return redirectWithFlash(origin, { error: "invalid_state" });
  }

  if (!code) {
    return redirectWithFlash(origin, { error: "oauth_exchange_failed" });
  }

  let merchantInfo: { merchantId: string; merchantName: string };
  try {
    merchantInfo = await exchangeCodeAndPersist(code, viewer.staff.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("vault_secret_not_found")) {
      console.error("square_oauth callback: vault misconfigured", err);
      return redirectWithFlash(origin, { error: "vault_misconfigured" });
    }
    console.error("square_oauth callback: exchange failed", err);
    return redirectWithFlash(origin, { error: "oauth_exchange_failed" });
  }

  // Best-effort initial device sync. A failure here does not undo the
  // connection — the next page load will retry the listDevices() call.
  try {
    await listDevices();
  } catch (err) {
    console.warn("square_oauth callback: initial device sync failed", err);
  }

  await recordAudit(
    "integration.square_connected",
    viewer.deviceUserId,
    null,
    {
      merchant_id: merchantInfo.merchantId,
      merchant_name: merchantInfo.merchantName,
      scope: "PAYMENTS_WRITE PAYMENTS_READ MERCHANT_PROFILE_READ DEVICE_CREDENTIAL_MANAGEMENT",
    },
    viewer.staff.id
  );

  return redirectWithFlash(origin, { connected: "1" });
}
