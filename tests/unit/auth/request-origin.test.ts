// Unit tests for `lib/auth/request-origin.ts` — the header-based origin
// resolver shared by the invite/redirect plumbing.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { headers } from "next/headers";

import { getRequestOrigin } from "@/lib/auth/request-origin";

function mockHeaders(map: Record<string, string>): void {
  (headers as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    get: (k: string) => map[k.toLowerCase()] ?? null,
  });
}

describe("getRequestOrigin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the `origin` header verbatim when present", async () => {
    mockHeaders({ origin: "https://preview-abc.vercel.app", host: "ignored:9999" });
    expect(await getRequestOrigin()).toBe("https://preview-abc.vercel.app");
  });

  it("reconstructs from x-forwarded-host + x-forwarded-proto behind a proxy", async () => {
    mockHeaders({ "x-forwarded-host": "tang.example.com", "x-forwarded-proto": "https" });
    expect(await getRequestOrigin()).toBe("https://tang.example.com");
  });

  it("defaults a non-localhost host to https", async () => {
    mockHeaders({ host: "tang.example.com" });
    expect(await getRequestOrigin()).toBe("https://tang.example.com");
  });

  it("uses http for a localhost host", async () => {
    mockHeaders({ host: "localhost:3000" });
    expect(await getRequestOrigin()).toBe("http://localhost:3000");
  });
});
