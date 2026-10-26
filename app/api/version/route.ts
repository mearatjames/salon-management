// Version probe used by <UpdatePrompt />. Returns the build ID of the
// deployment currently serving requests; the client compares it against the
// build ID baked into its own bundle to detect a newer deploy.

import { BUILD_ID } from "@/lib/build-id";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ buildId: BUILD_ID }, { headers: { "Cache-Control": "no-store" } });
}
