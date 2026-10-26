import { describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/version/route";

vi.mock("@/lib/build-id", () => ({ BUILD_ID: "build-a" }));

describe("GET /api/version", () => {
  it("returns the serving build ID, uncached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ buildId: "build-a" });
  });
});
