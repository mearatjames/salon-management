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
//       - the disabled item cannot fire onSetTech → the persisted line
//         keeps its original assignment
//
// Feature 043-checkout-ephemeral-draft: the in-progress cart is now an
// ephemeral in-memory draft. Entry is the paramless `/checkout`; tech
// overrides mutate local React state only — NO `ticket_items` rows and no
// per-edit `ticket.line_tech_assigned` audit rows exist until payment.
// Both tests take cash at the end and assert the PERSISTED
// `ticket_items.assigned_staff_id` (matched by `ref_id` since the RPC
// assigns fresh row ids). Audit reads use the per-test cursor pattern
// from `tests/e2e/_db.ts`.
//
// Docker / Supabase availability: standard probe — skip when the local
// Supabase is unreachable.

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

// Seeded staff ids (see supabase/seed.sql / tests/e2e/_db.ts).
const JORDAN_STAFF_ID = "10000000-0000-0000-0000-000000000002"; // header pick (A)
const SAM_STAFF_ID = "10000000-0000-0000-0000-000000000003"; // per-line override (B)

const CLASSIC_MANICURE_ID = "20000000-0000-0000-0000-000000000001";
const CLASSIC_PEDICURE_ID = "20000000-0000-0000-0000-000000000003";

// Take cash and return the persisted ticket id (the URL becomes
// `/checkout/[ticketId]` only after the ephemeral draft is persisted +
// charged).
async function takeCashAndGetTicketId(page: import("@playwright/test").Page): Promise<string> {
  await page.locator("[data-slot='payment-tile'][data-method='cash']").click();
  await page.locator("[data-slot='take-cash-button']").click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
  await expect(page.locator("[data-slot='done-screen']")).toBeVisible({ timeout: 10_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
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

  // No global beforeEach reset: each test opens a fresh ephemeral draft
  // cart via the dashboard CTA, so we don't need a clean slate. A cross-
  // spec reset would race against other checkout specs that also operate
  // as Maya under CI's 2-worker setup.

  test("(1) override one line; header pick + subsequent lines unchanged", async ({ page }) => {
    const admin = adminClient();
    const cursor = newAuditCursor();

    await page.goto("/dashboard");

    // Start a fresh ephemeral draft cart via the dashboard CTA — entry is
    // the paramless `/checkout`, no DB ticket yet.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

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

    // Open that line's chip popover (the chip is the PopoverTrigger).
    await firstLine.locator("[data-slot='cart-line-tech-chip']").click();
    const popover = page.locator("[data-slot='popover-content']");
    await expect(popover).toBeVisible();

    // Pick Sam Chen (B) from the popover.
    await popover
      .locator(`[data-slot='tech-popover-item'][data-staff-id='${SAM_STAFF_ID}']`)
      .click();

    // Popover closes; chip text/dot reflects Sam. The override is a
    // local-state mutation only in the ephemeral draft.
    await expect(popover).toBeHidden();
    await expect(firstLine.locator("[data-slot='cart-line-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      SAM_STAFF_ID
    );
    await expect(firstLine.locator("[data-slot='cart-line-tech-chip']")).toContainText("Sam Chen");

    // Header chip still shows Jordan — the per-line override did not move
    // the header default.
    await expect(page.locator("[data-slot='checkout-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      JORDAN_STAFF_ID
    );

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

    // Feature 043: take cash — the ephemeral cart is persisted atomically.
    // Only NOW do `ticket_items` rows exist; match them by `ref_id` since
    // the RPC assigns fresh row ids.
    const ticketId = await takeCashAndGetTicketId(page);

    const { data: items, error: itErr } = await admin
      .from("ticket_items")
      .select("ref_id, assigned_staff_id, kind")
      .eq("ticket_id", ticketId);
    expect(itErr).toBeNull();
    const maniRow = items!.find((i) => i.ref_id === CLASSIC_MANICURE_ID);
    const pedicureRow = items!.find((i) => i.ref_id === CLASSIC_PEDICURE_ID);
    // The manicure line carries the per-line override (Sam).
    expect(maniRow?.assigned_staff_id).toBe(SAM_STAFF_ID);
    // The pedicure line carries the header default (Jordan).
    expect(pedicureRow?.assigned_staff_id).toBe(JORDAN_STAFF_ID);

    // Audit: the draft persistence emits a single `ticket.created` row (no
    // per-edit `ticket.line_tech_assigned` rows in the ephemeral model).
    const createdRows = await getAuditLogRowsSince(cursor, "ticket.created");
    expect(createdRows.some((r) => r.entity_id === ticketId)).toBe(true);
  });

  test("(2) no-op tap on currently assigned tech is harmless", async ({ page }) => {
    const admin = adminClient();

    await page.goto("/dashboard");

    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // Header pick: Jordan.
    await page
      .locator(`[data-slot='checkout-tech-row'] [data-staff-id='${JORDAN_STAFF_ID}']`)
      .click();
    await page
      .locator(`[data-slot='service-tile'][data-service-id='${CLASSIC_MANICURE_ID}']`)
      .click();
    const line = page.locator("[data-slot='cart-line']").first();
    await expect(line).toBeVisible();

    // Open the popover — the currently assigned (Jordan) item is marked
    // as the current pick (aria-disabled / visually disabled). Tapping it
    // must not close the popover via a write and must not change the
    // line's assignment.
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

    // Dismiss the popover by pressing Escape.
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();

    // The line chip still shows Jordan — the no-op tap changed nothing.
    await expect(line.locator("[data-slot='cart-line-tech-chip']")).toHaveAttribute(
      "data-staff-id",
      JORDAN_STAFF_ID
    );

    // Feature 043: take cash — the persisted line carries the unchanged
    // assignment (the disabled no-op tap never mutated the draft).
    const ticketId = await takeCashAndGetTicketId(page);
    const { data } = await admin
      .from("ticket_items")
      .select("assigned_staff_id")
      .eq("ticket_id", ticketId)
      .single();
    expect(data?.assigned_staff_id).toBe(JORDAN_STAFF_ID);
  });
});
