// E2E for the Report page (feature 046-report-page), User Story 1: the
// current day's all-staff earnings + deductions overview.
//
// Runs in the parallel `main` Playwright project. The page aggregates over the
// shared `tickets` table, which other workers' checkout / transactions specs
// also write — so this spec NEVER asserts a global aggregate count
// (research R17). It self-seeds its own technicians, services, and paid
// tickets with a distinct UUID prefix (`70000000-…`), asserts on those exact
// `data-tech-id`s and on internal reconciliation (the totals row equals the
// sum of the rendered rows), and deletes everything in `afterAll`.
//
// US1 hardcodes the reporting window to the current day, so the fixture's
// paid tickets are `closed_at` at a fixed past instant **earlier today** in
// the salon timezone (noon LA, or now-30min when already past noon — the same
// trick `transactions.spec.ts` uses to stay inside today's window and
// `<= now()`).
//
// US2 (per-tech drill-down), US3 (deduction breakdown), US4 (period control),
// and US5 (print / export) scenarios are appended to this file in later
// phases.

import { expect, test } from "./_fixtures";
import { createClient } from "@supabase/supabase-js";

import { laParts, utcFromLaWall } from "./_la-time";

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";

// ─── Fixture identity — `70000000-…` prefix, distinct from every other spec ──

const TECH_A = "70000000-0000-0000-0000-0000000000a1"; // non-exempt
const TECH_B = "70000000-0000-0000-0000-0000000000b2"; // fully exempt
const SVC_PLAIN = "70000000-0000-0000-0000-0000000000c1"; // card_fee_mode='default'
const SVC_SUPPLY = "70000000-0000-0000-0000-0000000000c2"; // + supply_amount_cents
const SUPPLY_TYPE = "70000000-0000-0000-0000-0000000000d1";
const TK_1 = "70000000-0000-0000-0000-0000000000e1"; // TECH_A · supply svc · card
const TK_2 = "70000000-0000-0000-0000-0000000000e2"; // TECH_A · plain svc · cash
const TK_3 = "70000000-0000-0000-0000-0000000000e3"; // TECH_B · supply svc · card
// Deterministic ids for the per-ticket line item + payment so the fixture's
// `upsert` is idempotent — a re-seed after an interrupted prior run can never
// duplicate a line (which would inflate the rendered svc count, issue #92).
const ITEM_1 = "70000000-0000-0000-0000-0000000000f1";
const ITEM_2 = "70000000-0000-0000-0000-0000000000f2";
const ITEM_3 = "70000000-0000-0000-0000-0000000000f3";
const PMT_1 = "70000000-0000-0000-0000-00000000a001";
const PMT_2 = "70000000-0000-0000-0000-00000000a002";
const PMT_3 = "70000000-0000-0000-0000-00000000a003";

const TICKET_IDS = [TK_1, TK_2, TK_3] as const;
const STAFF_IDS = [TECH_A, TECH_B] as const;
const SERVICE_IDS = [SVC_PLAIN, SVC_SUPPLY] as const;

// Display names — the read model orders technicians by `displayName` asc, so
// "Report Ada …" sorts before "Report Bea …". The `[rpt]` tag keeps the names
// globally unique against the seed + parallel specs.
const TECH_A_NAME = "Report Ada Non-Exempt [rpt]";
const TECH_B_NAME = "Report Bea Exempt [rpt]";

// PIN hash for "1234" — same value the seed + worker fixture use. Staff rows
// need a non-null `pin_hash`; the value is never exercised (the fixture never
// signs in as these techs).
const PIN_HASH_1234 = "$2b$11$ocPxZYLxI9q3whaThAf44eqadcklBHovq4KGJcGQ2VjlZkoGD66x.";

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

// A fixed past instant earlier today (salon-local): noon LA, or now-30min when
// the wall clock is already past noon. Guaranteed inside today's day window
// and `<= now()`.
function todayInstant(): Date {
  const now = new Date();
  const t = laParts(now);
  const noon = utcFromLaWall(t.year, t.month, t.day, 12);
  return noon.getTime() <= now.getTime() ? noon : new Date(now.getTime() - 30 * 60_000);
}

