// E2E for US3 — per-line tech override via the cart row's chip popover
// (FR-013).
//
// Covers the two US3 acceptance scenarios + tasks.md T037:
//   (1) Override one line, header pick unchanged
//       - pick tech A in the header
//       - tap a service tile → line gets assigned_staff_id = A
//       - open the line's chip popover, pick tech B
//       - assert: chip visibly indicates B; DB assigned_staff_id = B for
//         that row; header chip still shows A; the next tile-tap creates a
//         line with assigned_staff_id = A (header default, NOT the most
//         recently used override)
//   (2) No-op tap on the currently assigned tech is harmless
//       - open the popover; the current staff item is visibly marked
//         disabled
//       - the disabled item cannot fire onSetTech → no
//         `ticket.line_tech_assigned` audit row appears for that line
//
// Docker / Supabase availability: standard probe — skip when the local
// Supabase is unreachable. Audit-log assertions use the per-test cursor
// pattern from `tests/e2e/_db.ts`.

import { expect, test } from "@playwright/test";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";

async function supabaseIsReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(SUPABASE_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Seeded staff ids (see supabase/seed.sql / tests/e2e/_db.ts).
const MAYA_STAFF_ID = "10000000-0000-0000-0000-000000000001"; // operator / owner (signs in)
const JORDAN_STAFF_ID = "10000000-0000-0000-0000-000000000002"; // header pick (A)
const SAM_STAFF_ID = "10000000-0000-0000-0000-000000000003"; // per-line override (B)

const CLASSIC_MANICURE_ID = "20000000-0000-0000-0000-000000000001";
const CLASSIC_PEDICURE_ID = "20000000-0000-0000-0000-000000000003";

async function signInAsMaya(
  page: import("@playwright/test").Page,
  next = "/dashboard"
): Promise<void> {
  const encodedNext = encodeURIComponent(next);
  await page.goto(`/login?next=${encodedNext}`);
  await page.locator("#signin-email").fill("owner@tangnails.dev");
  await page.locator("#signin-password").fill("tang-nails-dev");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/select-staff\?next=/);
  await page.getByRole("button", { name: /Maya Patel/ }).click();
  await page.waitForURL(/selectedTileId=/);
  await page.getByRole("button", { name: "Digit 1" }).click();
  await page.getByRole("button", { name: "Digit 2" }).click();
  await page.getByRole("button", { name: "Digit 3" }).click();
  await page.getByRole("button", { name: "Digit 4" }).click();
  const nextRegex = new RegExp(`${next.replace(/[/\-]/g, "\\$&")}(\\?|$)`);
  await page.waitForURL(nextRegex, { timeout: 10_000 });
}

async function cleanupTickets(
  admin: SupabaseClient,
  ticketIds: ReadonlyArray<string>
): Promise<void> {
  const ids = ticketIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return;
  await admin
    .from("tickets")
    .update({
      status: "discarded",
      closed_at: new Date().toISOString(),
      closed_by_staff_id: MAYA_STAFF_ID,
    })
    .in("id", ids);
}

test.describe.configure({ mode: "serial" });

