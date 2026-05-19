// E2E for US2 of feature 013-cart-polish — row-level price override.
//
// Covers acceptance scenarios 1–5 from spec.md:
//   (a) tap a confirmed (fixed-price) row's price button → the same
//       PriceSheet opens pre-filled with the row's current amount AND
//       Remove is NOT rendered (US2 override mode hides it)
//   (b) Save updates only that row → cart total recomputes and the
//       displayed line price reflects the new amount
//   (c) the catalog `services.price_cents` is unchanged — the override
//       did NOT propagate (the cleanest expression of "fresh ticket
//       adds the same service at the catalog price" is a DB read on
//       the catalog before + after the override)
//   (d) Cancel leaves the row unchanged
//   (e) Cross-story interaction: on an unconfirmed (variable) row the
//       override path is NOT taken — the parent passes isOverride=false
//       and Remove is rendered (US1 + US2 interaction)
//
// DB assertions: `services.price_cents` for the chosen fixed-price
// service is the same before + after; `ticket_items.unit_price_cents`
// for the named ticket row reflects the override; `audit_log` carries a
// `line.price_set` row with `payload.was_unconfirmed=false`, scoped via
// `newAuditCursor()` / `getAuditLogRowsSince()`.

import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";

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

// Seeded ids (see supabase/seed.sql).
// Classic manicure — fixed-price ($25), assigned to Jordan + Sam.
const CLASSIC_MANI_SERVICE_ID = "20000000-0000-0000-0000-000000000001";
// Nail art — variable-priced, no assignments (so any tech can add it).
const NAIL_ART_SERVICE_ID = "20000000-0000-0000-0000-000000000005";

async function openFreshTicket(
  page: import("@playwright/test").Page,
  techName: string
): Promise<string> {
  await page.locator("[data-slot='new-transaction-cta']").click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
  const ticketId = new URL(page.url()).pathname.split("/").pop()!;
  const techRow = page.locator("[data-slot='checkout-tech-row']");
  await expect(techRow).toBeVisible();
  await techRow.locator(`[data-staff-name='${techName}']`).click();
  await expect(page.locator("[data-slot='checkout-tech-chip']")).toBeVisible();
  return ticketId;
}

async function discardTicket(admin: SupabaseClient, ticketId: string): Promise<void> {
  await admin
    .from("tickets")
    .update({
      status: "discarded",
      closed_at: new Date().toISOString(),
      closed_by_staff_id: "10000000-0000-0000-0000-000000000001",
    })
    .eq("id", ticketId);
}