async function insertFixture(): Promise<void> {
  const admin = adminClient();
  const closedAt = todayInstant().toISOString();
  // Stagger the two TECH_A tickets so newest-first ordering is deterministic.
  const closedAtEarlier = new Date(new Date(closedAt).getTime() - 60_000).toISOString();

  // 1. Supply type — referenced by SVC_SUPPLY's `supply_type_id` FK.
  const { error: stErr } = await admin
    .from("supply_types")
    .upsert([{ id: SUPPLY_TYPE, name: "Report fixture supply [rpt]" }], { onConflict: "id" });
  if (stErr) throw new Error(`report fixture supply_types insert failed: ${stErr.message}`);

  // 2. Staff — one non-exempt (card fee + supply both apply), one fully exempt
  //    (card_fee_exempt + supply_mode='exempt').
  const { error: staffErr } = await admin.from("staff").upsert(
    [
      {
        id: TECH_A,
        user_id: null,
        display_name: TECH_A_NAME,
        role: "technician",
        pin_hash: PIN_HASH_1234,
        color_token: "--avatar-rose",
        active: true,
        card_fee_exempt: false,
        supply_mode: "apply",
        supply_except: [],
      },
      {
        id: TECH_B,
        user_id: null,
        display_name: TECH_B_NAME,
        role: "technician",
        pin_hash: PIN_HASH_1234,
        color_token: "--avatar-amber",
        active: true,
        card_fee_exempt: true,
        supply_mode: "exempt",
        supply_except: [],
      },
    ],
    { onConflict: "id" }
  );
  if (staffErr) throw new Error(`report fixture staff insert failed: ${staffErr.message}`);

  // 3. Services — one plain (`card_fee_mode='default'`), one carrying a supply
  //    cost (`supply_amount_cents` + `supply_type_id`).
  const { error: svcErr } = await admin.from("services").upsert(
    [
      {
        id: SVC_PLAIN,
        name: "Report plain service [rpt]",
        category: "Manicure",
        duration_min: 30,
        price_cents: 5000,
        color_token: "--avatar-rose",
        card_fee_mode: "default",
      },
      {
        id: SVC_SUPPLY,
        name: "Report supply service [rpt]",
        category: "Pedicure",
        duration_min: 45,
        price_cents: 8000,
        color_token: "--avatar-amber",
        card_fee_mode: "default",
        supply_amount_cents: 500,
        supply_type_id: SUPPLY_TYPE,
      },
    ],
    { onConflict: "id" }
  );
  if (svcErr) throw new Error(`report fixture services insert failed: ${svcErr.message}`);

  // 4. Paid tickets — three, all closed earlier today.
  const { error: tkErr } = await admin.from("tickets").upsert(
    [
      {
        id: TK_1,
        status: "paid",
        subtotal_cents: 8000,
        tax_cents: 0,
        total_cents: 8000,
        opened_by_staff_id: TECH_A,
        closed_by_staff_id: TECH_A,
        closed_at: closedAt,
      },
      {
        id: TK_2,
        status: "paid",
        subtotal_cents: 5000,
        tax_cents: 0,
        total_cents: 5000,
        opened_by_staff_id: TECH_A,
        closed_by_staff_id: TECH_A,
        closed_at: closedAtEarlier,
      },
      {
        id: TK_3,
        status: "paid",
        subtotal_cents: 8000,
        tax_cents: 0,
        total_cents: 8000,
        opened_by_staff_id: TECH_B,
        closed_by_staff_id: TECH_B,
        closed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (tkErr) throw new Error(`report fixture tickets insert failed: ${tkErr.message}`);

  // 5. Service line items — one per ticket, each assigned to its technician.
  //    Deterministic ids + `upsert` so a re-seed after an interrupted prior
  //    run can never duplicate a line (which would inflate the svc count).
  const { error: itErr } = await admin.from("ticket_items").upsert(
    [
      {
        id: ITEM_1,
        ticket_id: TK_1,
        kind: "service",
        ref_id: SVC_SUPPLY,
        name_snapshot: "Report supply service [rpt]",
        unit_price_cents: 8000,
        qty: 1,
        assigned_staff_id: TECH_A,
        price_unconfirmed: false,
      },
      {
        id: ITEM_2,
        ticket_id: TK_2,
        kind: "service",
        ref_id: SVC_PLAIN,
        name_snapshot: "Report plain service [rpt]",
        unit_price_cents: 5000,
        qty: 1,
        assigned_staff_id: TECH_A,
        price_unconfirmed: false,
      },
      {
        id: ITEM_3,
        ticket_id: TK_3,
        kind: "service",
        ref_id: SVC_SUPPLY,
        name_snapshot: "Report supply service [rpt]",
        unit_price_cents: 8000,
        qty: 1,
        assigned_staff_id: TECH_B,
        price_unconfirmed: false,
      },
    ],
    { onConflict: "id" }
  );
  if (itErr) throw new Error(`report fixture ticket_items insert failed: ${itErr.message}`);

  // 6. Succeeded payments — TK_1 + TK_3 by card (with tips), TK_2 by cash.
  //    Deterministic ids + `upsert` for the same idempotence reason as above.
  const { error: pmErr } = await admin.from("payments").upsert(
    [
      {
        id: PMT_1,
        ticket_id: TK_1,
        method: "card",
        kind: "payment",
        amount_cents: 8000,
        tip_cents: 1000,
        status: "succeeded",
        taken_by_staff_id: TECH_A,
        processed_at: closedAt,
      },
      {
        id: PMT_2,
        ticket_id: TK_2,
        method: "cash",
        kind: "payment",
        amount_cents: 5000,
        tip_cents: 0,
        status: "succeeded",
        taken_by_staff_id: TECH_A,
        processed_at: closedAtEarlier,
      },
      {
        id: PMT_3,
        ticket_id: TK_3,
        method: "card",
        kind: "payment",
        amount_cents: 8000,
        tip_cents: 1200,
        status: "succeeded",
        taken_by_staff_id: TECH_B,
        processed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (pmErr) throw new Error(`report fixture payments insert failed: ${pmErr.message}`);
}

async function clearFixture(): Promise<void> {
  const admin = adminClient();
  await admin
    .from("payments")
    .delete()
    .in("ticket_id", TICKET_IDS as unknown as string[]);
  await admin
    .from("ticket_items")
    .delete()
    .in("ticket_id", TICKET_IDS as unknown as string[]);
  await admin
    .from("tickets")
    .delete()
    .in("id", TICKET_IDS as unknown as string[]);
  await admin
    .from("services")
    .delete()
    .in("id", SERVICE_IDS as unknown as string[]);
  await admin
    .from("staff")
    .delete()
    .in("id", STAFF_IDS as unknown as string[]);
  await admin.from("supply_types").delete().eq("id", SUPPLY_TYPE);
}

// ─── Expected reconciliation (cents) — see the fixture comments above ────────
//
//   TECH_A · TK_1 (supply svc, card): gross 8000 · cardFee 300 · supply 500
//   TECH_A · TK_2 (plain svc, cash) : gross 5000 · cardFee 0   · supply 0
//   TECH_B · TK_3 (supply svc, card): gross 8000 · cardFee 0   · supply 0 (exempt)
//
// formatCurrency renders whole-dollar amounts with no trailing `.00`. The
// per-technician rows are this spec's own seeded data, so they are exact and
// concurrency-safe to assert; the totals row is a window-wide aggregate and is
// reconciled against the sum of every rendered row instead (test (c)).
const EXPECT = {
  techA: { gross: "$130", cardFee: "−$3", supply: "−$5", commissionable: "$122", tips: "$10" },
  techB: { gross: "$80", commissionable: "$80", tips: "$12" },
};

let supabaseUp = false;

// Serial mode keeps every test in this file on ONE worker. The fixture's
// `beforeAll` / `afterAll` seed and clear a shared set of fixed-UUID rows;
// under `fullyParallel` Playwright would otherwise split these tests across
// two workers, each running its own `afterAll` — and one worker's teardown
// would delete the fixture while the other worker's test is still asserting
// on it. One worker = one seed, one teardown, no race.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  supabaseUp = await supabaseIsReachable();
  if (!supabaseUp) {
    test.skip(
      true,
      "Supabase not reachable at 127.0.0.1:54321 — skipping report specs (Docker unavailable)."
    );
  }
  await clearFixture();
  await insertFixture();
});

test.afterAll(async () => {
  if (!supabaseUp) return;
  await clearFixture();
});

// Reads the trimmed text of the `idx`-th cell of a `data-tech-id` row.
async function cellText(
  rowLocator: ReturnType<import("@playwright/test").Page["locator"]>,
  idx: number
): Promise<string> {
  const text = await rowLocator.locator("td").nth(idx).innerText();
  return text.trim();
}

// Parses a rendered overview cell into a signed number for reconciliation:
// `"$210"` → 210, `"−$5"` → -5, `"—"` (em-dash, an exempt deduction) → 0,
// `"3"` (a bare count) → 3. Handles both the U+2212 minus sign and ASCII `-`.
function parseCell(text: string): number {
  const t = text.trim();
  if (t === "—") return 0;
  const negative = t.startsWith("−") || t.startsWith("-");
  const digits = t.replace(/[−$,\s-]/g, "");
  if (digits === "") return 0;
  const value = Number(digits);
  return negative ? -value : value;
}

// ─── US1: see all-staff earnings and deductions for the day ──────────────────

test.describe("US1: all-staff report overview", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("(a) owner sees the Report nav item and it routes to /report", async ({ page }) => {
      await page.goto("/dashboard");

      const navItem = page.locator('[data-nav-id="report"]');
      await expect(navItem).toBeVisible();

      await navItem.click();
      await page.waitForURL(/\/report(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/report");
      await expect(page.getByRole("heading", { name: "Report", level: 1 })).toBeVisible();
    });

    test("(b) the overview lists the seeded technicians with the seven columns", async ({
      page,
    }) => {
      await page.goto("/report");

      // Summary strip + legend render.
      await expect(page.locator('[data-slot="report-summary"]')).toBeVisible();
      await expect(page.locator('[data-slot="report-legend"]')).toBeVisible();

      // Both seeded technicians render as overview rows.
      const techARow = page.locator(`tr.dr-staff-row[data-tech-id="${TECH_A}"]`);
      const techBRow = page.locator(`tr.dr-staff-row[data-tech-id="${TECH_B}"]`);
      await expect(techARow).toBeVisible();
      await expect(techBRow).toBeVisible();

      // TECH_A — non-exempt: svcs / gross / card fee / supply / commissionable
      // / card tips. Columns: 0=Tech 1=Svcs 2=Gross 3=Card fee 4=Supply
      // 5=Commissionable 6=Card tips. TECH_A performed 2 services (TK_1 + TK_2).
      expect(await cellText(techARow, 1)).toBe("2");
      expect(await cellText(techARow, 2)).toBe(EXPECT.techA.gross);
      expect(await cellText(techARow, 3)).toBe(EXPECT.techA.cardFee);
      expect(await cellText(techARow, 4)).toBe(EXPECT.techA.supply);
      expect(await cellText(techARow, 5)).toBe(EXPECT.techA.commissionable);
      expect(await cellText(techARow, 6)).toBe(EXPECT.techA.tips);

      // TECH_B — fully exempt: no-deduction indicator, em-dash deduction cells,
      // commissionable equals gross.
      await expect(techBRow.locator('[data-slot="exempt-tag"]')).toBeVisible();
      expect(await cellText(techBRow, 2)).toBe(EXPECT.techB.gross);
      expect(await cellText(techBRow, 3)).toBe("—");
      expect(await cellText(techBRow, 4)).toBe("—");
      expect(await cellText(techBRow, 5)).toBe(EXPECT.techB.commissionable);
      expect(await cellText(techBRow, 6)).toBe(EXPECT.techB.tips);
    });

    test("(c) the totals row reconciles against every rendered technician row", async ({
      page,
    }) => {
      await page.goto("/report");

      // The overview table aggregates over the shared current-day window, so
      // other parallel `main`-project specs' (and the canonical seed's) paid
      // tickets also render. Reconciliation must therefore sum EVERY rendered
      // technician row, not just this spec's seeded pair — that internal check
      // (totals row vs Σ rendered rows) is correct under concurrency
      // (research R17 — never assert a global aggregate count).
      const totals = page.locator('[data-slot="totals-row"]');
      await expect(totals).toBeVisible();
      // The seeded rows are present, so there is at least one row to sum.
      await expect(page.locator(`tr.dr-staff-row[data-tech-id="${TECH_A}"]`)).toBeVisible();

      // Columns 1=Svcs 2=Gross 3=Card fee 4=Supply 5=Commissionable 6=Card tips.
      const COLS = [1, 2, 3, 4, 5, 6] as const;
      const rows = page.locator("tr.dr-staff-row");
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);

      const summed = [0, 0, 0, 0, 0, 0];
      for (let r = 0; r < rowCount; r += 1) {
        const row = rows.nth(r);
        for (let c = 0; c < COLS.length; c += 1) {
          summed[c] += parseCell(await cellText(row, COLS[c]));
        }
      }

      // The services count (column 1) is an integer with no display rounding —
      // the totals row equals the row sum exactly.
      expect(parseCell(await cellText(totals, 1))).toBe(summed[0]);

      // The money columns render whole dollars (`maximumFractionDigits: 0`):
      // the page rounds each technician's cents independently AND rounds the
      // window-wide cents sum independently, so `Σ round(rowᵢ)` can drift from
      // `round(Σ rowᵢ)` by up to half a dollar per rounded value. Reconcile
      // within that bound — a real check (it catches a doubled or dropped
      // column) that still tolerates the inherent whole-dollar rounding drift.
      const tolerance = Math.ceil(rowCount / 2) + 1;
      for (let c = 1; c < COLS.length; c += 1) {
        const totalValue = parseCell(await cellText(totals, COLS[c]));
        expect(Math.abs(totalValue - summed[c])).toBeLessThanOrEqual(tolerance);
      }
    });

    test("(d) the left staff list carries a card for each seeded technician", async ({ page }) => {
      await page.goto("/report");

      await expect(page.locator('[data-slot="all-staff"]')).toBeVisible();
      await expect(page.locator(`.dr-tech-card[data-tech-id="${TECH_A}"]`)).toBeVisible();
      const techBCard = page.locator(`.dr-tech-card[data-tech-id="${TECH_B}"]`);
      await expect(techBCard).toBeVisible();
      // The exempt technician's card shows the "Exempt" tag.
      await expect(techBCard.locator('[data-slot="exempt-tag"]')).toBeVisible();
    });
  });

  test.describe("as technician", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.tech);
      },
    });

    test("(e) technician has no nav item and /report redirects to /dashboard", async ({ page }) => {
      await page.goto("/dashboard");
      // The role-gated nav item is absent from the DOM for a technician.
      await expect(page.locator('[data-nav-id="report"]')).toHaveCount(0);

      // The route itself is the security boundary — a direct visit silently
      // redirects to /dashboard.
      await page.goto("/report");
      await page.waitForURL(/\/dashboard(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/dashboard");
    });
  });
});

