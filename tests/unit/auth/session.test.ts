// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthRedirectError,
  getStudioSessionOrDegraded,
  requireStudioSession,
  type StudioViewer,
} from "@/lib/auth/session";

import { TEST_ACTING_AS_COOKIE_SECRET, mintCookie, mintExpiredCookie } from "./_fixtures";

// ---------------------------------------------------------------------------
// Module-level mocks. Each test rewires the underlying mocks via the helpers
// below to drive the seven cases the session helper has to cover.
// ---------------------------------------------------------------------------

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { cookies, headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/db/server";

type CookieStore = { get: (name: string) => { name: string; value: string } | undefined };

function setCookies(store: Record<string, string>) {
  const cookieStore: CookieStore = {
    get(name: string) {
      const value = store[name];
      return value === undefined ? undefined : { name, value };
    },
  };
  (cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(cookieStore);
}

function setHeaders(pathname: string | null) {
  const headersStore = {
    get(name: string) {
      if (name === "x-pathname") return pathname;
      return null;
    },
  };
  (headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(headersStore);
}

type StaffRow = {
  id: string;
  display_name: string;
  role: "owner" | "manager" | "technician" | "front_desk";
  color_token: string;
} | null;

function setSupabase({
  user,
  authError,
  staff,
  staffError,
  staffThrows,
}: {
  user?: { id: string } | null;
  authError?: Error;
  staff?: StaffRow;
  staffError?: Error | null;
  staffThrows?: Error;
}) {
  const getUser = vi.fn(async () => {
    if (authError) throw authError;
    return { data: { user: user ?? null }, error: null };
  });

  const single = vi.fn(async () => {
    if (staffThrows) throw staffThrows;
    if (staffError) return { data: null, error: staffError };
    return { data: staff ?? null, error: null };
  });
  const eq2 = vi.fn(() => ({ single }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  const from = vi.fn(() => ({ select }));

  (createSupabaseServerClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser },
    from,
  });
}

const SID = "10000000-0000-0000-0000-000000000001";
const DEVICE_USER_ID = "00000000-0000-0000-0000-000000000001";

describe("lib/auth/session", () => {
  const originalSecret = process.env.ACTING_AS_COOKIE_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACTING_AS_COOKIE_SECRET = TEST_ACTING_AS_COOKIE_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    setHeaders("/dashboard");
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.ACTING_AS_COOKIE_SECRET;
    } else {
      process.env.ACTING_AS_COOKIE_SECRET = originalSecret;
    }
  });

  it("returns a full StudioViewer on the happy path", async () => {
    const cookieValue = await mintCookie({ sid: SID });
    setCookies({ acting_as_staff_id: cookieValue });
    setSupabase({
      user: { id: DEVICE_USER_ID },
      staff: { id: SID, display_name: "Maya Patel", role: "owner", color_token: "--accent-rose" },
    });

    const viewer = (await requireStudioSession()) as StudioViewer;
    expect(viewer.deviceUserId).toBe(DEVICE_USER_ID);
    expect(viewer.staff).toEqual({
      id: SID,
      display_name: "Maya Patel",
      role: "owner",
      color_token: "--accent-rose",
    });
  });

  it("throws AuthRedirectError('/login') when the Supabase user is missing", async () => {
    setCookies({});
    setSupabase({ user: null });
    await expect(requireStudioSession()).rejects.toMatchObject({
      target: "/login",
      next: "/dashboard",
    });
    await expect(requireStudioSession()).rejects.toBeInstanceOf(AuthRedirectError);
  });

  it("throws AuthRedirectError('/select-staff') when the operator cookie is missing", async () => {
    setCookies({});
    setSupabase({ user: { id: DEVICE_USER_ID } });
    await expect(requireStudioSession()).rejects.toMatchObject({
      target: "/select-staff",
      next: "/dashboard",
    });
  });

  it("throws AuthRedirectError('/select-staff') when the cookie is tampered", async () => {
    const cookieValue = await mintCookie({ sid: SID });
    // Mutate the trailing signature segment.
    const tampered = cookieValue.slice(0, -1) + (cookieValue.endsWith("a") ? "b" : "a");
    setCookies({ acting_as_staff_id: tampered });
    setSupabase({ user: { id: DEVICE_USER_ID } });
    await expect(requireStudioSession()).rejects.toMatchObject({
      target: "/select-staff",
    });
  });

  it("throws AuthRedirectError('/select-staff') when the cookie is expired", async () => {
    const cookieValue = await mintExpiredCookie({ sid: SID });
    setCookies({ acting_as_staff_id: cookieValue });
    setSupabase({ user: { id: DEVICE_USER_ID } });
    await expect(requireStudioSession()).rejects.toMatchObject({
      target: "/select-staff",
    });
  });

  it("throws AuthRedirectError('/select-staff') when the staff row is missing or deactivated", async () => {
    const cookieValue = await mintCookie({ sid: SID });
    setCookies({ acting_as_staff_id: cookieValue });
    setSupabase({ user: { id: DEVICE_USER_ID }, staff: null });
    await expect(requireStudioSession()).rejects.toMatchObject({
      target: "/select-staff",
    });
  });

  it("re-throws Supabase network errors from requireStudioSession", async () => {
    const cookieValue = await mintCookie({ sid: SID });
    setCookies({ acting_as_staff_id: cookieValue });
    setSupabase({
      user: { id: DEVICE_USER_ID },
      staffThrows: Object.assign(new Error("fetch failed"), { name: "TypeError" }),
    });

    await expect(requireStudioSession()).rejects.toThrow(/fetch failed/);
  });

  it("getStudioSessionOrDegraded returns the degraded sentinel on Supabase fetch failure", async () => {
    const cookieValue = await mintCookie({ sid: SID });
    setCookies({ acting_as_staff_id: cookieValue });
    setSupabase({
      user: { id: DEVICE_USER_ID },
      staffThrows: Object.assign(new Error("fetch failed"), { name: "TypeError" }),
    });

    const result = await getStudioSessionOrDegraded();
    expect(result).toEqual({ degraded: true, cookieStaffId: SID });
  });
});
