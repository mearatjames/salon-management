// `/login` — public sign-in page (FR-005 short-circuit applies).
//
// Pre-redirect logic (preserved verbatim from 003-login-flow — guards
// FR-005 of 003 and US5 of 010-login-redesign):
//   (a) Supabase user present AND operator cookie verifies →
//       redirect(sanitizeNext(next)). User is fully authed; skip /select-staff.
//   (b) Supabase user present but cookie missing/expired/tampered →
//       redirect('/select-staff?next=...').
//   (c) Otherwise resolve the active view from the URL and render.
//
// View selection (per routes.contract.md § View selection precedence):
//   ?reset_sent=<email>   → <ForgotSentView />
//   ?reset_intent=1       → <ForgotView />
//   ?magic_sent=<email>   → <MagicSentView />
//   ?magic_intent=1       → <MagicView />
//   otherwise             → <SignInView />
//
// In Phase 2 only the <SignInView> branch is functionally complete; the
// other four are stubs that render an empty pane (US3 / US4 land their
// real contents in Phases 5 + 6). The page wires the active view's
// props (`next`, `error`, `email`) through unchanged.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  OperatorCookieExpiredError,
  OperatorCookieInvalidError,
  verifyOperatorCookie,
} from "@/lib/auth/cookie";
import { sanitizeNext } from "@/lib/auth/next-url";
import {
  AuthClientRouter,
  ForgotSentView,
  ForgotView,
  MagicSentView,
  MagicView,
  SignInView,
} from "@/components/lacquer/auth-views";
import { createSupabaseServerClient } from "@/lib/db/server";

type LoginSearchParams = {
  next?: string | string[];
  error?: string | string[];
  reset_intent?: string | string[];
  reset_sent?: string | string[];
  magic_intent?: string | string[];
  magic_sent?: string | string[];
};

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function nextSuffix(next: string | undefined): string {
  return next ? encodeURIComponent(next) : "";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const params = await searchParams;
  const next = pickString(params.next);
  const error = pickString(params.error);
  const resetIntent = pickString(params.reset_intent);
  const resetSent = pickString(params.reset_sent);
  const magicIntent = pickString(params.magic_intent);
  const magicSent = pickString(params.magic_sent);

  // Pre-redirect (FR-005). Preserved verbatim from 003-login-flow —
  // see top-of-file note. Do NOT collapse / refactor this block; the
  // sequencing of the operator-cookie probe is load-bearing for US5.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        // Supabase user present — check operator cookie.
        const cookieStore = await cookies();
        const cookieValue = cookieStore.get("acting_as_staff_id")?.value;
        if (cookieValue) {
          try {
            await verifyOperatorCookie(cookieValue);
            // Both layers cleanly resolved — skip /select-staff.
            redirect(sanitizeNext(next));
          } catch (err) {
            if (
              err instanceof OperatorCookieInvalidError ||
              err instanceof OperatorCookieExpiredError
            ) {
              // Fall through to (b).
            } else {
              throw err;
            }
          }
        }
        // (b): Supabase user but no/invalid operator cookie.
        redirect(`/select-staff?next=${nextSuffix(next)}`);
      }
    } catch (err) {
      // `redirect()` throws a NEXT_REDIRECT — re-raise so Next handles it.
      if (
        typeof err === "object" &&
        err !== null &&
        typeof (err as { digest?: unknown }).digest === "string" &&
        ((err as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
          (err as { digest: string }).digest.startsWith("NEXT_NOT_FOUND"))
      ) {
        throw err;
      }
      // Supabase unreachable — render the form. The user can still see the
      // login surface; failure will surface via signInWithPassword's network
      // branch.
    }
  }

  // View selection — precedence per routes.contract.md. The server
  // picks the initial view from URL params; the <AuthClientRouter>
  // wrapper takes over on hydration to swap views in-place when the
  // user clicks an internal `/login?...` link or hits back/forward —
  // see T062 + research.md R1.
  let initialView;
  if (resetSent !== undefined) {
    initialView = <ForgotSentView email={resetSent} next={next} />;
  } else if (resetIntent !== undefined) {
    initialView = <ForgotView next={next} error={error} />;
  } else if (magicSent !== undefined) {
    initialView = <MagicSentView email={magicSent} next={next} />;
  } else if (magicIntent !== undefined) {
    initialView = <MagicView next={next} error={error} />;
  } else {
    initialView = <SignInView next={next} error={error} />;
  }
  return <AuthClientRouter>{initialView}</AuthClientRouter>;
}