// ─── US2: drill into one technician's transaction-by-transaction detail ──────
//
// Selecting a technician from the left list swaps the right panel from the
// All-Staff overview to that technician's per-transaction table. Each row is
// one paid ticket the tech worked: time, client, services, gross, card-fee
// deduction, supply deduction, net, payment method — plus a per-tech totals
// row. For an exempt technician the deduction columns are omitted and every
// net equals its gross (FR-024, FR-025).
//
// Reconciliation rule (research R17): never assert a global count. The
// per-tech detail rows are this spec's own seeded tickets, so they are exact
// and concurrency-safe — and the per-tech totals row is reconciled internally
// against the sum of those rendered detail rows AND against that tech's row
// in the overview table.

test.describe("US2: per-technician transaction detail", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test("(f) selecting a non-exempt technician shows their transactions with all columns", async ({
    page,
  }) => {
    await page.goto("/report");

    // The overview is the default right panel.
    await expect(page.locator('[data-slot="all-staff-overview"]')).toBeVisible();

    // Click TECH_A's left-list card → the detail view replaces the overview.
    await page.locator(`.dr-tech-card[data-tech-id="${TECH_A}"]`).click();

    const detail = page.locator(`[data-slot="tech-detail"][data-tech-id="${TECH_A}"]`);
    await expect(detail).toBeVisible();
    await expect(page.locator('[data-slot="all-staff-overview"]')).toHaveCount(0);

    // The header shows the non-exempt "Deducted" figure.
    await expect(detail.locator(".dr-detail-head")).toContainText("Deducted");

    // TECH_A worked TK_1 (supply svc, card) + TK_2 (plain svc, cash) — two rows.
    const rows = detail.locator('[data-slot="tx-row"]');
    await expect(rows).toHaveCount(2);

    // The card-settled supply ticket (TK_1) carries non-zero card-fee + supply
    // deductions. Columns: 0=Time 1=Client 2=Services 3=Gross 4=Card fee
    // 5=Supply 6=Net 7=Pay.
    const tk1Row = detail.locator(`[data-slot="tx-row"][data-tx-id="${TK_1}"]`);
    await expect(tk1Row).toBeVisible();
    expect(await cellText(tk1Row, 3)).toBe("$80");
    expect(await cellText(tk1Row, 4)).toBe("−$3");
    expect(await cellText(tk1Row, 5)).toBe("−$5");
    expect(await cellText(tk1Row, 6)).toBe("$72");

    // The cash plain-service ticket (TK_2) has no deductions → em-dash cells,
    // net equals gross.
    const tk2Row = detail.locator(`[data-slot="tx-row"][data-tx-id="${TK_2}"]`);
    await expect(tk2Row).toBeVisible();
    expect(await cellText(tk2Row, 3)).toBe("$50");
    expect(await cellText(tk2Row, 4)).toBe("—");
    expect(await cellText(tk2Row, 5)).toBe("—");
    expect(await cellText(tk2Row, 6)).toBe("$50");
  });

  test("(g) the per-tech totals row reconciles against the detail rows and the overview", async ({
    page,
  }) => {
    await page.goto("/report");
    await page.locator(`.dr-tech-card[data-tech-id="${TECH_A}"]`).click();

    const detail = page.locator(`[data-slot="tech-detail"][data-tech-id="${TECH_A}"]`);
    await expect(detail).toBeVisible();

    // Sum every rendered detail row, column by column (3=Gross 4=Card fee
    // 5=Supply 6=Net). These rows are this spec's own seeded tickets, so the
    // sum is exact and concurrency-safe.
    const COLS = [3, 4, 5, 6] as const;
    const rows = detail.locator('[data-slot="tx-row"]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    const summed = [0, 0, 0, 0];
    for (let r = 0; r < rowCount; r += 1) {
      const row = rows.nth(r);
      for (let c = 0; c < COLS.length; c += 1) {
        summed[c] += parseCell(await cellText(row, COLS[c]));
      }
    }

    // The detail totals row collapses its first three cells into one
    // `colSpan={3}` label cell, so its `<td>` indices are: 0=label
    // 1=Gross 2=Card fee 3=Supply 4=Net 5=Card tips.
    const TOTAL_COLS = [1, 2, 3, 4] as const;
    const totals = detail.locator('[data-slot="totals-row"]');
    await expect(totals).toBeVisible();
    // The detail totals row equals the detail-row sum exactly — the columns
    // are whole-dollar but every value is this spec's own seeded data, so
    // there is no cross-window rounding drift.
    for (let c = 0; c < COLS.length; c += 1) {
      expect(parseCell(await cellText(totals, TOTAL_COLS[c]))).toBe(summed[c]);
    }

    // The detail totals row also matches TECH_A's overview row — gross,
    // card fee, supply, commissionable.
    expect(parseCell(await cellText(totals, 1))).toBe(parseCell(EXPECT.techA.gross));
    expect(parseCell(await cellText(totals, 2))).toBe(parseCell(EXPECT.techA.cardFee));
    expect(parseCell(await cellText(totals, 3))).toBe(parseCell(EXPECT.techA.supply));
    // Net of the totals row (column 4) equals the overview's commissionable.
    expect(parseCell(await cellText(totals, 4))).toBe(parseCell(EXPECT.techA.commissionable));
  });

  test("(h) an exempt technician's detail omits the deduction columns; net equals gross", async ({
    page,
  }) => {
    await page.goto("/report");
    await page.locator(`.dr-tech-card[data-tech-id="${TECH_B}"]`).click();

    const detail = page.locator(`[data-slot="tech-detail"][data-tech-id="${TECH_B}"]`);
    await expect(detail).toBeVisible();

    // The exempt technician's no-deduction badge renders in the header.
    await expect(detail.locator('[data-slot="exempt-tag"]')).toBeVisible();
    // No "Deducted" figure for an exempt tech.
    await expect(detail.locator(".dr-detail-head")).not.toContainText("Deducted");

    // The "Card fee" / "Supply" column headers are absent.
    const headerCells = detail.locator("thead th");
    const headerTexts = await headerCells.allInnerTexts();
    expect(headerTexts).not.toContain("Card fee");
    expect(headerTexts).not.toContain("Supply");

    // TECH_B worked one ticket (TK_3). With the deduction columns omitted the
    // columns are: 0=Time 1=Client 2=Services 3=Gross 4=Net 5=Pay.
    const tk3Row = detail.locator(`[data-slot="tx-row"][data-tx-id="${TK_3}"]`);
    await expect(tk3Row).toBeVisible();
    const gross = await cellText(tk3Row, 3);
    const net = await cellText(tk3Row, 4);
    expect(gross).toBe("$80");
    // Net equals gross for every transaction of an exempt tech (FR-025).
    expect(net).toBe(gross);

    // The exempt totals row collapses its first three cells into one
    // `colSpan={3}` label cell and omits the deduction columns, so its
    // `<td>` indices are: 0=label 1=Gross 2=Net 3=Card tips. Net === gross.
    const totals = detail.locator('[data-slot="totals-row"]');
    expect(parseCell(await cellText(totals, 1))).toBe(parseCell(await cellText(totals, 2)));
  });

  test("(i) the All Staff button returns to the overview", async ({ page }) => {
    await page.goto("/report");

    // Drill into a technician …
    await page.locator(`.dr-tech-card[data-tech-id="${TECH_A}"]`).click();
    await expect(page.locator(`[data-slot="tech-detail"][data-tech-id="${TECH_A}"]`)).toBeVisible();

    // … then click "All Staff" → the overview is restored.
    await page.locator('[data-slot="all-staff"]').click();
    await expect(page.locator('[data-slot="all-staff-overview"]')).toBeVisible();
    await expect(page.locator('[data-slot="tech-detail"]')).toHaveCount(0);
  });
});

