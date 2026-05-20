// E2E for the Transactions page (feature 045-transactions-page), User Story 1:
// browsing the full transaction history by period.
//
// Runs in the parallel `main` Playwright project. The page aggregates over the
// shared `tickets` table, which other workers' checkout specs also write — so
// this spec NEVER asserts a global aggregate count (research R8). Instead it
// self-seeds a small set of historical paid tickets with its own UUID prefix
// (`60000000-…`) in `beforeAll`, asserts on those exact `data-tx-id`s and the
// page structure around them, and deletes them in `afterAll`.
//
// Seeding strategy (mirrors `dashboard.spec.ts` / `_la-time.ts`):
//   - Two tickets today (salon-local), so the default `week` window AND the
//     `today` window both contain seeded rows.
//   - One ticket last week (last Tuesday 14:00 LA), so stepping the ‹ arrow
//     from "this week" lands on a window that contains a seeded row.
//
// US2 (receipt drawer) and US3 (search / filters) scenarios are appended to
// this file in later phases.

import { expect, test } from "./_fixtures";
import { createClient } from "@supabase/supabase-js";

import { laParts, shiftDays, utcFromLaWall } from "./_la-time";
import { formatTxId } from "@/lib/transactions/format";

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";

// Distinct UUID prefix `60000000-…` so these fixtures never collide with the
// canonical seed (`30000000-…`) or dashboard.spec's US3 set (`50000000-…`).
const TX_TODAY_A = "60000000-0000-0000-0000-000000000001";
const TX_TODAY_B = "60000000-0000-0000-0000-000000000002";
const TX_LAST_WEEK = "60000000-0000-0000-0000-000000000003";
const SEEDED_IDS = [TX_TODAY_A, TX_TODAY_B, TX_LAST_WEEK] as const;

// Display ids the table renders (`#` + last 6 uppercase hex of the UUID).
const DISPLAY_ID_TODAY_A = formatTxId(TX_TODAY_A);
const DISPLAY_ID_LAST_WEEK = formatTxId(TX_LAST_WEEK);

// Stable seed staff ids (supabase/seed.sql § staff block).
const OWNER = "10000000-0000-0000-0000-000000000001";
const JORDAN = "10000000-0000-0000-0000-000000000002";
// Stable seed service ids (supabase/seed.sql § services block).
const SVC_CLASSIC_MANI = "20000000-0000-0000-0000-000000000001";
const SVC_GEL_POLISH = "20000000-0000-0000-0000-000000000002";

// Line-item names for the fixture's service rows. The `txfx-` tag makes each
// name globally unique: the `/transactions` window also holds the canonical
// seed's tickets (and parallel `main`-project specs'), so a plain shared name
// like "Gel polish" — which the seed itself uses — would let foreign rows into
// a search-filtered KPI / count assertion. Unique names keep a search-by-
// service-name test isolated to this spec's own rows (research R8 — never
// assert a global aggregate count).
const ITEM_NAME_A = "Classic manicure (txfx-A)";
const ITEM_NAME_B = "Gel polish (txfx-B)";
const ITEM_NAME_C = "Classic manicure (txfx-C)";

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

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Today, safely in the past: noon LA, or now-30min when the wall clock is
// already past noon — guaranteed inside today's salon window and `<= now()`.
function todayInstant(): Date {
  const now = new Date();
  const t = laParts(now);
  const noon = utcFromLaWall(t.year, t.month, t.day, 12);
  return noon.getTime() <= now.getTime() ? noon : new Date(now.getTime() - 30 * 60_000);
}

// Last Tuesday 14:00 LA — always strictly before this week's Monday, so it is
// outside the current `week` window and inside the previous one.
function lastWeekInstant(): Date {
  const t = laParts(new Date());
  const lastTueOffset = t.weekday + 6; // weekday: Mon=0…Sun=6
  const lastTue = shiftDays(t.year, t.month, t.day, -lastTueOffset);
  return utcFromLaWall(lastTue.year, lastTue.month, lastTue.day, 14);
}

