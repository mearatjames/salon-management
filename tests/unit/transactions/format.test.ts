import { describe, expect, it } from "vitest";

import { formatDayLabel, formatRelativeDay, formatTxId } from "@/lib/transactions/format";

// ─── formatTxId — "#" + last 6 hex, uppercase (research R4) ──────────────────

describe("formatTxId", () => {
  it("takes the last 6 hex chars of a UUID and uppercases them", () => {
    expect(formatTxId("a1b2c3d4-e5f6-7890-abcd-ef0123a3f029")).toBe("#A3F029");
  });

  it("uppercases lowercase hex", () => {
    expect(formatTxId("00000000-0000-0000-0000-0000000abcde")).toBe("#0ABCDE");
  });

  it("strips hyphens before taking the last 6 chars", () => {
    // last 6 chars of the raw string would include a hyphen; strip first.
    expect(formatTxId("12345678-90ab-cdef-1234-56789abcdef0")).toBe("#BCDEF0");
  });

  it("is deterministic for the same input", () => {
    const id = "deadbeef-dead-beef-dead-beefdeadbeef";
    expect(formatTxId(id)).toBe(formatTxId(id));
    expect(formatTxId(id)).toBe("#ADBEEF");
  });
});

// ─── formatDayLabel — "May 12, 2026" ─────────────────────────────────────────

describe("formatDayLabel", () => {
  it("formats a YYYY-MM-DD key as 'Month D, YYYY'", () => {
    expect(formatDayLabel("2026-05-12")).toBe("May 12, 2026");
  });

  it("does not zero-pad the day", () => {
    expect(formatDayLabel("2026-01-03")).toBe("January 3, 2026");
  });

  it("handles December", () => {
    expect(formatDayLabel("2025-12-31")).toBe("December 31, 2025");
  });
});

// ─── formatRelativeDay — Today / Yesterday / N days ago / weekday ────────────

describe("formatRelativeDay", () => {
  const today = "2026-05-16"; // a Saturday

  it("returns 'Today' for the today key", () => {
    expect(formatRelativeDay("2026-05-16", today)).toBe("Today");
  });

  it("returns 'Yesterday' for one day before", () => {
    expect(formatRelativeDay("2026-05-15", today)).toBe("Yesterday");
  });

  it("returns 'N days ago' for 2–6 days back", () => {
    expect(formatRelativeDay("2026-05-13", today)).toBe("3 days ago");
    expect(formatRelativeDay("2026-05-14", today)).toBe("2 days ago");
  });

  it("returns the weekday name for 7+ days back", () => {
    // 2026-05-08 is a Friday.
    expect(formatRelativeDay("2026-05-08", today)).toBe("Fri");
  });

  it("returns the weekday name for older dates", () => {
    // 2026-04-20 is a Monday.
    expect(formatRelativeDay("2026-04-20", today)).toBe("Mon");
  });
});
