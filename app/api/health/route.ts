// Tiny health probe used by <ReconnectingBanner />. Returns 200 with
// `{ ok: true }` on a successful Supabase round-trip, 503 with `{ ok: false }`
// on any failure. Kept lightweight: a single HEAD-style SELECT.

import { createSupabaseServerClient } from "@/lib/db/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("staff")
      .select("id", { count: "exact", head: true });
    if (error) {
      return Response.json({ ok: false }, { status: 503 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
