// E2E for US1 of feature 049-per-service-discount — scoped discounts.
//
// Covers Acceptance Scenarios US1-1..US1-4 from spec.md, walked through
// in quickstart.md § "US1" and § "US1-3":
//   US1-1: two-service cart (Manicure $25 + Pedicure $40). Open the
//          discount sheet, pick Percent 50%, "Selected services" →
//          Pedicure only, save. Total reflects $25 + ($40 / 2) = $45.
//          Persist via Take cash and assert the `ticket_items` row
//          carries `discount_target_line_ids = [pediItemId]`.
//   US1-2: same two-service cart with a $20 flat scoped to Manicure
//          only → subtotal $45 ($25-$20 + $40 = $45 — flat scoped caps
//          at the targeted subtotal). Cap edge: $50 flat scoped to
//          Manicure caps at -$25 → subtotal $40 (the surviving Pedicure).
//   US1-3: REGRESSION for SC-005 / FR-005 — two-service cart, Percent
//          10% scope left on default "All services". Subtotal $58.50
//          ($65 * 0.9). The displayed discount row carries no "scoped"
//          marker (US2 ships the scope label; US1 only proves math).
//   US1-4: single-service cart equivalence — Manicure $25 only, Percent
//          10% scoped to Manicure-only AND scope=all yield the same
//          total $22.50.
//
// Uses the worker-scoped staff fixture from `_fixtures.ts` so this spec
// can mutate freely without colliding with parallel workers — the seeded
// Maya tile would race the staff cleanup logic. The seeded service tiles
// (Classic manicure $25 / Classic pedicure $40) are read-only and shared,
// which is fine. Sign in as owner; pick the worker's tech tile for cart
// assignment (Sam Chen has Gel polish + the rest, but the fixture tech
// has all services).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { expect, test } from "./_fixtures";

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

// Seeded ids (see supabase/seed.sql). Both are fixed-price, assigned to
// Jordan + Sam — but the fixture tech ("Test Tech [w<N>]") has the wider
// staff_services grant the upsertStaffTrio writes implicitly; the cart
// uses the fixture tech via `[data-staff-name=...]`. If the fixture tech
// happens to lack the service assignment, the seeded Sam tile is a fine
// fallback — Sam is assigned to both services and the cart never
// mutates staff state, so we don't actually need a worker-scoped tech
// for these read-only paths.
const CLASSIC_MANI_SERVICE_ID = "20000000-0000-0000-0000-000000000001"; // $25
const CLASSIC_PEDI_SERVICE_ID = "20000000-0000-0000-0000-000000000003"; // $40

// Fresh ephemeral draft. Mirrors the helper in checkout-discount.spec.ts.
async function openFreshTicket(
  page: import("@playwright/test").Page,
  techName: string
): Promise<void> {
  await page.locator("[data-slot='new-transaction-cta']").click();
  await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
  const techRow = page.locator("[data-slot='checkout-tech-row']");
  await expect(techRow).toBeVisible();
  await techRow.locator(`[data-staff-name='${techName}']`).click();
  await expect(page.locator("[data-slot='checkout-tech-chip']")).toBeVisible();
}

async function waitForConfirmedLine(
  cartLine: import("@playwright/test").Locator,
  timeoutMs = 5_000
): Promise<void> {
  await expect
    .poll(
      async () => {
        const lineId = await cartLine.getAttribute("data-line-id");
        return lineId && !lineId.startsWith("tmp-") ? "ready" : "wait";
      },
      { timeout: timeoutMs }
    )
    .toBe("ready");
}