test.describe("US3: per-line tech override", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 tech-override specs (Docker unavailable)."
      );
    }
  });

  // No global beforeEach reset: the `?fresh=1` dashboard CTA path used by
  // each test always creates a brand-new ticket, so we don't need a clean
  // slate. A cross-spec reset on MAYA_STAFF_ID would race against other 011
  // checkout specs that also operate as Maya under CI's 2-worker setup.

  test("(1) override one line; header pick + subsequent lines unchanged", async ({ page }) => {
    const admin = adminClient();
    const created: string[] = [];

    await signInAsMaya(page, "/dashboard");

    // Start a fresh ticket (?fresh=1 via dashboard CTA).
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;
    created.push(ticketId);

    // Header pick: Jordan Lee (A).
    const techRow = page.locator("[data-slot='checkout-tech-row']");
    await expect(techRow).toBeVisible();
    await techRow.locator(`[data-staff-id='${JORDAN_STAFF_ID}']`).click();
    await expect(page.locator("[data-slot='checkout-tech-chip']")).toBeVisible();

    // Tap "Classic manicure" — first cart line is assigned to Jordan.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANICURE_ID}']`)
      .click();
    const firstLine = page.locator("[data-slot='cart-line']").first();
    await expect(firstLine).toContainText("Classic manicure");
    await expect(firstLine.locator("[data-slot='cart-line-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      JORDAN_STAFF_ID
    );

    // Wait for the optimistic temp id to be replaced by the real server id
    // so the subsequent setLineTech round-trip targets the persisted row.
    const firstLineId = await firstLine.evaluate((el) => el.getAttribute("data-line-id")!);
    await expect(firstLine).toHaveAttribute("data-line-id", /^(?!tmp-)[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });
    const persistedFirstLineId = await firstLine.evaluate((el) => el.getAttribute("data-line-id")!);
    expect(persistedFirstLineId).not.toBe(firstLineId.startsWith("tmp-") ? firstLineId : "");

    // Open that line's chip popover (the chip is now the PopoverTrigger).
    const cursor = newAuditCursor();
    await firstLine.locator("[data-slot='cart-line-tech-chip']").click();
    const popover = page.locator("[data-slot='popover-content']");
    await expect(popover).toBeVisible();

    // Pick Sam Chen (B) from the popover.
    await popover
      .locator(`[data-slot='tech-popover-item'][data-staff-id='${SAM_STAFF_ID}']`)
      .click();

    // Popover closes; chip text/dot reflects Sam.
    await expect(popover).toBeHidden();
    await expect(firstLine.locator("[data-slot='cart-line-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      SAM_STAFF_ID
    );
    await expect(firstLine.locator("[data-slot='cart-line-tech-chip']")).toContainText("Sam Chen");

    // DB: the line's assigned_staff_id is Sam; header chip still shows Jordan.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("ticket_items")
            .select("assigned_staff_id")
            .eq("id", persistedFirstLineId)
            .single();
          return data?.assigned_staff_id ?? null;
        },
        { timeout: 5_000 }
      )
      .toBe(SAM_STAFF_ID);

    await expect(page.locator("[data-slot='checkout-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      JORDAN_STAFF_ID
    );

    // Audit row for the override.
    const auditRows = await getAuditLogRowsSince(cursor, "ticket.line_tech_assigned");
    const matchingOverride = auditRows.filter((r) => r.entity_id === persistedFirstLineId);
    expect(matchingOverride.length).toBeGreaterThanOrEqual(1);
    const overridePayload = (matchingOverride[matchingOverride.length - 1].payload ?? {}) as Record<
      string,
      unknown
    >;
    expect(overridePayload.ticket_id).toBe(ticketId);
    expect(overridePayload.previous_staff_id).toBe(JORDAN_STAFF_ID);
    expect(overridePayload.new_staff_id).toBe(SAM_STAFF_ID);

    // Add another service line — must default to Jordan (header pick), NOT
    // the most recently used override (Sam).
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDICURE_ID}']`)
      .click();
    const secondLine = page.locator("[data-slot='cart-line']").nth(1);
    await expect(secondLine).toContainText("Classic pedicure");
    await expect(secondLine.locator("[data-slot='cart-line-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      JORDAN_STAFF_ID
    );

    // DB cross-check: the new line carries Jordan.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("ticket_items")
            .select("ref_id, assigned_staff_id")
            .eq("ticket_id", ticketId)
            .eq("ref_id", CLASSIC_PEDICURE_ID)
            .maybeSingle();
          return data?.assigned_staff_id ?? null;
        },
        { timeout: 5_000 }
      )
      .toBe(JORDAN_STAFF_ID);

    await cleanupTickets(admin, created);
  });

  test("(2) no-op tap on currently assigned tech is harmless", async ({ page }) => {
    const admin = adminClient();
    const created: string[] = [];

    await signInAsMaya(page, "/dashboard");

    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;
    created.push(ticketId);

    // Header pick: Jordan.
    await page
      .locator(`[data-slot='checkout-tech-row'] [data-staff-id='${JORDAN_STAFF_ID}']`)
      .click();
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANICURE_ID}']`)
      .click();
    const line = page.locator("[data-slot='cart-line']").first();
    await expect(line).toBeVisible();
    await expect(line).toHaveAttribute("data-line-id", /^(?!tmp-)[0-9a-f-]{36}$/, {
      timeout: 10_000,
    });
    const lineId = await line.evaluate((el) => el.getAttribute("data-line-id")!);

    // Open the popover — the currently assigned (Jordan) item is marked
    // as the current pick (aria-disabled / visually disabled). Tapping it
    // must not close the popover via a write and must not emit an audit
    // row.
    const cursor = newAuditCursor();
    await line.locator("[data-slot='cart-line-tech-chip']").click();
    const popover = page.locator("[data-slot='popover-content']");
    await expect(popover).toBeVisible();

    const currentItem = popover.locator(
      `[data-slot='tech-popover-item'][data-staff-id='${JORDAN_STAFF_ID}']`
    );
    await expect(currentItem).toHaveAttribute("aria-disabled", "true");
    await expect(currentItem).toHaveAttribute("data-current", "true");

    // Click the disabled item (browsers still fire click on aria-disabled
    // elements; the handler must guard).
    await currentItem.click({ force: true });

    // Give the (non-)round-trip a beat, then dismiss the popover by
    // clicking outside.
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();

    // No audit row for that line.
    const auditRows = await getAuditLogRowsSince(cursor, "ticket.line_tech_assigned");
    const matching = auditRows.filter((r) => r.entity_id === lineId);
    expect(matching).toHaveLength(0);

    // DB unchanged.
    const { data } = await admin
      .from("ticket_items")
      .select("assigned_staff_id")
      .eq("id", lineId)
      .single();
    expect(data?.assigned_staff_id).toBe(JORDAN_STAFF_ID);

    await cleanupTickets(admin, created);
  });
});
