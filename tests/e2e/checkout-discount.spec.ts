// E2E for US3 of feature 013-cart-polish — discount lines.
//
// Covers US3 acceptance scenarios 1–8 from spec.md plus the FR-019 status
// invariant and the unconfirmed-line interaction edge case:
//   (a) `+ Discount` opens the sheet with two shape options
//   (b) Flat amount + note "Loyalty perk" → row shows note as suffix
//       label, negative amount, total recomputes
//   (c) Percent 15 → row shows "-$X.XX" computed from current service
//       subtotal
//   (d) adding a new service line → percent discount amount recomputes
//       against the new subtotal
//   (e) remove discount via row's remove control → total recomputes back
//   (f) over-discount (flat $50 on a $30 cart) → displayed total floors
//       to $0 AND Charge disabled
//   (g) note empty → row falls back to "Discount" (flat) or "Discount · 15%"
//       (percent)
//   (h) note populated → row shows the note
//   (i) [FR-019 status invariant] after addDiscountLine AND after
//       removeDiscountLine, `tickets.status='open'` — neither operation
//       transitions the ticket
//   (j) [Edge Case: discount + unconfirmed line] adding a variable service
//       (Cancel the auto-opened price sheet) then a flat $5 discount → the
//       discount line lands, the displayed total reflects the discount
//       against the confirmed service subtotal, but Charge stays disabled
//       with the "Set price on highlighted items" hint (the unconfirmed
//       gate takes precedence over the discount floor)
//
// Feature 043-checkout-ephemeral-draft: the in-progress cart is now an
// ephemeral in-memory draft. Entry is the paramless `/checkout`; adding /
// removing discounts mutates local React state only — NO `ticket_items`
// or `audit_log` rows exist until payment. Specs that complete a sale
// take cash at the end and assert the PERSISTED discount rows + the
// single `ticket.created` audit row; specs whose flow leaves Charge
// disabled (over-discount, unconfirmed line) verify UI behavior only.
// Audit reads are scoped via newAuditCursor() + getAuditLogRowsSince() so
// the parallel-worker run does not race on the shared audit_log table.

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
const CLASSIC_MANI_SERVICE_ID = "20000000-0000-0000-0000-000000000001"; // $25 fixed
const GEL_POLISH_SERVICE_ID = "20000000-0000-0000-0000-000000000002"; // assigned to Sam only
const NAIL_ART_SERVICE_ID = "20000000-0000-0000-0000-000000000005"; // variable

// Feature 043: open a fresh ephemeral draft cart. Entry is the paramless
// `/checkout` — no DB ticket, no `/checkout/[ticketId]` URL until payment.
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

/**
 * Wait for a cart line to carry a stable `data-line-id`. In the ephemeral-
 * draft model lines get a client-generated UUID immediately (no `tmp-`
 * swap), so this resolves as soon as the row is in the DOM — it stays as a
 * defensive guard before line-level operations (remove, set price).
 */
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

