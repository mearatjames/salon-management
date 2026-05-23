// Canonical "who is acting" resolver. Every studio Server Action and Server
// Component calls one of these two functions to know which device user and
// which staff operator are accountable for the current request.
//
// Contract: specs/003-login-flow/contracts/session-helper.contract.md

import { cookies, headers } from "next/headers";

import {
  OperatorCookieExpiredError,
  OperatorCookieInvalidError,
  verifyOperatorCookie,
} from "@/lib/auth/cookie";
import { createSupabaseServerClient } from "@/lib/db/server";

export type StudioRole = "owner" | "manager" | "technician" | "front_desk";

export type StudioViewer = {
  deviceUserId: string;
  staff: {
    id: string;
    display_name: string;
    role: StudioRole;
    color_token: string;
  };
};

export type DegradedSession = {
  degraded: true;
  cookieStaffId: string | null;
};

export class AuthRedirectError extends Error {
  readonly target: "/login" | "/select-staff";
  readonly next: string | null;
  constructor(target: AuthRedirectError["target"], next: string | null) {
    super(`auth-redirect:${target}`);
    this.name = "AuthRedirectError";
    this.target = target;
    this.next = next;
  }
}

async function readCurrentPath(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-pathname") ?? null;
  } catch {
    return null;
  }
}

async function readCookieValue(): Promise<string | null> {
  try {
    const c = await cookies();
    return c.get("acting_as_staff_id")?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort decode of the cookie's `sid` claim without verifying the
 * signature. Used by the degraded sentinel so the studio shell can render
 * a placeholder operator chip even when Supabase is unreachable, and by
 * `signOut` (#133) so the action can audit the outgoing operator even when
 * a full studio session can't be resolved (e.g., the user is on
 * `/select-staff` and hasn't pinned in yet). A tampered or absent cookie
 * returns null.
 */
export function parseSidUnsafe(cookieValue: string | null): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
    const payload = JSON.parse(payloadJson) as { sid?: unknown };
    if (typeof payload.sid === "string" && payload.sid.length > 0) {
      return payload.sid;
    }
    return null;
  } catch {
    return null;
  }
}

export async function requireStudioSession(): Promise<StudioViewer> {
  const currentPath = await readCurrentPath();

  // Treat missing Supabase env vars as "no device session" — redirect to
  // /login. Production deploys always have these set; this branch covers
  // local dev where the developer hasn't yet wired Supabase, and prevents a
  // 500 cascade from blocking the studio shell entirely.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new AuthRedirectError("/login", currentPath);
  }

  const supabase = await createSupabaseServerClient();

  // 1. Device user.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  if (!user) {
    throw new AuthRedirectError("/login", currentPath);
  }

  // 2. Operator cookie present?
  const cookieValue = await readCookieValue();
  if (!cookieValue) {
    throw new AuthRedirectError("/select-staff", currentPath);
  }

  // 3. Cookie verifies?
  let sid: string;
  try {
    const payload = await verifyOperatorCookie(cookieValue);
    sid = payload.sid;
  } catch (err) {
    if (err instanceof OperatorCookieInvalidError || err instanceof OperatorCookieExpiredError) {
      throw new AuthRedirectError("/select-staff", currentPath);
    }
    throw err;
  }

  // 4. Staff row resolves AND is active?
  const { data: staffRow, error: staffErr } = await supabase
    .from("staff")
    .select("id, display_name, role, color_token")
    .eq("id", sid)
    .eq("active", true)
    .single();

  if (staffErr || !staffRow) {
    // Note: PostgREST returns an error for "no rows" on `.single()`. Treat
    // either path as "operator not found" and bounce to /select-staff.
    throw new AuthRedirectError("/select-staff", currentPath);
  }

  return {
    deviceUserId: user.id,
    staff: {
      id: staffRow.id,
      display_name: staffRow.display_name,
      role: staffRow.role as StudioRole,
      color_token: staffRow.color_token,
    },
  };
}

export async function getStudioSessionOrDegraded(): Promise<StudioViewer | DegradedSession> {
  try {
    return await requireStudioSession();
  } catch (err) {
    if (err instanceof AuthRedirectError) {
      // The redirect path is a real auth failure (no session, no cookie,
      // deactivated staff). Re-throw so the caller (layout / error boundary)
      // can do the navigation.
      throw err;
    }
    // Anything else is treated as a degraded condition (Supabase fetch
    // failure, network blip, 5xx, missing env vars). Return a sentinel with
    // the best-effort cookieStaffId so the chrome can render a placeholder
    // chip without 500ing on the wider page.
    let cookieValue: string | null = null;
    try {
      cookieValue = await readCookieValue();
    } catch {
      // ignore — degraded already.
    }
    return { degraded: true, cookieStaffId: parseSidUnsafe(cookieValue) };
  }
}