async function insertFixture(): Promise<void> {
  const admin = adminClient();
  const today = todayInstant().toISOString();
  // Stagger the two today rows by a minute so closed_at desc is deterministic.
  const todayEarlier = new Date(new Date(today).getTime() - 60_000).toISOString();
  const lastWeek = lastWeekInstant().toISOString();

  const { error: tkErr } = await admin.from("tickets").upsert(
    [
      {
        id: TX_TODAY_A,
        status: "paid",
        subtotal_cents: 2500,
        tax_cents: 0,
        total_cents: 2500,
        opened_by_staff_id: OWNER,
        closed_by_staff_id: OWNER,
        closed_at: today,
      },
      {
        id: TX_TODAY_B,
        status: "paid",
        subtotal_cents: 3500,
        tax_cents: 0,
        total_cents: 3500,
        opened_by_staff_id: JORDAN,
        closed_by_staff_id: JORDAN,
        closed_at: todayEarlier,
      },
      {
        id: TX_LAST_WEEK,
        status: "paid",
        subtotal_cents: 4000,
        tax_cents: 0,
        total_cents: 4000,
        opened_by_staff_id: OWNER,
        closed_by_staff_id: OWNER,
        closed_at: lastWeek,
      },
    ],
    { onConflict: "id" }
  );
  if (tkErr) throw new Error(`transactions fixture tickets insert failed: ${tkErr.message}`);

  const { error: itErr } = await admin.from("ticket_items").insert([
    {
      ticket_id: TX_TODAY_A,
      kind: "service",
      ref_id: SVC_CLASSIC_MANI,
      name_snapshot: ITEM_NAME_A,
      unit_price_cents: 2500,
      qty: 1,
      assigned_staff_id: OWNER,
      price_unconfirmed: false,
    },
    {
      ticket_id: TX_TODAY_B,
      kind: "service",
      ref_id: SVC_GEL_POLISH,
      name_snapshot: ITEM_NAME_B,
      unit_price_cents: 3500,
      qty: 1,
      assigned_staff_id: JORDAN,
      price_unconfirmed: false,
    },
    {
      ticket_id: TX_LAST_WEEK,
      kind: "service",
      ref_id: SVC_CLASSIC_MANI,
      name_snapshot: ITEM_NAME_C,
      unit_price_cents: 4000,
      qty: 1,
      assigned_staff_id: OWNER,
      price_unconfirmed: false,
    },
  ]);
  if (itErr) throw new Error(`transactions fixture ticket_items insert failed: ${itErr.message}`);

  const { error: pmErr } = await admin.from("payments").insert([
    {
      ticket_id: TX_TODAY_A,
      method: "card",
      kind: "payment",
      amount_cents: 2500,
      tip_cents: 500,
      status: "succeeded",
      taken_by_staff_id: OWNER,
      processed_at: today,
    },
    {
      ticket_id: TX_TODAY_B,
      method: "cash",
      kind: "payment",
      amount_cents: 3500,
      tip_cents: 700,
      status: "succeeded",
      taken_by_staff_id: JORDAN,
      processed_at: todayEarlier,
    },
    {
      ticket_id: TX_LAST_WEEK,
      method: "card",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 800,
      status: "succeeded",
      taken_by_staff_id: OWNER,
      processed_at: lastWeek,
    },
  ]);
  if (pmErr) throw new Error(`transactions fixture payments insert failed: ${pmErr.message}`);
}

async function clearFixture(): Promise<void> {
  const admin = adminClient();
  await admin
    .from("ticket_items")
    .delete()
    .in("ticket_id", SEEDED_IDS as unknown as string[]);
  await admin
    .from("payments")
    .delete()
    .in("ticket_id", SEEDED_IDS as unknown as string[]);
  await admin
    .from("tickets")
    .delete()
    .in("id", SEEDED_IDS as unknown as string[]);
}

