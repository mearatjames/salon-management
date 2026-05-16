// Edge proxy — runs on every request not explicitly excluded by the
// matcher below. Reads the Supabase session via @supabase/ssr and verifies
// the operator cookie's signature + Max-Age. Redirects on either failure,
// preserving the original path through `?next=`.
//
// Performance budget: < 5 ms p95. No Postgres connection — the `staff` row
// is resolved later by `requireStudioSession()` on the Node runtime.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  OperatorCookieExpiredError,
  OperatorCookieInvalidError,
  verifyOperatorCookie,
} from "@/lib/auth/cookie";

export async function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const nextHref = pathname + url.search;
  const nextEncoded = encodeURIComponent(nextHref);

  // The response object is mutated by Supabase's cookie helpers (refreshing
  // expired access tokens, etc.). We pre-build it so the helpers can attach
  // Set-Cookie headers; if we end up redirecting, we rebuild on top.
  const response = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  });

  // Always propagate the current pathname to the Node runtime via an
  // `x-pathname` header so `requireStudioSession()` can include it in the
  // redirect's `?next=` value.
  response.headers.set("x-pathname", pathname);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    // Missing config — there is no possible device session, so bounce to
    // /login. Production deploys always have these set; this branch covers
    // local dev where Supabase isn't wired yet, keeping the studio shell
    // navigable instead of rendering a 500.
    const redirectUrl = new URL(`/login?next=${nextEncoded}`, request.url);
    return NextResponse.redirect(redirectUrl, { status: 307 });
  }

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options as CookieOptions);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const redirectUrl = new URL(`/login?next=${nextEncoded}`, request.url);
    return NextResponse.redirect(redirectUrl, { status: 307 });
  }

  const operatorCookie = request.cookies.get("acting_as_staff_id")?.value;
  if (!operatorCookie) {
    const redirectUrl = new URL(`/select-staff?next=${nextEncoded}`, request.url);
    return NextResponse.redirect(redirectUrl, { status: 307 });
  }

  try {
    await verifyOperatorCookie(operatorCookie);
  } catch (err) {
    if (err instanceof OperatorCookieInvalidError || err instanceof OperatorCookieExpiredError) {
      const redirectUrl = new URL(`/select-staff?next=${nextEncoded}`, request.url);
      const redirect = NextResponse.redirect(redirectUrl, { status: 307 });
      // Clear the cookie so the next request doesn't loop.
      redirect.cookies.set("acting_as_staff_id", "", {
        maxAge: 0,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
      return redirect;
    }
    throw err;
  }

  return response;
}

export const config = {
  // Matcher excludes the public auth surfaces, the kiosk path, Square
  // webhook endpoint, Next.js internals, the favicon, and anything with a
  // file extension (static assets). Anything else hits the proxy.
  //
  // `reset-password` is added by 010-login-redesign US3 (FR-014..FR-018):
  // the recovery landing page must be reachable by a user whose PKCE
  // exchange just established a Supabase session but has NOT yet set the
  // operator cookie. Without this exemption the user is bounced to
  // /select-staff before they can submit the new password. The routes
  // contract (specs/010-login-redesign/contracts/routes.contract.md
  // § Cross-route invariants) anticipates this exemption.
  matcher: [
    "/((?!login|select-staff|reset-password|auth/.*|kiosk/.*|api/webhooks/.*|_next/.*|favicon.ico|.*\\..*).*)",
  ],
};