test.describe("US2: Row-level price override", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 price-override specs (Docker unavailable)."
      );
    }
  });

  test("(a–c) override a confirmed fixed-price row → row updates, catalog untouched, audit was_unconfirmed=false", async ({
    page,
  }) => {
    const admin = adminClient();
    const cursor = newAuditCursor();

    // Snapshot the catalog price BEFORE the override.
    const { data: svcBefore, error: svcBeforeErr } = await admin
      .from("services")
      .select("id, price_cents")
      .eq("id", CLASSIC_MANI_SERVICE_ID)
      .single();
    expect(svcBeforeErr).toBeNull();
    expect(svcBefore).toBeDefined();
    const catalogPriceBefore = svcBefore!.price_cents as number;

    await page.goto("/dashboard");
    const ticketId = await openFreshTicket(page, "Jordan Lee");

    // Tap the fixed-price tile — confirmed row lands immediately.
    const tile = page.locator(
      `[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`
    );
    await expect(tile).toBeEnabled();
    await tile.click();

    const cartLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    // Confirmed = no needs-price highlight.
    await expect(cartLine).toHaveAttribute("data-needs-price", "false");
    await expect(cartLine.locator("[data-slot='cart-line-price']")).toHaveText(
      `$${(catalogPriceBefore / 100).toFixed(2)}`
    );

    // Wait for the optimistic insert to be replaced with the server-side
    // row id (the override path skips temp-ids — handleEditPrice no-ops on
    // `tmp-*` ids). The line id flips from `tmp-…` to a real UUID.
    await expect
      .poll(
        async () => {
          const lineId = await cartLine.getAttribute("data-line-id");
          return lineId && !lineId.startsWith("tmp-") ? "ready" : "wait";
        },
        { timeout: 5_000 }
      )
      .toBe("ready");

    // (a) Tap the price button → PriceSheet opens in override mode.
    await cartLine.locator("[data-slot='cart-line-price']").click();
    const priceSheet = page.locator("[data-slot='price-sheet']");
    await expect(priceSheet).toBeVisible({ timeout: 5_000 });
    await expect(priceSheet).toHaveAttribute("data-is-override", "true");
    // Pre-filled with the current amount.
    const bigPrice = priceSheet.locator("[data-slot='price-sheet-bigprice']");
    await expect(bigPrice).toContainText(`$${catalogPriceBefore / 100}`);
    // Remove button is NOT rendered (US2 override mode hides it).
    await expect(priceSheet.locator("[data-slot='price-sheet-remove']")).toHaveCount(0);

    // (b) Override to $30 via the numpad: tap bigPrice → numpad pops →
    //     first keypress replaces.
    await bigPrice.click();
    const numpad = priceSheet.locator("[data-slot='price-sheet-numpad']");
    await expect(numpad).toBeVisible();
    await numpad.locator("[data-key='3']").click();
    await numpad.locator("[data-key='0']").click();
    const saveBtn = priceSheet.locator("[data-slot='price-sheet-save']");
    await expect(saveBtn).toHaveText(/\$30/);
    await saveBtn.click();
    await expect(priceSheet).toBeHidden({ timeout: 5_000 });

    // Cart row reflects the new amount.
    await expect(cartLine.locator("[data-slot='cart-line-price']")).toHaveText("$30.00");

    // Charge button reflects the new total.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$30\.00/);

    // DB assertion: ticket_items.unit_price_cents = 3000 for THIS line.
    const lineId = await cartLine.getAttribute("data-line-id");
    expect(lineId).toBeTruthy();
    const { data: items, error: itErr } = await admin
      .from("ticket_items")
      .select("id, unit_price_cents, price_unconfirmed, ref_id, kind")
      .eq("ticket_id", ticketId);
    expect(itErr).toBeNull();
    expect(items).toHaveLength(1);
    expect(items![0]).toMatchObject({
      id: lineId,
      kind: "service",
      ref_id: CLASSIC_MANI_SERVICE_ID,
      unit_price_cents: 3000,
      price_unconfirmed: false,
    });

    // (c) DB assertion: services.price_cents UNCHANGED — the override did
    //     NOT propagate to the catalog.
    const { data: svcAfter, error: svcAfterErr } = await admin
      .from("services")
      .select("price_cents")
      .eq("id", CLASSIC_MANI_SERVICE_ID)
      .single();
    expect(svcAfterErr).toBeNull();
    expect(svcAfter!.price_cents).toBe(catalogPriceBefore);

    // Audit row: line.price_set with was_unconfirmed=false.
    const auditRows = await getAuditLogRowsSince(cursor, "line.price_set");
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const last = auditRows[auditRows.length - 1];
    expect(last.entity_id).toBe(lineId);
    expect(last.payload).toMatchObject({
      ticket_id: ticketId,
      previous_unit_price_cents: catalogPriceBefore,
      new_unit_price_cents: 3000,
      was_unconfirmed: false,
    });

    await discardTicket(admin, ticketId);
  });

  test("(d) Cancel leaves the confirmed row unchanged", async ({ page }) => {
    const admin = adminClient();

    await page.goto("/dashboard");
    const ticketId = await openFreshTicket(page, "Jordan Lee");

    const tile = page.locator(
      `[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`
    );
    await tile.click();
    const cartLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await expect(cartLine).toHaveAttribute("data-needs-price", "false");

    // Wait for the optimistic insert to be confirmed (real UUID).
    await expect
      .poll(
        async () => {
          const lineId = await cartLine.getAttribute("data-line-id");
          return lineId && !lineId.startsWith("tmp-") ? "ready" : "wait";
        },
        { timeout: 5_000 }
      )
      .toBe("ready");

    // Open the override sheet.
    await cartLine.locator("[data-slot='cart-line-price']").click();
    const priceSheet = page.locator("[data-slot='price-sheet']");
    await expect(priceSheet).toBeVisible();

    // Type a new amount but then Cancel.
    await priceSheet.locator("[data-slot='price-sheet-bigprice']").click();
    const numpad = priceSheet.locator("[data-slot='price-sheet-numpad']");
    await expect(numpad).toBeVisible();
    await numpad.locator("[data-key='9']").click();
    await numpad.locator("[data-key='9']").click();
    await priceSheet.locator("[data-slot='price-sheet-cancel']").click();
    await expect(priceSheet).toBeHidden({ timeout: 5_000 });

    // Cart row unchanged — still at the catalog $25.00.
    await expect(cartLine.locator("[data-slot='cart-line-price']")).toHaveText("$25.00");

    // DB: ticket_items still at the catalog price.
    const { data: items } = await admin
      .from("ticket_items")
      .select("unit_price_cents")
      .eq("ticket_id", ticketId);
    expect(items).toHaveLength(1);
    expect(items![0].unit_price_cents).toBe(2500);

    await discardTicket(admin, ticketId);
  });

  test("(e) US1+US2 interaction: unconfirmed row → Remove still rendered (override path NOT taken)", async ({
    page,
  }) => {
    const admin = adminClient();

    await page.goto("/dashboard");
    const ticketId = await openFreshTicket(page, "Maya Patel");

    // Add the variable Nail art service → auto-opens sheet in US1 mode
    // (isOverride=false, Remove rendered).
    const tile = page.locator(
      `[data-slot='service-tile'][data-service-id='${NAIL_ART_SERVICE_ID}']`
    );
    await expect(tile).toBeEnabled();
    await tile.click();

    const priceSheet = page.locator("[data-slot='price-sheet']");
    await expect(priceSheet).toBeVisible({ timeout: 5_000 });
    await expect(priceSheet).toHaveAttribute("data-is-override", "false");
    await expect(priceSheet.locator("[data-slot='price-sheet-remove']")).toBeVisible();

    // Cancel the auto-opened sheet — row stays unconfirmed.
    await priceSheet.locator("[data-slot='price-sheet-cancel']").click();
    await expect(priceSheet).toBeHidden({ timeout: 5_000 });

    const cartLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Nail art" })
      .first();
    await expect(cartLine).toHaveAttribute("data-needs-price", "true");

    // Wait for the optimistic insert to be confirmed (real UUID) — the
    // price button no-ops on temp-id rows.
    await expect
      .poll(
        async () => {
          const lineId = await cartLine.getAttribute("data-line-id");
          return lineId && !lineId.startsWith("tmp-") ? "ready" : "wait";
        },
        { timeout: 5_000 }
      )
      .toBe("ready");

    // Re-open via the row's price button — the row is still unconfirmed,
    // so isOverride=false and Remove MUST still be rendered (the cross-
    // story invariant from US1: !isOverride && priceUnconfirmed → Remove).
    await cartLine.locator("[data-slot='cart-line-price']").click();
    await expect(priceSheet).toBeVisible({ timeout: 5_000 });
    await expect(priceSheet).toHaveAttribute("data-is-override", "false");
    await expect(priceSheet.locator("[data-slot='price-sheet-remove']")).toBeVisible();
    // Close without writing.
    await priceSheet.locator("[data-slot='price-sheet-cancel']").click();
    await expect(priceSheet).toBeHidden({ timeout: 5_000 });

    await discardTicket(admin, ticketId);
  });
});