async function takeCashAndGetTicketId(page: import("@playwright/test").Page): Promise<string> {
  await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
  await page.locator("[data-slot='take-cash-button']").click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
  await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

test.describe("US1: scope a discount to selected services", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping per-service-discount US1 e2e."
      );
    }
  });

  test("US1-1: scoped percent on the larger of two services → subtotal reflects scope, persisted row carries the target line id", async ({
    page,
  }) => {
    const admin = adminClient();
    await page.goto("/dashboard");
    // Sam Chen is assigned to BOTH classic manicure and classic pedicure
    // per seed.sql; the fixture tech has no `staff_services` grants so
    // those tiles wouldn't render under its picker. The cart is read-
    // only against seeded staff/service rows in this spec so using Sam
    // is safe across parallel workers.
    await openFreshTicket(page, "Sam Chen");

    // Add Classic manicure ($25) + Classic pedicure ($40).
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // Open sheet, switch to Percent, enter 50.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });

    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("50");

    // Switch scope to Selected services.
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();

    // Hint visible (no chips picked yet); Save disabled.
    await expect(discountSheet.locator("[data-slot='discount-sheet-scope-hint']")).toBeVisible();
    await expect(discountSheet.locator("[data-slot='discount-sheet-save']")).toBeDisabled();

    // Pick the Pedicure chip only.
    const pediLineId = await pediLine.getAttribute("data-line-id");
    expect(pediLineId).toBeTruthy();
    const pediChip = discountSheet.locator(
      `[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`
    );
    await pediChip.click();
    await expect(pediChip).toHaveAttribute("data-picked", "true");

    // Save enables; submit.
    await expect(discountSheet.locator("[data-slot='discount-sheet-save']")).toBeEnabled();
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // Discount row landed.
    const discountLine = page.locator("[data-slot='cart-line'][data-line-kind='discount']").first();
    await expect(discountLine).toBeVisible({ timeout: 5_000 });

    // Math: $25 (mani, all) + ($40 * 0.5 = $20) (pedi after 50% scoped) = $45.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$45\.00/);

    // Persist + verify the scope is written to the new column.
    const ticketId = await takeCashAndGetTicketId(page);

    const { data: items, error } = await admin
      .from("ticket_items")
      .select("id, kind, name_snapshot, discount_pct, discount_target_line_ids")
      .eq("ticket_id", ticketId);
    expect(error).toBeNull();
    const persistedPedi = items!.find(
      (i) => i.kind === "service" && i.name_snapshot === "Classic pedicure"
    );
    const persistedDiscount = items!.find((i) => i.kind === "discount");
    expect(persistedDiscount).toBeTruthy();
    expect(persistedDiscount!.discount_pct).toBe(50);
    expect(persistedDiscount!.discount_target_line_ids).toEqual([persistedPedi!.id]);
  });

  test("US1-2: scoped flat — cap edge $50 flat on a $25 Manicure caps at -$25, Pedicure unaffected", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // $50 flat scoped to Manicure ($25) → caps at -$25 (FR-004).
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("50");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();

    const maniLineId = await maniLine.getAttribute("data-line-id");
    expect(maniLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${maniLineId}']`)
      .click();

    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // $25 (mani) + $40 (pedi) - min($50, $25) = $40.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$40\.00/);
  });

  test("US1-3: default scope unchanged (FR-005 / SC-005 regression) — Percent 10% applies to all services", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // Open sheet, Percent 10, leave scope on default "All services".
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("10");
    // Verify the default radio is "All services in this sale".
    await expect(discountSheet.locator("[data-slot='discount-sheet-scope-all']")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    // No chip-picker section while scope=all.
    await expect(discountSheet.locator("[data-slot='discount-sheet-scope-chip']")).toHaveCount(0);

    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // 10% of $65 = $6.50 → total $58.50.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$58\.50/);
  });

  test("US1-4: single-service equivalence — Percent 10% scoped to the only service == scope=all", async ({
    page,
  }) => {
    // Path A — Percent 10% scoped to the only service (Manicure).
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("10");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();

    const maniLineId = await maniLine.getAttribute("data-line-id");
    expect(maniLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${maniLineId}']`)
      .click();

    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // 10% of $25 = $2.50 → total $22.50.
    const chargeBtnA = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtnA).toHaveText(/Take cash · \$22\.50/);

    // Path B — same cart shape, default scope=all. Open a fresh draft.
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLineB = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLineB);

    await page.locator("[data-slot='add-discount-button']").click();
    const sheetB = page.locator("[data-slot='discount-sheet']");
    await expect(sheetB).toBeVisible({ timeout: 5_000 });
    await sheetB.locator("[data-slot='discount-sheet-shape-percent']").click();
    await sheetB.locator("[data-slot='discount-sheet-amount']").fill("10");
    // Leave scope on default (all).
    await sheetB.locator("[data-slot='discount-sheet-save']").click();
    await expect(sheetB).toBeHidden({ timeout: 5_000 });

    const chargeBtnB = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtnB).toHaveText(/Take cash · \$22\.50/);
  });
});