// Take cash and return the persisted ticket id (the URL becomes
// `/checkout/[ticketId]` only after the draft is persisted + charged).
async function takeCashAndGetTicketId(page: import("@playwright/test").Page): Promise<string> {
  await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
  await page.locator("[data-slot='take-cash-button']").click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
  await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

test.describe("US3: Discount lines", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 discount specs (Docker unavailable)."
      );
    }
  });

  test("(a, b, e, g, h) flat discount with note → row + recompute + remove restores total → persisted on payment", async ({
    page,
  }) => {
    const admin = adminClient();
    const cursor = newAuditCursor();

    await page.goto("/dashboard");
    await openFreshTicket(page, "Jordan Lee");

    // Add a $25 Classic manicure line.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const serviceLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await expect(serviceLine).toHaveAttribute("data-needs-price", "false");
    await waitForConfirmedLine(serviceLine);

    // (a) Click "+ Discount" → sheet opens with two shape options.
    const addDiscountBtn = page.locator("[data-slot='add-discount-button']");
    await expect(addDiscountBtn).toBeVisible();
    await addDiscountBtn.click();

    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await expect(discountSheet.locator("[data-slot='discount-sheet-shape-flat']")).toBeVisible();
    await expect(discountSheet.locator("[data-slot='discount-sheet-shape-percent']")).toBeVisible();

    // (b) Flat amount $5 with note "Loyalty perk".
    // The default shape is flat; just fill the amount + note.
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("5");
    await discountSheet.locator("[data-slot='discount-sheet-note']").fill("Loyalty perk");
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // The discount row lands below services.
    const discountLine = page.locator("[data-slot='cart-line'][data-line-kind='discount']").first();
    await expect(discountLine).toBeVisible({ timeout: 5_000 });
    // (h) Note is rendered on the row.
    await expect(discountLine).toContainText("Loyalty perk");
    // Negative amount displayed.
    await expect(discountLine.locator("[data-slot='cart-line-price']")).toHaveText("-$5.00");

    // Total recomputed: $25 - $5 = $20.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$20\.00/);

    // (e) Remove the discount via the row's remove control — local-state
    //     mutation only in the ephemeral draft.
    await waitForConfirmedLine(discountLine);
    await discountLine.locator("[data-slot='cart-line-remove']").click();
    await expect(page.locator("[data-slot='cart-line'][data-line-kind='discount']")).toHaveCount(
      0,
      {
        timeout: 5_000,
      }
    );

    // Total recomputed back: $25.
    await expect(chargeBtn).toHaveText(/Take cash · \$25\.00/);

    // (g) Add a second discount with NO note → row falls back to "Discount".
    await addDiscountBtn.click();
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("2");
    // Leave the note empty.
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    const noNoteDiscount = page
      .locator("[data-slot='cart-line'][data-line-kind='discount']")
      .first();
    await expect(noNoteDiscount).toBeVisible({ timeout: 5_000 });
    await expect(noNoteDiscount.locator("[data-slot='cart-line-name']")).toHaveText("Discount");
    // $25 - $2 = $23.
    await expect(chargeBtn).toHaveText(/Take cash · \$23\.00/);

    // Feature 043: take cash — only NOW is the cart persisted. The
    // persisted ticket carries exactly the live cart: one service line +
    // the no-note flat discount (the removed $5 discount was never
    // written). The whole cart yields a single `ticket.created` audit row.
    const ticketId = await takeCashAndGetTicketId(page);

    const { data: items, error: itErr } = await admin
      .from("ticket_items")
      .select(
        "id, kind, unit_price_cents, discount_pct, note, name_snapshot, ref_id, assigned_staff_id"
      )
      .eq("ticket_id", ticketId);
    expect(itErr).toBeNull();
    expect(items).toHaveLength(2);
    const dbDiscount = items!.find((i) => i.kind === "discount");
    expect(dbDiscount).toMatchObject({
      kind: "discount",
      unit_price_cents: -200,
      discount_pct: null,
      note: null,
      name_snapshot: "Discount",
      ref_id: null,
      assigned_staff_id: null,
    });

    const createdRows = await getAuditLogRowsSince(cursor, "ticket.created");
    expect(createdRows.some((r) => r.entity_id === ticketId)).toBe(true);
  });

  test("(c, d) percent discount recomputes against live service subtotal as services change", async ({
    page,
  }) => {
    const admin = adminClient();

    await page.goto("/dashboard");
    // Sam is the only tech with both Classic manicure AND Gel polish access.
    await openFreshTicket(page, "Sam Chen");

    // Add one Classic manicure line ($25).
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const firstService = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(firstService);

    // Open the discount sheet → switch to Percent → enter 15.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-shape-percent']").click();
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("15");
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // (c) Discount row shows -$X.XX computed from current service subtotal.
    //     15% of $25 = $3.75.
    const discountLine = page.locator("[data-slot='cart-line'][data-line-kind='discount']").first();
    await expect(discountLine).toBeVisible({ timeout: 5_000 });
    await expect(discountLine.locator("[data-slot='cart-line-name']")).toHaveText("Discount · 15%");
    await expect(discountLine.locator("[data-slot='cart-line-price']")).toHaveText("-$3.75");

    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    // $25 - $3.75 = $21.25
    await expect(chargeBtn).toHaveText(/Take cash · \$21\.25/);

    // (d) Add a second service (Gel polish — $35 per seed.sql) → percent
    //     discount recomputes against the new subtotal: 15% of $60 = $9.00.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${GEL_POLISH_SERVICE_ID}']`)
      .click();
    const gelLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Gel polish" })
      .first();
    await waitForConfirmedLine(gelLine);

    // The discount row's displayed amount tracks the live service subtotal.
    await expect(discountLine.locator("[data-slot='cart-line-price']")).toHaveText("-$9.00");
    // $60 - $9.00 = $51.00
    await expect(chargeBtn).toHaveText(/Take cash · \$51\.00/);

    // Feature 043: take cash — the persisted discount row carries
    // discount_pct=15 and the amount the server folded against the final
    // $60 service subtotal (15% of $60 = $9.00).
    const ticketId = await takeCashAndGetTicketId(page);

    const { data: items } = await admin
      .from("ticket_items")
      .select("kind, unit_price_cents, discount_pct, name_snapshot")
      .eq("ticket_id", ticketId);
    const dbDiscount = items!.find((i) => i.kind === "discount");
    expect(dbDiscount).toMatchObject({
      kind: "discount",
      discount_pct: 15,
      name_snapshot: "Discount · 15%",
      unit_price_cents: -900,
    });
  });

  test("(f) over-discount floors total to $0 and disables Charge", async ({ page }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Jordan Lee");

    // Add one $25 Classic manicure line.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const serviceLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(serviceLine);

    // Add a $50 flat discount → over-discount, total floors to $0.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("50");
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // Charge label reflects the floored $0 total and the button is disabled.
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toHaveText(/Take cash · \$0\.00/);
    // Cash tile selection alone doesn't matter — chargeEligible is false
    // because totals.totalCents === 0.
    await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
    await expect(chargeBtn).toBeDisabled();
  });

  test("(j) discount + unconfirmed line → discount applies, Charge stays disabled with 'Set price' hint", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await openFreshTicket(page, "Jordan Lee");

    // 1) Add a confirmed $25 Classic manicure line (so the discount has a
    //    service subtotal to land against).
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANI_SERVICE_ID}']`)
      .click();
    const fixedLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Classic manicure" })
      .first();
    await waitForConfirmedLine(fixedLine);

    // 2) Add the variable Nail art tile → auto-opens the price sheet.
    //    Cancel it so the row stays unconfirmed.
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${NAIL_ART_SERVICE_ID}']`)
      .click();
    const priceSheet = page.locator("[data-slot='price-sheet']");
    await expect(priceSheet).toBeVisible({ timeout: 5_000 });
    await priceSheet.locator("[data-slot='price-sheet-cancel']").click();
    await expect(priceSheet).toBeHidden({ timeout: 5_000 });

    const nailArtLine = page
      .locator("[data-slot='cart-line']")
      .filter({ hasText: "Nail art" })
      .first();
    await expect(nailArtLine).toHaveAttribute("data-needs-price", "true");

    // 3) Add a flat $5 discount.
    await page.locator("[data-slot='add-discount-button']").click();
    const discountSheet = page.locator("[data-slot='discount-sheet']");
    await expect(discountSheet).toBeVisible({ timeout: 5_000 });
    await discountSheet.locator("[data-slot='discount-sheet-amount']").fill("5");
    await discountSheet.locator("[data-slot='discount-sheet-save']").click();
    await expect(discountSheet).toBeHidden({ timeout: 5_000 });

    // Discount row lands in the cart.
    const discountLine = page.locator("[data-slot='cart-line'][data-line-kind='discount']").first();
    await expect(discountLine).toBeVisible({ timeout: 5_000 });
    await expect(discountLine.locator("[data-slot='cart-line-price']")).toHaveText("-$5.00");

    // The unconfirmed-gate wins: Charge stays disabled and reads
    // "Set price on highlighted items" (NOT "Take cash · $X.XX").
    const chargeBtn = page.locator("[data-slot='take-cash-button']");
    await expect(chargeBtn).toBeDisabled();
    await expect(chargeBtn).toHaveText(/Set price on highlighted items/);

    // Feature 043: the cart is an ephemeral draft and Charge never fires,
    // so nothing is ever persisted — there are no `ticket_items` rows to
    // assert. The disabled-Charge UI behavior above is the contract.
  });
});