// ─── US3: expand a transaction row to its itemised deduction breakdown ───────
//
// Inside a technician's detail view, a transaction with at least one deduction
// or a card tip is expandable (`data-expandable`): clicking it reveals an
// itemised breakdown — every `ReportDeductionLine`, a "Total deducted"
// subtotal, and, when there is a card tip, that tip with its percentage
// (FR-026). A transaction with neither a deduction nor a card tip is NOT
// expandable: no `data-expandable`, no breakdown, inert on click.
//
// The fixture already carries data for all three assertions:
//   TK_1 — TECH_A, card-settled supply service, $10 tip → two deduction lines
//          (card fee $3 + supply $5) AND a card tip → expandable, both
//          sections. tipPct = round(1000 / 8000 × 100) = 13%.
//   TK_2 — TECH_A, cash plain service, no tip → no deduction, no card tip →
//          NOT expandable.
// No seed extension is needed (reconciliation is internal — the itemised
// lines sum to the row's total deduction; never a global count, research R17).

test.describe("US3: per-transaction deduction breakdown", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test("(j) a transaction with deductions + a card tip expands to its itemised breakdown", async ({
    page,
  }) => {
    await page.goto("/report");
    await page.locator(`.dr-tech-card[data-tech-id="${TECH_A}"]`).click();

    const detail = page.locator(`[data-slot="tech-detail"][data-tech-id="${TECH_A}"]`);
    await expect(detail).toBeVisible();

    // TK_1 carries a card fee + a supply deduction AND a card tip → expandable.
    const tk1Row = detail.locator(`[data-slot="tx-row"][data-tx-id="${TK_1}"]`);
    await expect(tk1Row).toHaveAttribute("data-expandable", "");

    // No breakdown until the row is clicked.
    const breakdown = detail.locator(`[data-slot="tx-breakdown"][data-tx-id="${TK_1}"]`);
    await expect(breakdown).toHaveCount(0);

    await tk1Row.click();
    await expect(breakdown).toBeVisible();

    // Each itemised deduction line renders type, service name, and amount.
    const lines = breakdown.locator('[data-slot="breakdown-line"]');
    await expect(lines).toHaveCount(2);
    const lineTexts = (await lines.allInnerTexts()).join(" ");
    expect(lineTexts).toContain("Card fee");
    expect(lineTexts).toContain("Supply");
    expect(lineTexts).toContain("Report supply service [rpt]");

    // Internal reconciliation: the itemised line amounts sum to the row's
    // "Total deducted" subtotal.
    const lineAmounts: number[] = [];
    const lineCount = await lines.count();
    for (let i = 0; i < lineCount; i += 1) {
      lineAmounts.push(parseCell(await lines.nth(i).locator(".dr-expand-ded").innerText()));
    }
    const summed = lineAmounts.reduce((a, v) => a + v, 0);

    const total = breakdown.locator('[data-slot="breakdown-total"]');
    await expect(total).toContainText("Total deducted");
    expect(parseCell(await total.locator(".dr-expand-ded").innerText())).toBe(summed);
    // The breakdown also reconciles against the row's own deduction cells
    // (column 4 = Card fee, 5 = Supply — both negative).
    expect(summed).toBe(
      parseCell(await cellText(tk1Row, 4)) + parseCell(await cellText(tk1Row, 5))
    );

    // The card tip line carries its whole-percent tip rate (13% — see header).
    const tip = breakdown.locator('[data-slot="breakdown-tip"]');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("13%");
  });

  test("(k) a transaction with no deductions and no card tip is not expandable", async ({
    page,
  }) => {
    await page.goto("/report");
    await page.locator(`.dr-tech-card[data-tech-id="${TECH_A}"]`).click();

    const detail = page.locator(`[data-slot="tech-detail"][data-tech-id="${TECH_A}"]`);
    await expect(detail).toBeVisible();

    // TK_2 is a cash plain-service ticket — no deduction, no card tip.
    const tk2Row = detail.locator(`[data-slot="tx-row"][data-tx-id="${TK_2}"]`);
    await expect(tk2Row).toBeVisible();
    // It carries no `data-expandable` hook …
    await expect(tk2Row).not.toHaveAttribute("data-expandable", "");
    expect(await tk2Row.getAttribute("data-expandable")).toBeNull();

    // … and clicking it reveals no breakdown row (inert).
    await tk2Row.click();
    await expect(detail.locator(`[data-slot="tx-breakdown"][data-tx-id="${TK_2}"]`)).toHaveCount(0);
  });

  test("(l) clicking an expanded transaction row collapses it", async ({ page }) => {
    await page.goto("/report");
    await page.locator(`.dr-tech-card[data-tech-id="${TECH_A}"]`).click();

    const detail = page.locator(`[data-slot="tech-detail"][data-tech-id="${TECH_A}"]`);
    const tk1Row = detail.locator(`[data-slot="tx-row"][data-tx-id="${TK_1}"]`);
    const breakdown = detail.locator(`[data-slot="tx-breakdown"][data-tx-id="${TK_1}"]`);

    // Expand …
    await tk1Row.click();
    await expect(breakdown).toBeVisible();

    // … then click the same row again → the breakdown collapses.
    await tk1Row.click();
    await expect(breakdown).toHaveCount(0);
  });
});

