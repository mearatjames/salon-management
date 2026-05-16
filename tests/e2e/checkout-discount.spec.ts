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
// DB assertions: `ticket_items` rows for kind='discount' with the right
// discount_pct + note; `audit_log` rows scoped via newAuditCursor() +
// getAuditLogRowsSince() so the parallel-worker run does not race on the
// shared audit_log table.

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

// Seeded ids (see supabase/seed.sql).
const CLASSIC_MANI_SERVICE_ID = "20000000-0000-0000-0000-000000000001"; // $25 fixed
const GEL_POLISH_SERVICE_ID = "20000000-0000-0000-0000-000000000002"; // assigned to Sam only
const NAIL_ART_SERVICE_ID = "20000000-0000-0000-0000-000000000005"; // variable

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

/**
 * Wait for the (optimistically inserted) cart line to flip its data-line-id
 * from a temp id (`tmp-…`) to a real UUID — operations against the line
 * (set tech, remove, set price, remove discount) require a server-confirmed id.
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

  test("(a, b, e, g, h, i) flat discount with note → row + recompute + status='open' invariant + remove restores total", async ({
    page,
  }) => {
    const admin = adminClient();
    const cursor = newAuditCursor();

    await signInAsMaya(page, "/dashboard");
    const ticketId = await openFreshTicket(page, "Jordan Lee");

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

    // [FR-019 invariant — pre]: ticket is still open before any discount op.
    const { data: tkPre } = await admin
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(tkPre!.status).toBe("open");

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

    // [FR-019 invariant — post addDiscountLine]: ticket still open.
    const { data: tkMid } = await admin
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(tkMid!.status).toBe("open");

    // DB: discount row exists with the expected shape/note.
    const { data: items, error: itErr } = await admin
      .from("ticket_items")
      .select(
        "id, kind, unit_price_cents, discount_pct, note, name_snapshot, ref_id, assigned_staff_id"
      )
      .eq("ticket_id", ticketId);
    expect(itErr).toBeNull();
    const dbDiscount = items!.find((i) => i.kind === "discount");
    expect(dbDiscount).toMatchObject({
      kind: "discount",
      unit_price_cents: -500,
      discount_pct: null,
      note: "Loyalty perk",
      name_snapshot: "Discount",
      ref_id: null,
      assigned_staff_id: null,
    });

    // Audit row for discount.added. Filter to this ticket so parallel
    // workers running other US3 tests don't pollute the assertion.
    const addedRows = (await getAuditLogRowsSince(cursor, "discount.added")).filter(
      (r) => (r.payload as { ticket_id?: string } | null)?.ticket_id === ticketId
    );
    expect(addedRows.length).toBe(1);
    const addAudit = addedRows[0];
    expect(addAudit.entity_id).toBe(dbDiscount!.id);
    expect(addAudit.payload).toMatchObject({
      ticket_id: ticketId,
      shape: "flat",
      value: 500,
      note: "Loyalty perk",
    });

    // (e) Wait for the discount row id to settle (post-server) then remove it.
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

    // [FR-019 invariant — post removeDiscountLine]: ticket still open.
    const { data: tkPost } = await admin
      .from("tickets")
      .select("status")
      .eq("id", ticketId)
      .single();
    expect(tkPost!.status).toBe("open");

    // Audit row for discount.removed. The remove uses optimistic UI
    // (`startTransition` non-blocking), so poll the audit_log until the
    // server-side `recordAudit` call lands. Filter to this ticket so
    // parallel workers don't pollute the assertion.
    await expect
      .poll(
        async () =>
          (await getAuditLogRowsSince(cursor, "discount.removed")).filter(
            (r) => (r.payload as { ticket_id?: string } | null)?.ticket_id === ticketId
          ).length,
        { timeout: 5_000 }
      )
      .toBe(1);
    const removedRows = (await getAuditLogRowsSince(cursor, "discount.removed")).filter(
      (r) => (r.payload as { ticket_id?: string } | null)?.ticket_id === ticketId
    );
    const removeAudit = removedRows[0];
    expect(removeAudit.payload).toMatchObject({
      ticket_id: ticketId,
      shape: "flat",
      value: 500,
      note: "Loyalty perk",
    });

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

    await discardTicket(admin, ticketId);
  });

  test("(c, d) percent discount recomputes against live service subtotal as services change", async ({
    page,
  }) => {
    const admin = adminClient();

    await signInAsMaya(page, "/dashboard");
    // Sam is the only tech with both Classic manicure AND Gel polish access.
    const ticketId = await openFreshTicket(page, "Sam Chen");

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

    // DB: discount row carries discount_pct=15 and a recomputed amount.
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

    await discardTicket(admin, ticketId);
  });

  test("(f) over-discount floors total to $0 and disables Charge", async ({ page }) => {
    const admin = adminClient();

    await signInAsMaya(page, "/dashboard");
    const ticketId = await openFreshTicket(page, "Jordan Lee");

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

    await discardTicket(admin, ticketId);
  });

  test("(j) discount + unconfirmed line → discount applies, Charge stays disabled with 'Set price' hint", async ({
    page,
  }) => {
    const admin = adminClient();

    await signInAsMaya(page, "/dashboard");
    const ticketId = await openFreshTicket(page, "Jordan Lee");

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

    // DB: discount row is present with the expected shape.
    const { data: items } = await admin
      .from("ticket_items")
      .select("kind, unit_price_cents, discount_pct, note")
      .eq("ticket_id", ticketId);
    const dbDiscount = items!.find((i) => i.kind === "discount");
    expect(dbDiscount).toMatchObject({
      kind: "discount",
      unit_price_cents: -500,
      discount_pct: null,
    });

    await discardTicket(admin, ticketId);
  });
});
