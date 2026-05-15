// Cookie-aware Supabase client for Server Components and Server Actions.
//
// This is the canonical client for any code under app/ that needs to read
// the device user (Supabase auth.uid) or query a table that participates in
// RLS. The middleware uses its own NextRequest/NextResponse-flavored
// equivalent — see `middleware.ts`.

import { cookies } from "next/headers";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars — required by lib/db/server.ts"
    );
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        } catch {
          // `cookies().set` throws when called from a Server Component (not
          // a Server Action / Route Handler). Supabase's middleware also
          // refreshes cookies, so swallowing here is safe — the next mutating
          // request will re-issue them.
        }
      },
    },
  });
}
