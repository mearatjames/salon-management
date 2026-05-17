import { describe, expect, it } from "vitest";

import { getSalonTimezone, getSetting, InvalidSettingError } from "@/lib/db/settings";

// Lightweight mock supabase client surface. The real client returns
// `{ data, error }` shapes; we model just enough for the helpers under test.
type SettingsRow = { value: unknown };

function makeMockClient(opts: {
  // Map of `key` → row returned by the maybeSingle() / single() call.
  // `null` means "no row".
  rows: Record<string, SettingsRow | null>;
}) {
  return {
    from(table: string) {
      if (table !== "settings") {
        throw new Error(`unexpected table: ${table}`);
      }
      return {
        select(_cols: string) {
          return {
            eq(col: string, key: string) {
              if (col !== "key") {
                throw new Error(`unexpected column: ${col}`);
              }
              return {
                async maybeSingle() {
                  const row = opts.rows[key] ?? null;
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("getSetting", () => {
  it("happy path — returns the unwrapped jsonb string value when the row exists", async () => {
    const client = makeMockClient({
      rows: { "salon.timezone": { value: "America/Los_Angeles" } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = await getSetting<string>(client as any, "salon.timezone");
    expect(value).toBe("America/Los_Angeles");
  });

  it("missing row — returns null (caller decides on default)", async () => {
    const client = makeMockClient({ rows: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = await getSetting<string>(client as any, "salon.timezone");
    expect(value).toBeNull();
  });

  it("typed call with a wrong jsonb shape throws InvalidSettingError", async () => {
    const client = makeMockClient({ rows: { foo: { value: 42 } } });
    await expect(
      getSetting<string>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client as any,
        "foo",
        (v): v is string => typeof v === "string"
      )
    ).rejects.toBeInstanceOf(InvalidSettingError);
  });
});

describe("getSalonTimezone", () => {
  it("returns the stored timezone string when the settings row exists", async () => {
    const client = makeMockClient({
      rows: { "salon.timezone": { value: "Asia/Tokyo" } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tz = await getSalonTimezone(client as any);
    expect(tz).toBe("Asia/Tokyo");
  });

  it("returns the 'America/Los_Angeles' default when the row is missing (FR-008)", async () => {
    const client = makeMockClient({ rows: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tz = await getSalonTimezone(client as any);
    expect(tz).toBe("America/Los_Angeles");
  });
});
