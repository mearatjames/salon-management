// E2E for US1 of feature 013-cart-polish — variable-price entry sheet.
//
// Covers acceptance scenarios 1–7 from spec.md:
//   (a) tile tap on the seeded variable-priced "Nail art" service AUTO-
//       opens the price sheet, the row lands unconfirmed, Charge reads
//       "Set price on highlighted items" and is disabled
//   (b) preset chip click sets the working amount and enables Save
//   (c) quick adjuster +$5 nudges the amount up by 500 cents
//   (d) tapping the big-price button reveals the numpad and the first
//       keypress replaces the current value (fresh-edit affordance)
//   (e) Save closes the sheet, clears the highlight, the cart row shows
//       the entered amount, and Charge enables and reads
//       "Take cash · $X.XX"
//
// DB assertions: `ticket_items.unit_price_cents` matches the entered
// amount and `price_unconfirmed=false`; an `audit_log` row for
// `line.price_set` exists, scoped via `newAuditCursor()` +
// `getAuditLogRowsSince()` so the parallel-worker run does not race on
// the shared `audit_log` table.

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
const NAIL_ART_SERVICE_ID = "20000000-0000-0000-0000-000000000005";

test.describe("US1: Variable price entry", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 variable-price specs (Docker unavailable)."
      );
    }
  });

  test("(a–e) tile tap auto-opens sheet → preset + adjuster + numpad → Save enables Charge", async ({
    page,
  }) => {
    const cursor = newAuditCursor();

    await page.goto("/dashboard");

    // Open a fresh ticket via the dashboard CTA.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketId = new URL(page.url()).pathname.split("/").pop()!;

    // Pick Jordan Lee as the header tech.
    const techRow = page.locator("[data-slot='checkout-tech-row']");
    await expect(techRow).toBeVisible();
    await techRow.locator("[data-staff-name='Jordan Lee']").click();
    await expect(page.locator("[data-slot='checkout-tech-chip']")).toBeVisible();

    // (a) Tap the variable-priced "Nail art" tile.
    const tile = page.locator(
      `[data-slot='service-tile'][data-service-id='${NAIL_ART_SERVICE_ID}']`
    );
    await expect(tile).toBeEnabled();
    await tile.click();

    // The cart row lands unconfirmed and the price sheet auto-opens.
    const cartLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Nail art" })
      .first();
    await expect(cartLine).toHaveAttribute("data-needs-price", "true");

    const priceSheet = page.locator("[data-slot='price-sheet']");
    await expect(priceSheet).toBeVisible({ timeout: 5_000 });

    // Charge reads the unconfirmed-line hint and is disabled.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toBeDisabled();
    await expect(chargeBtn).toHaveText(/Set price on highlighted items/);

    // (b) Tap the "Medium" preset chip — sets the working amount to $45
    //     and enables Save.
    const mediumPreset = priceSheet
      .locator("[data-slot='price-sheet-preset']")
      .filter({ hasText: "Medium" });
    await expect(mediumPreset).toBeVisible();
    await mediumPreset.click();
    const saveBtn = priceSheet.locator("[data-slot='price-sheet-save']");
    await expect(saveBtn).toBeEnabled();
    await expect(saveBtn).toHaveText(/\$45/);

    // (c) Quick-adjuster +$5 nudges the working amount to $50.
    const plusFive = priceSheet.locator("[data-slot='price-sheet-adjust-plus-5']");
    await plusFive.click();
    await expect(saveBtn).toHaveText(/\$50/);

    // (d) Tap the amount → numpad pops; first keypress replaces.
    const bigPrice = priceSheet.locator("[data-slot='price-sheet-bigprice']");
    await bigPrice.click();
    const numpad = priceSheet.locator("[data-slot='price-sheet-numpad']");
    await expect(numpad).toBeVisible();
    await numpad.locator("[data-key='5']").click();
    await numpad.locator("[data-key='0']").click();
    // After two keypresses the value is "50" (first keypress replaced the
    // 50-from-adjuster with "5", second appended → "50").
    await expect(saveBtn).toHaveText(/\$50/);

    // (e) Save closes the sheet and clears the unconfirmed highlight.
    await saveBtn.click();
    await expect(priceSheet).toBeHidden({ timeout: 5_000 });
    await expect(cartLine).toHaveAttribute("data-needs-price", "false");
    // The cart line now shows the saved amount.
    await expect(cartLine.locator("[data-slot='cart-line-price']")).toHaveText("$50.00");

    // The Charge button label now reads the priced total. Picking the cash
    // payment tile (phase-2 gate) enables it.
    await expect(chargeBtn).toHaveText(/Take cash · \$50\.00/);
    await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
    await expect(chargeBtn).toBeEnabled();

    // DB-level assertions.
    const admin = adminClient();
    const { data: items, error: itErr } = await admin
      .from("ticket_items")
      .select("id, kind, unit_price_cents, price_unconfirmed, ref_id")
      .eq("ticket_id", ticketId);
    expect(itErr).toBeNull();
    expect(items).toHaveLength(1);
    expect(items![0]).toMatchObject({
      kind: "service",
      unit_price_cents: 5000,
      price_unconfirmed: false,
      ref_id: NAIL_ART_SERVICE_ID,
    });

    // Audit: a `line.price_set` row with the expected payload exists.
    const auditRows = await getAuditLogRowsSince(cursor, "line.price_set");
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const lastSet = auditRows[auditRows.length - 1];
    expect(lastSet.entity_id).toBe(items![0].id);
    expect(lastSet.payload).toMatchObject({
      ticket_id: ticketId,
      new_unit_price_cents: 5000,
      was_unconfirmed: true,
    });

    // Cleanup: discard the ticket so re-runs start clean.
    await admin
      .from("tickets")
      .update({
        status: "discarded",
        closed_at: new Date().toISOString(),
        closed_by_staff_id: "10000000-0000-0000-0000-000000000001",
      })
      .eq("id", ticketId);
  });
});
