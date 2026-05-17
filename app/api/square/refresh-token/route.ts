// app/api/square/refresh-token/route.ts
//
// Daily Vercel Cron entry — refreshes the salon's Square OAuth access
// token before it expires.
//
// Auth: `Authorization: Bearer ${CRON_SECRET}` — Vercel Cron convention.
//   Missing/wrong → 401.
//
// Always returns 200 on completion (success OR persistent failure) so
// Vercel Cron does not retry. The durable signal lives on the row:
//   - `last_refreshed_at` / cleared `refresh_failed_at` → success.
//   - `refresh_failed_at` (non-null) → persistent failure; the UI shows
//     the ReconnectBanner.
//
// Contract: specs/015-square-terminal-payment/contracts/api-routes.contract.md
// § 2.

import { NextResponse, type NextRequest } from "next/server";

import { refreshIfNeeded } from "@/lib/square/oauth";

function isAuthorizedCron(request: NextRequest): boolean {
  const header = request.headers.get("authorization");
  return header === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const result = await refreshIfNeeded();
    if ("skipped" in result) {
      return NextResponse.json({ ok: true, skipped: result.skipped });
    }
    if ("refreshed" in result) {
      return NextResponse.json({ ok: true, refreshed: true });
    }
    // result.ok === false
    return NextResponse.json({ ok: false, error: result.error });
  } catch (err) {
    // Defensive: refreshIfNeeded normally returns errors via the union.
    // If something escapes (eg. a programming error), still return 200 so
    // cron does not flap, but log the surprise.
    console.error("refresh-token route: unhandled error", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg });
  }
}