// ─── US4: switch the reporting period and step backward / forward ────────────
//
// A Day / Week / Semi-monthly toggle plus ‹ › arrows over `?period=&offset=`
// drive the resolved window (FR-004 … FR-006). Each control is a `next/link`
// `<Link>` — stepping is plain server navigation that re-fetches the RSC.
// Switching granularity resets `offset` to 0; the "next" arrow is disabled at
// `isCurrent`; forward stepping past the present is forbidden.
//
// Concurrency (research R17): the empty-state assertion uses a FAR-PAST offset
// (a deep negative, well before any fixture's data) so no parallel
// `main`-project spec — `transactions.spec.ts` and friends seed paid tickets
// into recent past windows, and the report renders every tech in a window —
// could have seeded that window and made it non-empty. The "next disabled"
// check navigates to the current period (no offset) and asserts the forward
// arrow is inert. None of these scenarios touch the `70000000-…` fixture, so
// they are concurrency-safe alongside the rest of this file.

test.describe("US4: switch the reporting period", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test("(m) the period control defaults to the current day on first load", async ({ page }) => {
    await page.goto("/report");

    const controls = page.locator('[data-slot="period-controls"]');
    await expect(controls).toBeVisible();

    // Day is the active granularity by default.
    await expect(controls.locator('[data-period="day"]')).toHaveAttribute("aria-current", "true");

    // The current period's label leads with "Today".
    await expect(controls.locator('[data-slot="period-label"]')).toContainText("Today");

    // The "next" arrow is disabled at the current period (forward stepping
    // past the present is forbidden — it renders as an inert <span>).
    const next = controls.locator('[data-slot="period-next"]');
    await expect(next).toHaveAttribute("data-disabled", "true");
    await expect(next).toHaveAttribute("aria-disabled", "true");
  });

  test("(n) switching to Week changes the range label and resets the offset", async ({ page }) => {
    await page.goto("/report");

    // Switch granularity → Week.
    await page.locator('[data-slot="period-controls"] [data-period="week"]').click();
    await page.waitForURL(/period=week/);

    const controls = page.locator('[data-slot="period-controls"]');
    await expect(controls.locator('[data-period="week"]')).toHaveAttribute("aria-current", "true");
    // The current week's label.
    await expect(controls.locator('[data-slot="period-label"]')).toContainText("This week");
    // Switching granularity resets the offset → no `offset` param in the URL.
    expect(new URL(page.url()).searchParams.get("offset")).toBeNull();
  });

  test("(o) switching to Semi-monthly recalculates the report to the pay period", async ({
    page,
  }) => {
    await page.goto("/report");

    await page.locator('[data-slot="period-controls"] [data-period="semi"]').click();
    await page.waitForURL(/period=semi/);

    const controls = page.locator('[data-slot="period-controls"]');
    await expect(controls.locator('[data-period="semi"]')).toHaveAttribute("aria-current", "true");
    await expect(controls.locator('[data-slot="period-label"]')).toContainText("This pay period");

    // The report still renders — either the overview or the empty state, but
    // not a broken page. The page recalculated to the new window.
    const overview = page.locator('[data-slot="all-staff-overview"]');
    const empty = page.locator('[data-slot="empty-state"]');
    await expect(overview.or(empty).first()).toBeVisible();
  });

  test("(p) stepping ‹ back then › forward returns to the current period", async ({ page }) => {
    await page.goto("/report?period=week");

    const controls = page.locator('[data-slot="period-controls"]');
    await expect(controls.locator('[data-slot="period-label"]')).toContainText("This week");

    // Step ‹ back one week → label changes, "next" becomes enabled.
    await controls.locator('[data-slot="period-prev"]').click();
    await page.waitForURL(/offset=-1/);
    await expect(controls.locator('[data-slot="period-label"]')).toContainText("Last week");
    const next = controls.locator('[data-slot="period-next"]');
    await expect(next).not.toHaveAttribute("data-disabled", "true");

    // Step › forward → back to the current week, "next" disabled again.
    await next.click();
    await page.waitForURL(/\/report\?period=week$/);
    await expect(controls.locator('[data-slot="period-label"]')).toContainText("This week");
    await expect(controls.locator('[data-slot="period-next"]')).toHaveAttribute(
      "data-disabled",
      "true"
    );
  });

  test("(q) stepping back to a far-past period that no spec seeds shows the empty state", async ({
    page,
  }) => {
    // A deep negative day offset — ~300 days before today, well before any
    // fixture's `closed_at` data. No parallel `main`-project spec seeds a
    // window this far back, so the report is genuinely empty there (R17).
    await page.goto("/report?period=day&offset=-300");

    const controls = page.locator('[data-slot="period-controls"]');
    await expect(controls).toBeVisible();
    // The "next" arrow is enabled — this is not the current period.
    await expect(controls.locator('[data-slot="period-next"]')).not.toHaveAttribute(
      "data-disabled",
      "true"
    );

    // No paid tickets in that far-past window → the empty state renders.
    await expect(page.locator('[data-slot="empty-state"]')).toBeVisible();
  });
});

