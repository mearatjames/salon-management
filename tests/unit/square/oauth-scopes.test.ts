// tests/unit/square/oauth-scopes.test.ts
//
// Regression guard: the OAuth `scope` parameter on Square's authorize URL
// must request every scope our SDK call sites depend on. Square doesn't
// grant scopes retroactively — dropping one from the list silently breaks
// the feature that needs it after the next merchant reconnect (or, for new
// connections, immediately).
//
// Each assertion ties one scope to the SDK call site it unblocks; if a
// future refactor removes a call we should still keep the scope until the
// next deliberate reconnect window.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Square OAuth scopes — startOAuth() authorize URL", () => {
  let scope: string;

  beforeEach(async () => {
    vi.stubEnv("SQUARE_APPLICATION_ID", "sandbox-test-application-id");
    vi.stubEnv("ACTING_AS_COOKIE_SECRET", "test-cookie-secret-32-bytes-long-padding");
    // Import after the env is stubbed — the module reads env eagerly inside
    // its helpers (not at top level), but the import-side effects shouldn't
    // fail without a real env either; the dynamic import keeps the test
    // independent of import order if the suite reshuffles.
    const { startOAuth } = await import("@/lib/square/oauth");
    const url = await startOAuth("https://example.test/settings/square");
    scope = new URL(url).searchParams.get("scope") ?? "";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests PAYMENTS_WRITE (terminal.checkouts.create)", () => {
    expect(scope).toContain("PAYMENTS_WRITE");
  });

  it("requests MERCHANT_PROFILE_READ (locations.get for getSquareLocationId)", () => {
    expect(scope).toContain("MERCHANT_PROFILE_READ");
  });

  it("requests DEVICES_READ (devices.list — Settings → Square device sync)", () => {
    expect(scope).toContain("DEVICES_READ");
  });

  it("requests ORDERS_WRITE (orders.create + orders.update — feature 051)", () => {
    expect(scope).toContain("ORDERS_WRITE");
  });

  it("requests DEVICE_CREDENTIAL_MANAGEMENT (terminal pairing)", () => {
    expect(scope).toContain("DEVICE_CREDENTIAL_MANAGEMENT");
  });
});