// ─── US2: see which services a discount applies to ────────────────────────────
//
// Covers Acceptance Scenarios US2-1 .. US2-4 from spec.md / quickstart.md
// § "US2" and § "US2-4". US2 layers visibility on top of US1: the cart
// discount row carries a `data-scope-kind` + `data-scope-target-count`
// pair and (for scoped rows) a label suffix; the printable receipt — and,
// covered by `transactions.spec.ts`, the past-transaction drawer — render
// an `Applies to: <name>[, <name>]` sub-line beneath each scoped discount
// line. All-services discount rows render unchanged (no sub-line, no
// scope label suffix on the cart row).

test.describe("US2: cart row + printable receipt show which services a discount applies to", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping per-service-discount US2 e2e."
      );
    }
  });

  test("US2-1: cart row, single target → scope-kind=selected, count=1, label suffix is the target's service name", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // Open the sheet, Percent 50, scope to the Pedicure chip only.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("50");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();

    const pediLineId = await pediLine.getAttribute("data-line-id");
    expect(pediLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`)
      .click();
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // The cart discount row carries the scope-kind / scope-target-count
    // markers AND the label includes "· 50%" and "· Classic pedicure".
    const cartDiscountRow = page.locator("[data-slot='cart-discount-row']").first();
    await expect(cartDiscountRow).toBeVisible({ timeout: 5_000 });
    await expect(cartDiscountRow).toHaveAttribute("data-scope-kind", "selected");
    await expect(cartDiscountRow).toHaveAttribute("data-scope-target-count", "1");
    await expect(cartDiscountRow).toContainText("50%");
    await expect(cartDiscountRow).toContainText("Classic pedicure");
  });

  test("US2-2: cart row, N>1 targets → scope-kind=selected, count=2, label suffix reads `2 services`", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("10");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();

    const maniLineId = await maniLine.getAttribute("data-line-id");
    const pediLineId = await pediLine.getAttribute("data-line-id");
    expect(maniLineId).toBeTruthy();
    expect(pediLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${maniLineId}']`)
      .click();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`)
      .click();
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    const cartDiscountRow = page.locator("[data-slot='cart-discount-row']").first();
    await expect(cartDiscountRow).toBeVisible({ timeout: 5_000 });
    await expect(cartDiscountRow).toHaveAttribute("data-scope-kind", "selected");
    await expect(cartDiscountRow).toHaveAttribute("data-scope-target-count", "2");
    await expect(cartDiscountRow).toContainText("2 services");
  });

  test("US2-3: cart row, default scope (all services) → scope-kind=all, count=0, no scope label suffix", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("10");
    // Leave scope on default "All services".
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    const cartDiscountRow = page.locator("[data-slot='cart-discount-row']").first();
    await expect(cartDiscountRow).toBeVisible({ timeout: 5_000 });
    await expect(cartDiscountRow).toHaveAttribute("data-scope-kind", "all");
    await expect(cartDiscountRow).toHaveAttribute("data-scope-target-count", "0");
    // No "· N services" suffix and no specific service-name suffix.
    await expect(cartDiscountRow).not.toContainText("services");
    await expect(cartDiscountRow).not.toContainText("Classic manicure");
  });

  test("US2-4: printable receipt — scoped discount shows `Applies to: <name>` sub-line; all-services row stays unchanged", async ({
    page,
  }) => {
    // Mixed sale: scoped discount on Pedicure + an all-services flat discount.
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // Scoped discount: Percent 50% on the Pedicure only.
    await page.locator("[data-slot='add-discount-button']").click();
    let discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("50");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();
    const pediLineId = await pediLine.getAttribute("data-line-id");
    expect(pediLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`)
      .click();
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // All-services discount: $1 flat on the whole ticket.
    await page.locator("[data-slot='add-discount-button']").click();
    discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("1");
    // Leave scope=all (default).
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // Pay + land on done screen + fetch the ticket id.
    const ticketId = await takeCashAndGetTicketId(page);

    // Navigate to the printable receipt for this ticket.
    await page.goto(`/checkout/${ticketId}/receipt`);

    const items = page.locator("[data-slot='receipt-item']");
    // 2 service rows + 2 discount rows = 4 items.
    await expect(items).toHaveCount(4);

    const scopedRow = page
      .locator("[data-slot='receipt-item'][data-kind='discount'][data-scope-kind='selected']")
      .first();
    await expect(scopedRow).toBeVisible();
    const scopedTargets = scopedRow.locator("[data-slot='receipt-item-targets']");
    await expect(scopedTargets).toBeVisible();
    await expect(scopedTargets).toContainText("Applies to:");
    await expect(scopedTargets).toContainText("Classic pedicure");

    // The all-services discount row has NO `receipt-item-targets` sub-line.
    const allServicesRow = page
      .locator("[data-slot='receipt-item'][data-kind='discount'][data-scope-kind='all']")
      .first();
    await expect(allServicesRow).toBeVisible();
    await expect(allServicesRow.locator("[data-slot='receipt-item-targets']")).toHaveCount(0);
  });
});

