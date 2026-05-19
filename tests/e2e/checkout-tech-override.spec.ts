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

import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { createOpenTicket, SEEDED_SERVICE_IDS } from "./_open-ticket";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

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

// Classic manicure is seeded by `_open-ticket` and not clicked separately.
// Classic pedicure is referenced by test (1) as the second tile-click target
// (it asserts the new line's tech defaults to the header pick, not the
// per-line override applied to the seeded Classic manicure row).
const CLASSIC_PEDICURE_ID = "20000000-0000-0000-0000-000000000003";

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

    // 042-ephemeral-cart: direct-insert an open ticket with Jordan +
    // Classic manicure pre-seeded so the spec lands on the cart-edit
    // route with a confirmed line ready for the tech-override popover.
    const ticketId = await createOpenTicket(admin, {
      techId: JORDAN_STAFF_ID,
      openedByStaffId: MAYA_STAFF_ID,
      items: [
        {
          serviceId: SEEDED_SERVICE_IDS.classicManicure,
          displayName: "Classic manicure",
          unitPriceCents: 2500,
        },
      ],
    });
    created.push(ticketId);
    await page.goto(`/checkout/${ticketId}`);
    await expect(page.locator("[data-slot='checkout-tech-chip']")).toBeVisible({
      timeout: 10_000,
    });

    const firstLine = page.locator("[data-slot='cart-line']").first();
    await expect(firstLine).toContainText("Classic manicure");
    await expect(firstLine.locator("[data-slot='cart-line-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      JORDAN_STAFF_ID
    );

    // The seeded line already has a real UUID (no temp-id replacement
    // needed). Read it for the assertions below.
    const persistedFirstLineId = await firstLine.evaluate((el) => el.getAttribute("data-line-id")!);
    expect(persistedFirstLineId).toMatch(/^[0-9a-f-]{36}$/);

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

    // Direct-insert open ticket with Jordan + Classic manicure pre-seeded.
    const ticketId = await createOpenTicket(admin, {
      techId: JORDAN_STAFF_ID,
      openedByStaffId: MAYA_STAFF_ID,
      items: [
        {
          serviceId: SEEDED_SERVICE_IDS.classicManicure,
          displayName: "Classic manicure",
          unitPriceCents: 2500,
        },
      ],
    });
    created.push(ticketId);
    await page.goto(`/checkout/${ticketId}`);
    await expect(page.locator("[data-slot='checkout-tech-chip']")).toBeVisible({
      timeout: 10_000,
    });

    const line = page.locator("[data-slot='cart-line']").first();
    await expect(line).toBeVisible();
    const lineId = await line.evaluate((el) => el.getAttribute("data-line-id")!);
    expect(lineId).toMatch(/^[0-9a-f-]{36}$/);

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