// ─── US5: print the report and export a per-technician summary CSV ────────────
//
// The header exposes two actions (FR-027 / FR-028):
//   - Print → `window.print()`. The `@media print` block in `styles/report.css`
//     hides the studio sidebar / top bar, the period controls, and the action
//     buttons so the printout is the report content only. We never invoke a
//     real print dialog — we assert the print rules / print-hidden markers.
//   - Export CSV → builds the CSV via the pure `buildReportCsv` and downloads
//     it as `Report-<rangeLabel>.csv` through a `data:text/csv` anchor. We
//     capture the Playwright `download` event and verify the CSV body's rows
//     and values against the rendered overview rows.
//
// The seeded `70000000-…` fixture (TECH_A non-exempt, TECH_B exempt) is
// reused — no seed extension. Reconciliation is internal: the CSV's per-tech
// row for a seeded technician is matched against that technician's rendered
// overview row, never against a global count (research R17).

test.describe("US5: print and export the report", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test("(r) the header exposes the Print and Export actions", async ({ page }) => {
    await page.goto("/report");

    const actions = page.locator('[data-slot="report-actions"]');
    await expect(actions).toBeVisible();

    // Both buttons are present, sentence-case copy.
    await expect(actions.getByRole("button", { name: "Print" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Export CSV" })).toBeVisible();
  });

  test("(s) Export downloads a CSV whose rows match the rendered overview", async ({ page }) => {
    await page.goto("/report");

    // The overview must be on screen — the CSV mirrors it.
    const techARow = page.locator(`tr.dr-staff-row[data-tech-id="${TECH_A}"]`);
    const techBRow = page.locator(`tr.dr-staff-row[data-tech-id="${TECH_B}"]`);
    await expect(techARow).toBeVisible();
    await expect(techBRow).toBeVisible();

    // Trigger the download and capture the event.
    const downloadPromise = page.waitForEvent("download");
    await page
      .locator('[data-slot="report-actions"]')
      .getByRole("button", { name: "Export CSV" })
      .click();
    const download = await downloadPromise;

    // The filename is `Report-<rangeLabel>.csv`.
    expect(download.suggestedFilename()).toMatch(/^Report-.+\.csv$/);

    // Read the downloaded CSV body.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const csv = Buffer.concat(chunks).toString("utf-8");
    const lines = csv.split("\n");

    // Header row — the nine contract-C5 columns, every value double-quoted.
    expect(lines[0]).toBe(
      '"Tech","Exempt","Services","Gross","Card Fee","Supply",' +
        '"Total Deductions","Commissionable","Card Tips"'
    );

    // The final row is the TOTAL row with a blank Exempt cell.
    const totalLine = lines[lines.length - 1];
    expect(totalLine.startsWith('"TOTAL",""')).toBe(true);

    // Strips the surrounding double quotes from one CSV line's cells.
    const fields = (line: string): string[] =>
      line.split(",").map((c) => c.replace(/^"/, "").replace(/"$/, ""));

    // The seeded technicians each have exactly one CSV row, matching their
    // rendered overview row value-for-value. The page renders whole dollars
    // (`$130`); the CSV keeps cents precision (`130.00`) — compare numerically.
    const techRow = (name: string): string[] | undefined => {
      const found = lines.find((l) => l.startsWith(`"${name}"`));
      return found ? fields(found) : undefined;
    };

    const adaCsv = techRow(TECH_A_NAME);
    expect(adaCsv).toBeDefined();
    // TECH_A — non-exempt: Exempt "No"; gross/cardFee/supply/commissionable/
    // tips match EXPECT.techA (parsed as numbers — drop the `$` and sign).
    expect(adaCsv![1]).toBe("No");
    expect(adaCsv![2]).toBe("2"); // serviceCount — TK_1 + TK_2
    expect(Number(adaCsv![3])).toBe(parseCell(EXPECT.techA.gross)); // 130
    expect(Number(adaCsv![4])).toBe(-parseCell(EXPECT.techA.cardFee)); // 3
    expect(Number(adaCsv![5])).toBe(-parseCell(EXPECT.techA.supply)); // 5
    expect(Number(adaCsv![7])).toBe(parseCell(EXPECT.techA.commissionable)); // 122
    expect(Number(adaCsv![8])).toBe(parseCell(EXPECT.techA.tips)); // 10

    const beaCsv = techRow(TECH_B_NAME);
    expect(beaCsv).toBeDefined();
    // TECH_B — fully exempt: Exempt "Yes"; zero deductions; commissionable
    // equals gross.
    expect(beaCsv![1]).toBe("Yes");
    expect(Number(beaCsv![3])).toBe(parseCell(EXPECT.techB.gross)); // 80
    expect(Number(beaCsv![4])).toBe(0); // card fee
    expect(Number(beaCsv![5])).toBe(0); // supply
    expect(Number(beaCsv![6])).toBe(0); // total deductions
    expect(Number(beaCsv![7])).toBe(parseCell(EXPECT.techB.commissionable)); // 80
    expect(Number(beaCsv![8])).toBe(parseCell(EXPECT.techB.tips)); // 12
  });

  test("(t) the print stylesheet hides the studio chrome and controls", async ({ page }) => {
    await page.goto("/report");
    await expect(page.locator('[data-slot="report-actions"]')).toBeVisible();

    // Emulate print media — the `@media print` rules in `styles/report.css`
    // take effect. We assert the report's own chrome is hidden; the studio
    // sidebar / top bar are part of the parent shell layout.
    await page.emulateMedia({ media: "print" });

    // The period controls and the Print/Export action buttons are hidden in
    // print — interactive chrome meaningless on paper.
    await expect(page.locator('[data-slot="period-controls"]')).toBeHidden();
    await expect(page.locator('[data-slot="report-actions"]')).toBeHidden();

    // The studio sidebar and top bar are hidden too.
    await expect(page.locator(".studio-sidebar")).toBeHidden();
    await expect(page.locator(".studio-topbar")).toBeHidden();

    // The report body itself still renders — the printout is the report.
    await expect(page.locator('[data-slot="all-staff-overview"]')).toBeVisible();

    // Restore screen media for any later test in the worker.
    await page.emulateMedia({ media: "screen" });
  });
});