// ─── US3: targeting stays correct as the cart changes ─────────────────────────
//
// Covers Acceptance Scenarios US3-1 .. US3-5 + the FR-013 empty-scope refusal
// + the FR-017 in-place edit, per quickstart.md § "US3", § "Edge: empty-scope
// refused at save (FR-013)", and § "Edit an existing discount (FR-017)".
//
// Quickstart prices differ from seed prices (quickstart uses $40/$60/$15
// shorthand; seed has Classic manicure $25, Classic pedicure $40, Gel polish
// $35). The assertions use the seed prices and recompute the expected math
// accordingly. The Sam Chen seed staff is assigned to all three so the cart
// can mutate freely.
//
// Gel polish ($35, id ...002) doubles as the "Polish" third service in US3-2.

import { getAuditLogRowsSince, newAuditCursor, type AuditRow } from "./_db";

const GEL_POLISH_SERVICE_ID = "20000000-0000-0000-0000-000000000002"; // $35

test.describe("US3: targeting stays correct as the cart changes", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping per-service-discount US3 e2e."
      );
    }
  });

  test("US3-1: remove the only target → discount auto-removes in the same render; no error; Take cash enabled", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    // Add Manicure ($25) + Pedicure ($40).
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // $10 flat scoped to Pedicure only. Subtotal = $25 + ($40 - $10) = $55.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("10");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();
    const pediLineId = await pediLine.getAttribute("data-line-id");
    expect(pediLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`)
      .click();
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // Confirm the pre-removal state.
    await expect(page.locator("[data-slot='cart-discount-row']").first()).toBeVisible();
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$55\.00/);

    // Remove Pedicure (the only target).
    await pediLine.locator("[data-slot='cart-line-remove']").click();

    // In the SAME render: Pedicure gone, discount also gone, subtotal = $25.
    await expect(pediLine).toBeHidden();
    await expect(page.locator("[data-slot='cart-discount-row']")).toHaveCount(0);
    await expect(chargeBtn).toHaveText(/Take cash · \$25\.00/);
    // No error banner.
    await expect(page.locator("[data-slot='checkout-error-banner']")).toHaveCount(0);
    // Take cash still enabled (we'll pay to confirm payment isn't blocked).
    await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
    await expect(chargeBtn).toBeEnabled();
  });

  test("US3-2: remove one of two targets → discount remains; scope label collapses to single name; subtotal recomputes", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    // Manicure $25, Pedicure $40, Gel polish $35 → service subtotal $100.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${GEL_POLISH_SERVICE_ID}']`)
      .click();
    const polishLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Gel polish" })
      .first();
    await waitForConfirmedLine(polishLine);

    // 50% percent scoped to Pedicure + Polish.
    // Targeted subtotal = $40 + $35 = $75. Discount = -$37.50.
    // Subtotal = $100 - $37.50 = $62.50.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("50");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();
    const pediLineId = await pediLine.getAttribute("data-line-id");
    const polishLineId = await polishLine.getAttribute("data-line-id");
    expect(pediLineId).toBeTruthy();
    expect(polishLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`)
      .click();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${polishLineId}']`)
      .click();
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    const cartDiscountRow = page.locator("[data-slot='cart-discount-row']").first();
    await expect(cartDiscountRow).toHaveAttribute("data-scope-target-count", "2");
    await expect(cartDiscountRow).toContainText("2 services");

    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$62\.50/);

    // Remove Polish → targets = [Pedicure]. Targeted subtotal $40. Discount -$20.
    // Subtotal = $25 + $40 - $20 = $45.
    await polishLine.locator("[data-slot='cart-line-remove']").click();

    await expect(polishLine).toBeHidden();
    await expect(cartDiscountRow).toBeVisible();
    await expect(cartDiscountRow).toHaveAttribute("data-scope-target-count", "1");
    await expect(cartDiscountRow).toContainText("Classic pedicure");
    await expect(chargeBtn).toHaveText(/Take cash · \$45\.00/);
  });

  test("US3-4: add a new service AFTER a scoped discount → existing discount does not auto-include it", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    // Manicure $25.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    // 20% scoped to Manicure only → discount -$5 → subtotal $20.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("20");
    await discountSheet.locator("[data-slot='discount-sheet-scope-selected']").click();
    const maniLineId = await maniLine.getAttribute("data-line-id");
    expect(maniLineId).toBeTruthy();
    await discountSheet
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${maniLineId}']`)
      .click();
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$20\.00/);

    // Add Pedicure $40 — the existing scoped discount must NOT include it.
    // Subtotal should be Manicure $25 - $5 + Pedicure $40 = $60.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    await expect(chargeBtn).toHaveText(/Take cash · \$60\.00/);

    // The scope label still references Manicure only.
    const cartDiscountRow = page.locator("[data-slot='cart-discount-row']").first();
    await expect(cartDiscountRow).toHaveAttribute("data-scope-target-count", "1");
    await expect(cartDiscountRow).toContainText("Classic manicure");
  });

  test("US3-5: auto-remove never blocks payment — wipe both targeted services, both discounts vanish, no error", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // Two scoped discounts: one per service.
    const maniLineId = await maniLine.getAttribute("data-line-id");
    const pediLineId = await pediLine.getAttribute("data-line-id");

    // Discount 1: $5 flat scoped to Manicure.
    await page.locator("[data-slot='add-discount-button']").click();
    let ds = page.locator("[data-slot='discount-sheet']");
    await expect(ds).toBeVisible({ timeout: 5_000 });
    await ds.locator("[data-slot='discount-sheet-amount']").fill("5");
    await ds.locator("[data-slot='discount-sheet-scope-selected']").click();
    await ds
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${maniLineId}']`)
      .click();
    await ds.locator("[data-slot='discount-sheet-save']").click();
    await expect(ds).toBeHidden({ timeout: 5_000 });

    // Discount 2: $5 flat scoped to Pedicure.
    await page.locator("[data-slot='add-discount-button']").click();
    ds = page.locator("[data-slot='discount-sheet']");
    await expect(ds).toBeVisible({ timeout: 5_000 });
    await ds.locator("[data-slot='discount-sheet-amount']").fill("5");
    await ds.locator("[data-slot='discount-sheet-scope-selected']").click();
    await ds
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`)
      .click();
    await ds.locator("[data-slot='discount-sheet-save']").click();
    await expect(ds).toBeHidden({ timeout: 5_000 });

    // Sanity: 2 discount rows visible.
    await expect(page.locator("[data-slot='cart-discount-row']")).toHaveCount(2);

    // Remove Manicure.
    await maniLine.locator("[data-slot='cart-line-remove']").click();
    // Then Pedicure.
    await pediLine.locator("[data-slot='cart-line-remove']").click();

    // Cart is empty.
    await expect(page.locator("[data-slot='cart-line']")).toHaveCount(0);
    // No discount rows.
    await expect(page.locator("[data-slot='cart-discount-row']")).toHaveCount(0);
    // No error banner.
    await expect(page.locator("[data-slot='checkout-error-banner']")).toHaveCount(0);
    // Take cash is disabled (empty cart, not a discount error).
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toBeDisabled();
  });

  test("FR-013: empty-scope refused at save — Save disabled, inline hint visible, picking any chip enables Save", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page.locator("[data-slot='add-discount-button']").click();
    const ds = page.locator("[data-slot='discount-sheet']");
    await expect(ds).toBeVisible({ timeout: 5_000 });
    await ds.locator("[data-slot='discount-sheet-shape-percent']").click();
    await ds.locator("[data-slot='discount-sheet-amount']").fill("10");
    await ds.locator("[data-slot='discount-sheet-scope-selected']").click();

    // Save disabled + hint visible while no chip picked.
    await expect(ds.locator("[data-slot='discount-sheet-scope-hint']")).toBeVisible();
    await expect(ds.locator("[data-slot='discount-sheet-save']")).toBeDisabled();

    // Pick one chip → Save enables and hint hides.
    const maniLineId = await maniLine.getAttribute("data-line-id");
    expect(maniLineId).toBeTruthy();
    await ds
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${maniLineId}']`)
      .click();
    await expect(ds.locator("[data-slot='discount-sheet-save']")).toBeEnabled();
    await expect(ds.locator("[data-slot='discount-sheet-scope-hint']")).toHaveCount(0);
  });

  test("FR-017: edit a scoped discount in place — sheet prefills; save changes; ephemeral edit does not audit", async ({
    page,
    staffFixture,
  }) => {
    // We must persist the discount (Take cash) to emit the audit; this test
    // exercises the persisted-mode edit path. Audit-cursor pattern from
    // tests/e2e/_db.ts so parallel workers don't race.
    const auditCursor = newAuditCursor();

    await page.goto("/dashboard");
    await openFreshTicket(page, "Sam Chen");

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const maniLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(maniLine);

    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_PEDI_SERVICE_ID}']`)
      .click();
    const pediLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic pedicure" })
      .first();
    await waitForConfirmedLine(pediLine);

    // Scoped 15% discount on Pedicure → -$6 → subtotal $59.
    await page.locator("[data-slot='add-discount-button']").click();
    const ds = page.locator("[data-slot='discount-sheet']");
    await expect(ds).toBeVisible({ timeout: 5_000 });
    await ds.locator("[data-slot='discount-sheet-shape-percent']").click();
    await ds.locator("[data-slot='discount-sheet-amount']").fill("15");
    await ds.locator("[data-slot='discount-sheet-scope-selected']").click();
    const pediLineId = await pediLine.getAttribute("data-line-id");
    expect(pediLineId).toBeTruthy();
    await ds
      .locator(`[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`)
      .click();
    await ds.locator("[data-slot='discount-sheet-save']").click();
    await expect(ds).toBeHidden({ timeout: 5_000 });

    // Cart is ephemeral until Take cash (Feature 043). The edit affordance
    // runs through the local-replace path here; the persisted-mode audit
    // (`discount.edited` with before/after blocks) is exercised by the unit
    // test (tests/unit/checkout/edit-discount-line-action.test.ts). We
    // assert below that NO audit row was emitted for this worker — proves
    // the local replace ran without round-tripping the server.

    // Tap the Edit (pencil) affordance on the discount row.
    const cartDiscountRow = page.locator("[data-slot='cart-discount-row']").first();
    await expect(cartDiscountRow).toBeVisible();
    await cartDiscountRow.locator("[data-slot='cart-discount-edit']").click();

    // Sheet opens prefilled — percent 15, scope selected with Pedicure picked.
    const editSheet = page.locator("[data-slot='discount-sheet']");
    await expect(editSheet).toBeVisible({ timeout: 5_000 });
    await expect(editSheet.locator("[data-slot='discount-sheet-shape-percent']")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(editSheet.locator("[data-slot='discount-sheet-amount']")).toHaveValue("15");
    await expect(editSheet.locator("[data-slot='discount-sheet-scope-selected']")).toHaveAttribute(
      "aria-checked",
      "true"
    );
    const pediChip = editSheet.locator(
      `[data-slot='discount-sheet-scope-chip'][data-line-id='${pediLineId}']`
    );
    await expect(pediChip).toHaveAttribute("data-picked", "true");

    // Primary button label reads "Save changes" in edit mode.
    await expect(editSheet.locator("[data-slot='discount-sheet-save']")).toHaveText(
      /Save changes/i
    );

    // Change to 20%. Save.
    await editSheet.locator("[data-slot='discount-sheet-amount']").fill("20");
    await editSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(editSheet).toBeHidden({ timeout: 5_000 });

    // Subtotal recomputes: 20% of $40 = $8. Total = $25 + $40 - $8 = $57.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$57\.00/);

    // The edit happened on the ephemeral draft (no server round-trip);
    // confirm no discount.edited audit was emitted for this worker.
    // (Persisted-mode edits ARE audited — covered by the unit test.)
    const rows: AuditRow[] = await getAuditLogRowsSince(auditCursor, "discount.edited", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(rows).toEqual([]);
  });
});