let supabaseUp = false;

test.beforeAll(async () => {
  supabaseUp = await supabaseIsReachable();
  if (!supabaseUp) {
    test.skip(
      true,
      "Supabase not reachable at 127.0.0.1:54321 — skipping transactions specs (Docker unavailable)."
    );
  }
  await clearFixture();
  await insertFixture();
});

test.afterAll(async () => {
  if (!supabaseUp) return;
  await clearFixture();
});

// ─── US1: browse the full transaction history by period ──────────────────────

test.describe("US1: browse the transaction history by period", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("(a) owner sees the Transactions nav item and it routes to /transactions", async ({
      page,
    }) => {
      await page.goto("/dashboard");

      const navItem = page.locator('[data-nav-id="transactions"]');
      await expect(navItem).toBeVisible();

      await navItem.click();
      await page.waitForURL(/\/transactions(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/transactions");
      await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
    });

    test("(b) the page lists seeded rows grouped by day with a KPI strip", async ({ page }) => {
      // Default period is `week`, which contains the two today rows.
      await page.goto("/transactions");

      await expect(page.locator('[data-slot="transactions-kpi-strip"]')).toBeVisible();
      // All five KPI cards render.
      for (const slot of [
        "kpi-transactions",
        "kpi-gross-revenue",
        "kpi-services-rendered",
        "kpi-tips-collected",
        "kpi-avg-ticket",
      ]) {
        await expect(page.locator(`[data-slot="${slot}"]`)).toBeVisible();
      }

      // Both today rows render with their seeded UUIDs and display ids.
      const rowA = page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`);
      const rowB = page.locator(`tr[data-tx-id="${TX_TODAY_B}"]`);
      await expect(rowA).toBeVisible();
      await expect(rowB).toBeVisible();
      await expect(rowA.locator(".id")).toHaveText(DISPLAY_ID_TODAY_A);

      // The seeded rows sit inside a day group whose header carries today's
      // relative label.
      const todayGroup = page.locator(".tp-day-group", { has: rowA });
      await expect(todayGroup.locator(".tp-day-h .rel")).toHaveText("Today");

      // The last-week row is NOT in the default `week` window.
      await expect(page.locator(`tr[data-tx-id="${TX_LAST_WEEK}"]`)).toHaveCount(0);
    });

    test("(c) the period toggle and ‹ › stepping change the window", async ({ page }) => {
      await page.goto("/transactions");

      // Switch to Today — still shows the two today rows, range label updates.
      await page.locator('[data-period="today"]').click();
      await page.waitForURL(/period=today/);
      await expect(page.locator('[data-slot="period-label"]')).toContainText("Today");
      await expect(page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`)).toBeVisible();

      // Back to This week, then step ‹ to last week — the last-week row
      // appears and the two today rows drop out of the window.
      await page.locator('[data-period="week"]').click();
      await page.waitForURL(/period=week/);
      await page.locator('[data-slot="period-prev"]').click();
      await page.waitForURL(/offset=-1/);
      await expect(page.locator('[data-slot="period-label"]')).toContainText("Last week");
      const lastWeekRow = page.locator(`tr[data-tx-id="${TX_LAST_WEEK}"]`);
      await expect(lastWeekRow).toBeVisible();
      await expect(lastWeekRow.locator(".id")).toHaveText(DISPLAY_ID_LAST_WEEK);
      await expect(page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`)).toHaveCount(0);

      // The "next" arrow steps forward to the current week again.
      await page.locator('[data-slot="period-next"]').click();
      await page.waitForURL(/\/transactions(\?period=week)?$/);
      await expect(page.locator('[data-slot="period-label"]')).toContainText("This week");
      await expect(page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`)).toBeVisible();
    });

    test("(d) the dashboard 'View all' control navigates to /transactions", async ({ page }) => {
      await page.goto("/dashboard");

      const viewAll = page
        .locator('[data-slot="recent-transactions-feed"]')
        .getByRole("link", { name: "View all" });
      await expect(viewAll).toBeVisible();
      await viewAll.click();
      await page.waitForURL(/\/transactions(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/transactions");
    });
  });

  test.describe("as technician", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.tech);
      },
    });

    test("(e) technician has no nav item and /transactions redirects to /dashboard", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      // The role-gated nav item is absent from the DOM for a technician.
      await expect(page.locator('[data-nav-id="transactions"]')).toHaveCount(0);

      // The route itself is the security boundary — a direct visit silently
      // redirects to /dashboard.
      await page.goto("/transactions");
      await page.waitForURL(/\/dashboard(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/dashboard");
    });
  });
});

