// Unit tests for `buildInviteMetadata` in
// `lib/onboarding/invite-metadata.ts`.
//
// This helper resolves the GoTrue `{{ .Data.* }}` fields the hosted invite
// email template reads (issue #159): salon_name, invited_by_name, role and
// expires_human. The settings reads + service-role client are mocked so the
// test runs without Supabase; `formatExpiry` runs for real so the rendered
// expiry string is asserted end-to-end.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/admin", () => ({
  createSupabaseServiceRoleClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/db/settings", () => ({
  getSetting: vi.fn(),
  getSalonTimezone: vi.fn(),
}));

import { createSupabaseServiceRoleClient } from "@/lib/db/admin";
import { getSalonTimezone, getSetting } from "@/lib/db/settings";

import { buildInviteMetadata, INVITE_TTL_DAYS } from "@/lib/onboarding/invite-metadata";

type Mocked<T> = T & ReturnType<typeof vi.fn>;

const setSalonName = (v: unknown) =>
  (getSetting as unknown as Mocked<() => Promise<unknown>>).mockResolvedValue(v);
const setTimezone = (tz: string) =>
  (getSalonTimezone as unknown as Mocked<() => Promise<string>>).mockResolvedValue(tz);

const BASE = {
  displayName: "Hana Soto",
  role: "technician" as const,
  inviterId: "staff-owner-1",
  inviterName: "Maya Patel",
  // 7 days later is 2026-06-06 in LA.
  now: new Date("2026-05-30T18:00:00.000Z"),
};

describe("buildInviteMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSalonName("Tang Nails");
    setTimezone("America/Los_Angeles");
  });

  afterEach(() => vi.restoreAllMocks());

  it("populates all four template variables the invite email reads", async () => {
    const meta = await buildInviteMetadata(BASE);
    expect(meta).toEqual({
      display_name: "Hana Soto",
      role: "technician",
      invited_by: "staff-owner-1",
      invited_by_name: "Maya Patel",
      salon_name: "Tang Nails",
      expires_human: "June 6, 2026",
    });
  });

  it("uses the salon name from settings when present", async () => {
    setSalonName("Tang Nails Studio");
    const meta = await buildInviteMetadata(BASE);
    expect(meta.salon_name).toBe("Tang Nails Studio");
  });

  it("falls back to 'Tang Nails' when salon.name is missing, null, or blank", async () => {
    for (const bad of [null, "", "   ", 42, undefined]) {
      setSalonName(bad);
      const meta = await buildInviteMetadata(BASE);
      expect(meta.salon_name).toBe("Tang Nails");
    }
  });

  it("trims a padded salon name", async () => {
    setSalonName("  Tang Nails  ");
    const meta = await buildInviteMetadata(BASE);
    expect(meta.salon_name).toBe("Tang Nails");
  });

  it("formats expires_human as now + INVITE_TTL_DAYS in the salon timezone", async () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    setTimezone("Asia/Tokyo");
    const meta = await buildInviteMetadata({
      ...BASE,
      now: new Date("2026-05-30T18:00:00.000Z"),
    });
    // 2026-05-30 + 7d = 2026-06-06T18:00Z → 2026-06-07 03:00 JST.
    expect(meta.expires_human).toBe("June 7, 2026");
  });

  it("builds the service-role client once and reads the salon name with it", async () => {
    await buildInviteMetadata(BASE);
    expect(createSupabaseServiceRoleClient).toHaveBeenCalledTimes(1);
    expect(getSetting).toHaveBeenCalledWith(expect.anything(), "salon.name");
    expect(getSalonTimezone).toHaveBeenCalledTimes(1);
  });
});