// ─── US2: open a transaction's full receipt in a drawer ──────────────────────
//
// Exercises the receipt drawer (FR-014 / FR-015): clicking a seeded row opens
// the drawer, the drawer renders that ticket's line items / totals / payment /
// cashier / activity, and all three dismissal paths (✕, backdrop, Escape)
// close it. Asserts on `TX_TODAY_A` — Classic manicure, $25 subtotal, $5 tip,
// $30 total, card, closed by the seed Owner — which is in the default `week`
// window.

test.describe("US2: open the receipt drawer for a transaction", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test("(f) clicking a row opens the receipt drawer with that ticket's detail", async ({
    page,
  }) => {
    await page.goto("/transactions");

    const row = page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`);
    await expect(row).toBeVisible();

    // No drawer until a row is clicked.
    await expect(page.locator('[data-slot="receipt-drawer"]')).toHaveCount(0);

    await row.click();

    // The drawer opens, scoped to the clicked ticket, and the row is selected.
    const drawer = page.locator(`[data-slot="receipt-drawer"][data-tx-id="${TX_TODAY_A}"]`);
    await expect(drawer).toBeVisible();
    await expect(row).toHaveClass(/selected/);

    // Header — client and display id.
    await expect(drawer.locator(".tp-drawer-h .ttl")).toHaveText("Walk-in");
    await expect(drawer.locator(".tp-drawer-h .sub")).toContainText(DISPLAY_ID_TODAY_A);

    // Line items — the seeded "Classic manicure" service line.
    await expect(drawer.locator('[data-slot="receipt-item"]')).toHaveCount(1);
    await expect(drawer.locator('[data-slot="receipt-item"] .nm')).toHaveText(ITEM_NAME_A);

    // Subtotal / tip / total — $25 / $5 / $30. `formatCurrency` is the shared
    // app helper (Intl, maximumFractionDigits: 0): whole-dollar amounts render
    // with no trailing `.00` (app-wide convention, FR-018).
    await expect(drawer.locator('[data-slot="receipt-subtotal"]')).toHaveText("$25");
    await expect(drawer.locator('[data-slot="receipt-tip"]')).toHaveText("$5");
    await expect(drawer.locator('[data-slot="receipt-total"]')).toHaveText("$30");

    // Payment block — card, $30 incl. tip.
    await expect(drawer.locator('[data-slot="receipt-payment-method"]')).toHaveText("Card");
    await expect(drawer.locator('[data-slot="receipt-payment-amount"]')).toHaveText("$30");

    // Cashier — the seed Owner closed the sale.
    const cashier = await drawer.locator('[data-slot="receipt-cashier"]').textContent();
    expect(cashier?.trim().length).toBeGreaterThan(0);

    // Activity — a "Sale completed by …" line naming the cashier.
    await expect(drawer.locator('[data-slot="receipt-activity"]')).toContainText(
      "Sale completed by"
    );
    await expect(drawer.locator('[data-slot="receipt-activity"]')).toContainText(cashier!.trim());
  });

  test("(g) the drawer closes via the ✕ control", async ({ page }) => {
    await page.goto("/transactions");
    await page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`).click();

    const drawer = page.locator('[data-slot="receipt-drawer"]');
    await expect(drawer).toBeVisible();

    await page.locator('[data-slot="receipt-drawer-close"]').click();
    await expect(drawer).toHaveCount(0);
    // The row's selected styling is cleared with the drawer.
    await expect(page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`)).not.toHaveClass(/selected/);
  });

  test("(h) the drawer closes via a backdrop click", async ({ page }) => {
    await page.goto("/transactions");
    await page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`).click();

    const drawer = page.locator('[data-slot="receipt-drawer"]');
    await expect(drawer).toBeVisible();

    await page.locator('[data-slot="receipt-drawer-backdrop"]').click();
    await expect(drawer).toHaveCount(0);
  });

  test("(i) the drawer closes via the Escape key", async ({ page }) => {
    await page.goto("/transactions");
    await page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`).click();

    const drawer = page.locator('[data-slot="receipt-drawer"]');
    await expect(drawer).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });
});

// ─── US3: narrow the list with search and filters ────────────────────────────
//
// Exercises in-memory search / method / tech filtering (FR-010 … FR-012,
// FR-017). All three filter dimensions and the "Clear filters" reset run
// client-side over the already-loaded period — no URL or network round-trip
// (contract C4). Asserts on the two seeded today rows, both in the default
// `week` window: TX_TODAY_A — Classic manicure, card, closed by the seed
// Owner — and TX_TODAY_B — Gel polish, cash, closed by the seed Jordan. The
// existing beforeAll seed already gives the method / tech / service-name
// variety US3 needs, so the seed is not extended.

test.describe("US3: narrow the list with search and filters", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test("(j) search by service name narrows the list and the KPI strip", async ({ page }) => {
    await page.goto("/transactions");

    const rowA = page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`);
    const rowB = page.locator(`tr[data-tx-id="${TX_TODAY_B}"]`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    // Search by the fixture's unique service name — only TX_TODAY_B survives.
    // The `txfx-` tag isolates this from the canonical seed's own "Gel polish"
    // tickets, so the filtered KPI strip below summarises this spec's own rows
    // only, not a global aggregate over the shared window (research R8).
    const search = page.locator('[data-slot="transactions-search"]');
    await search.fill(ITEM_NAME_B);
    await expect(rowB).toBeVisible();
    await expect(rowA).toHaveCount(0);

    // The KPI strip recalculates for the single-row subset: $42 gross
    // ($35 subtotal + $7 tip) and a count of 1. `formatCurrency` renders
    // whole-dollar amounts with no trailing `.00` (app-wide convention).
    await expect(page.locator('[data-slot="kpi-transactions"] .val')).toHaveText("1");
    await expect(page.locator('[data-slot="kpi-gross-revenue"] .val')).toHaveText("$42");

    // Clearing the search restores both seeded rows.
    await search.fill("");
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
  });

  test("(k) search by transaction id narrows to the matching row", async ({ page }) => {
    await page.goto("/transactions");

    const rowA = page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`);
    await expect(rowA).toBeVisible();

    // The display id is `#` + last 6 uppercase hex — search is case-insensitive.
    const idFragment = DISPLAY_ID_TODAY_A.replace("#", "").toLowerCase();
    await page.locator('[data-slot="transactions-search"]').fill(idFragment);

    await expect(rowA).toBeVisible();
    await expect(page.locator(`tr[data-tx-id="${TX_TODAY_B}"]`)).toHaveCount(0);
  });

  test("(l) a method chip filters the list and shows a live count", async ({ page }) => {
    await page.goto("/transactions");

    const rowA = page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`);
    const rowB = page.locator(`tr[data-tx-id="${TX_TODAY_B}"]`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    // The Cash chip filters to TX_TODAY_B (the only seeded cash row).
    const cashChip = page.locator('[data-slot="method-chip"][data-method="cash"]');
    await cashChip.click();
    await expect(cashChip).toHaveAttribute("aria-pressed", "true");
    await expect(rowB).toBeVisible();
    await expect(rowA).toHaveCount(0);

    // The Card chip filters the other way — TX_TODAY_A only.
    await page.locator('[data-slot="method-chip"][data-method="card"]').click();
    await expect(rowA).toBeVisible();
    await expect(rowB).toHaveCount(0);

    // Each method chip carries a live per-method count. Narrow with a search
    // for the fixture's unique service name — it matches only the cash row, and
    // its `txfx-` tag isolates it from the seed's own "Gel polish" tickets — so
    // the recomposed counts cover this spec's rows only (research R8): the cash
    // chip reads 1 and the card chip reads 0 under that search.
    await page.locator('[data-slot="method-chip"][data-method="all"]').click();
    await page.locator('[data-slot="transactions-search"]').fill(ITEM_NAME_B);
    await expect(cashChip.locator('[data-slot="method-chip-count"]')).toHaveText("1");
    await expect(
      page
        .locator('[data-slot="method-chip"][data-method="card"]')
        .locator('[data-slot="method-chip-count"]')
    ).toHaveText("0");
  });

  test("(m) the tech multi-select filters and renders removable pills", async ({ page }) => {
    await page.goto("/transactions");

    const rowA = page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`);
    const rowB = page.locator(`tr[data-tx-id="${TX_TODAY_B}"]`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    // Open the tech popover and select the seed Owner (TX_TODAY_A's tech).
    await page.locator('[data-slot="tech-filter-trigger"]').click();
    await page.locator(`[data-slot="tech-filter-row"][data-staff-id="${OWNER}"]`).click();
    // Dismiss the popover so the table is unobstructed.
    await page.keyboard.press("Escape");

    // Only the Owner's transaction remains; the Jordan row drops out.
    await expect(rowA).toBeVisible();
    await expect(rowB).toHaveCount(0);

    // The selected tech shows as a removable active-filter pill.
    const pill = page.locator('[data-slot="active-tech-pill"]');
    await expect(pill).toHaveCount(1);

    // Removing the pill clears the tech filter — both rows return.
    await pill.getByRole("button").click();
    await expect(page.locator('[data-slot="active-tech-pill"]')).toHaveCount(0);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
  });

  test("(n) Clear filters restores the full period", async ({ page }) => {
    await page.goto("/transactions");

    const rowA = page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`);
    const rowB = page.locator(`tr[data-tx-id="${TX_TODAY_B}"]`);

    // Apply a method filter — only one row remains, "Clear filters" appears.
    await page.locator('[data-slot="method-chip"][data-method="card"]').click();
    await expect(rowA).toBeVisible();
    await expect(rowB).toHaveCount(0);

    const clear = page.locator('[data-slot="clear-filters"]');
    await expect(clear).toBeVisible();
    await clear.click();

    // The full period returns and "Clear filters" is gone (no active filter).
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    await expect(page.locator('[data-slot="clear-filters"]')).toHaveCount(0);
  });

  test("(o) a no-match filter shows the filtered-empty state with a working reset", async ({
    page,
  }) => {
    await page.goto("/transactions");

    await expect(page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`)).toBeVisible();

    // A search no seeded row matches yields the filtered-empty state — which
    // is distinct from the genuinely-empty period state.
    await page.locator('[data-slot="transactions-search"]').fill("zzz-no-such-transaction");
    const empty = page.locator('[data-slot="transactions-empty"]');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("data-empty-kind", "filtered");

    // The filtered-empty state's "Clear filters" action resets the filters.
    await page.locator('[data-slot="filtered-empty-clear"]').click();
    await expect(page.locator(`tr[data-tx-id="${TX_TODAY_A}"]`)).toBeVisible();
    await expect(page.locator('[data-slot="transactions-empty"]')).toHaveCount(0);
  });
});
