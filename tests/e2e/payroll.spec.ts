// E2E for the Payroll page (feature 047-payroll-page), User Story 1: the open
// pay period's per-technician payroll ledger.
//
// Runs in the parallel `main` Playwright project. The page aggregates over the
// shared `tickets` / `payroll_payouts` tables, which other workers' specs also
// write — so this spec NEVER asserts a salon-wide period KPI total or count
// (research R11). It operates only on its own worker-fixture staff trio
// (`tests/e2e/_fixtures.ts` — `Test Owner / Manager / Tech [w<N>]`): it seeds
// payroll rates on the trio and paid tickets `closed_at` earlier today, then
// asserts the trio's exact `data-tech-id` rows and internal per-row
// reconciliation. Everything is torn down in `afterEach` so the trio returns
// to its canonical fixture state.
//
// US2–US5 scenarios are appended to this file in later phases.

import { expect, test } from "./_fixtures";
import type { StaffFixture } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { laParts, utcFromLaWall } from "./_la-time";

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

// A fixed past instant earlier today (salon-local): noon LA, or now-30min when
// the wall clock is already past noon. Guaranteed inside today's day window
// and inside the current semi-monthly pay period, and `<= now()`.
function todayInstant(): Date {
  const now = new Date();
  const t = laParts(now);
  const noon = utcFromLaWall(t.year, t.month, t.day, 12);
  return noon.getTime() <= now.getTime() ? noon : new Date(now.getTime() - 30 * 60_000);
}

// ─── Per-worker fixture id scheme — `71<wHex>…` keeps it distinct from the
//     report spec's `70000000-…` fixture and from every other spec. ─────────
function workerHex(w: number): string {
  return w.toString(16).padStart(2, "0");
}
function svcId(w: number): string {
  return `71000000-0000-0000-00${workerHex(w)}-0000000000c1`;
}
function ticketIds(w: number): { owner: string; manager: string } {
  return {
    owner: `71000000-0000-0000-00${workerHex(w)}-0000000000e1`,
    manager: `71000000-0000-0000-00${workerHex(w)}-0000000000e2`,
  };
}
function itemIds(w: number): { owner: string; manager: string } {
  return {
    owner: `71000000-0000-0000-00${workerHex(w)}-0000000000f1`,
    manager: `71000000-0000-0000-00${workerHex(w)}-0000000000f2`,
  };
}
function pmtIds(w: number): { owner: string; manager: string } {
  return {
    owner: `71000000-0000-0000-00${workerHex(w)}-00000000a001`,
    manager: `71000000-0000-0000-00${workerHex(w)}-00000000a002`,
  };
}

// ─── Seed payroll rates on the worker trio + two paid tickets ────────────────
//
//   Owner   — 90% service / 100% tips · 1 card ticket, gross $200, $20 tip.
//             card fee = $3 house default → commissionable 19700 cents.
//             incomeAfterSplit = round(19700 × 0.9) = 17730 → $177.
//             tipsAfterSplit   = round(2000 × 1.0)  = 2000  → $20.
//             cash = 17730 + 2000 − 0 = 19730 → $197.
//   Manager — 85% service / 100% tips · 1 cash ticket, gross $100, no tip.
//             cash ticket → no card fee → commissionable 10000 cents.
//             incomeAfterSplit = round(10000 × 0.85) = 8500 → $85.
//             cash = 8500 → $85.
//   Tech    — no rates set, no tickets → no_work row.
//
// All figures are this worker's own seeded data, so per-row assertions are
// exact and concurrency-safe.
async function seedPayroll(fixture: StaffFixture): Promise<void> {
  const admin = adminClient();
  const w = fixture.workerIndex;
  const closedAt = todayInstant().toISOString();
  const svc = svcId(w);
  const tk = ticketIds(w);
  const it = itemIds(w);
  const pm = pmtIds(w);

  // Payroll rates on the trio — owner + manager earn, tech does not.
  for (const { id, commission, tip } of [
    { id: fixture.owner.id, commission: 0.9, tip: 1.0 },
    { id: fixture.manager.id, commission: 0.85, tip: 1.0 },
  ]) {
    const { error } = await admin
      .from("staff")
      .update({
        service_commission_pct: commission,
        tip_split_pct: tip,
        check_portion_cents: 0,
      })
      .eq("id", id);
    if (error) throw new Error(`payroll fixture rate update failed: ${error.message}`);
  }

  // A service the seeded tickets reference (`card_fee_mode='default'`).
  const { error: svcErr } = await admin.from("services").upsert(
    [
      {
        id: svc,
        name: `Payroll fixture service [w${w}]`,
        category: "Manicure",
        duration_min: 30,
        price_cents: 20000,
        color_token: "--avatar-rose",
        card_fee_mode: "default",
      },
    ],
    { onConflict: "id" }
  );
  if (svcErr) throw new Error(`payroll fixture services insert failed: ${svcErr.message}`);

  // Two paid tickets — one per earning tech, both closed earlier today.
  const { error: tkErr } = await admin.from("tickets").upsert(
    [
      {
        id: tk.owner,
        status: "paid",
        subtotal_cents: 20000,
        tax_cents: 0,
        total_cents: 20000,
        opened_by_staff_id: fixture.owner.id,
        closed_by_staff_id: fixture.owner.id,
        closed_at: closedAt,
      },
      {
        id: tk.manager,
        status: "paid",
        subtotal_cents: 10000,
        tax_cents: 0,
        total_cents: 10000,
        opened_by_staff_id: fixture.manager.id,
        closed_by_staff_id: fixture.manager.id,
        closed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (tkErr) throw new Error(`payroll fixture tickets insert failed: ${tkErr.message}`);

  // Service line items — one per ticket, assigned to its tech.
  const { error: itErr } = await admin.from("ticket_items").upsert(
    [
      {
        id: it.owner,
        ticket_id: tk.owner,
        kind: "service",
        ref_id: svc,
        name_snapshot: `Payroll fixture service [w${w}]`,
        unit_price_cents: 20000,
        qty: 1,
        assigned_staff_id: fixture.owner.id,
        price_unconfirmed: false,
      },
      {
        id: it.manager,
        ticket_id: tk.manager,
        kind: "service",
        ref_id: svc,
        name_snapshot: `Payroll fixture service [w${w}]`,
        unit_price_cents: 10000,
        qty: 1,
        assigned_staff_id: fixture.manager.id,
        price_unconfirmed: false,
      },
    ],
    { onConflict: "id" }
  );
  if (itErr) throw new Error(`payroll fixture ticket_items insert failed: ${itErr.message}`);

  // Payments — owner's ticket by card with a $20 tip, manager's by cash.
  const { error: pmErr } = await admin.from("payments").upsert(
    [
      {
        id: pm.owner,
        ticket_id: tk.owner,
        method: "card",
        kind: "payment",
        amount_cents: 20000,
        tip_cents: 2000,
        status: "succeeded",
        taken_by_staff_id: fixture.owner.id,
        processed_at: closedAt,
      },
      {
        id: pm.manager,
        ticket_id: tk.manager,
        method: "cash",
        kind: "payment",
        amount_cents: 10000,
        tip_cents: 0,
        status: "succeeded",
        taken_by_staff_id: fixture.manager.id,
        processed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (pmErr) throw new Error(`payroll fixture payments insert failed: ${pmErr.message}`);
}

async function clearPayroll(fixture: StaffFixture): Promise<void> {
  const admin = adminClient();
  const w = fixture.workerIndex;
  const tk = ticketIds(w);
  const tkList = [tk.owner, tk.manager];
  // Drop any payout rows this worker's trio accumulated (US3 records them).
  await admin
    .from("payroll_payouts")
    .delete()
    .in("staff_id", [fixture.owner.id, fixture.manager.id, fixture.tech.id]);
  // Drop any manual adjustments this worker's trio accumulated (053-US2).
  await admin
    .from("payout_adjustments")
    .delete()
    .in("staff_id", [fixture.owner.id, fixture.manager.id, fixture.tech.id]);
  await admin.from("payments").delete().in("ticket_id", tkList);
  await admin.from("ticket_items").delete().in("ticket_id", tkList);
  await admin.from("tickets").delete().in("id", tkList);
  await admin.from("services").delete().eq("id", svcId(w));
}

let supabaseUp = false;

test.beforeAll(async () => {
  supabaseUp = await supabaseIsReachable();
  if (!supabaseUp) {
    test.skip(
      true,
      "Supabase not reachable at 127.0.0.1:54321 — skipping payroll specs (Docker unavailable)."
    );
  }
});

test.afterEach(async ({ staffFixture }) => {
  if (!supabaseUp) return;
  await clearPayroll(staffFixture);
  // Restore the trio's payroll rates to the canonical fixture defaults (0).
  await staffFixture.reset();
});

// Reads the trimmed text of the `idx`-th cell of a `data-tech-id` row.
async function cellText(
  rowLocator: ReturnType<import("@playwright/test").Page["locator"]>,
  idx: number
): Promise<string> {
  const text = await rowLocator.locator("td").nth(idx).innerText();
  return text.trim();
}

// Parses a rendered money cell into a number: `"$200"` → 200, `"—"` → 0.
function parseMoney(text: string): number {
  const t = text.trim();
  if (t === "—") return 0;
  const digits = t.replace(/[$,\s]/g, "");
  return digits === "" ? 0 : Number(digits);
}

// ─── US1: review the open pay period's payroll ledger ────────────────────────

test.describe("US1: open-period payroll ledger", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("(a) owner sees the Payroll nav item and it routes to /payroll", async ({ page }) => {
      await page.goto("/dashboard");

      const navItem = page.locator('[data-nav-id="payroll"]');
      await expect(navItem).toBeVisible();

      await navItem.click();
      await page.waitForURL(/\/payroll(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/payroll");
      await expect(page.locator('[data-slot="payroll-header"]')).toBeVisible();
    });

    test("(b) the ledger lists the worker trio with computed per-tech figures", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);
      await page.goto("/payroll");

      // The header, KPI band, and ledger render.
      await expect(page.locator('[data-slot="payroll-header"]')).toBeVisible();
      await expect(page.locator('[data-slot="payroll-kpis"]')).toBeVisible();
      await expect(page.locator('[data-slot="payroll-ledger"]')).toBeVisible();

      // The trio's three rows are present.
      const ownerRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`
      );
      const managerRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.manager.id}"]`
      );
      const techRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.tech.id}"]`
      );
      await expect(ownerRow).toBeVisible();
      await expect(managerRow).toBeVisible();
      await expect(techRow).toBeVisible();

      // Columns: 0=Employee 1=Tickets 2=Income 3=After split 4=Card tips
      // 5=After split 6=Check 7=Cash 8=State 9=chevron.
      //
      // Owner — card ticket $200, $3 house card fee → commissionable 19700
      // cents ($197 on screen), incomeAfterSplit round(19700×0.9)=17730 →
      // $177, card tips $20, tipsAfterSplit $20, cash 19730 → $197.
      expect(await cellText(ownerRow, 1)).toBe("1"); // tickets
      expect(parseMoney(await cellText(ownerRow, 3))).toBe(177); // after split
      expect(parseMoney(await cellText(ownerRow, 4))).toBe(20); // card tips
      expect(parseMoney(await cellText(ownerRow, 5))).toBe(20); // tips after split
      // Cash = incomeAfterSplit + tipsAfterSplit − check = 17730 + 2000 − 0.
      expect(parseMoney(await cellText(ownerRow, 7))).toBe(197);

      // Manager — cash ticket $100, no card fee → commissionable $100,
      // incomeAfterSplit round(10000×0.85)=8500 → $85, no tips, cash $85.
      expect(await cellText(managerRow, 1)).toBe("1");
      expect(parseMoney(await cellText(managerRow, 3))).toBe(85);
      expect(parseMoney(await cellText(managerRow, 4))).toBe(0);
      expect(parseMoney(await cellText(managerRow, 7))).toBe(85);

      // Tech — no rates, no tickets → "No work" state, em-dash tickets.
      await expect(techRow.locator('[data-slot="state-pill"]')).toHaveAttribute(
        "data-state",
        "no_work"
      );
      expect(await cellText(techRow, 1)).toBe("—");
    });

    test("(c) the owner and manager rows show the Pending state before payout", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);
      await page.goto("/payroll");

      const ownerRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`
      );
      const managerRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.manager.id}"]`
      );
      await expect(ownerRow.locator('[data-slot="state-pill"]')).toHaveAttribute(
        "data-state",
        "pending"
      );
      await expect(managerRow.locator('[data-slot="state-pill"]')).toHaveAttribute(
        "data-state",
        "pending"
      );
    });

    test("(d) per-row cash reconciles to income-after-split + tips-after-split", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);
      await page.goto("/payroll");

      // Internal reconciliation on this spec's own seeded rows (never a
      // salon-wide aggregate — research R11). For a tech with no check
      // portion, cash = incomeAfterSplit + tipsAfterSplit.
      for (const id of [staffFixture.owner.id, staffFixture.manager.id]) {
        const row = page.locator(`tr[data-slot="ledger-row"][data-tech-id="${id}"]`);
        const incomeAfter = parseMoney(await cellText(row, 3));
        const tipsAfter = parseMoney(await cellText(row, 5));
        const check = parseMoney(await cellText(row, 6));
        const cash = parseMoney(await cellText(row, 7));
        expect(cash).toBe(Math.max(0, incomeAfter + tipsAfter - check));
      }
    });

    test("(e) the To pay filter narrows the ledger to unpaid eligible techs", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);
      await page.goto("/payroll?filter=to-pay");

      // Owner + manager (pending, eligible) remain; the no-work tech is hidden.
      await expect(
        page.locator(`tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`)
      ).toBeVisible();
      await expect(
        page.locator(`tr[data-slot="ledger-row"][data-tech-id="${staffFixture.manager.id}"]`)
      ).toBeVisible();
      await expect(
        page.locator(`tr[data-slot="ledger-row"][data-tech-id="${staffFixture.tech.id}"]`)
      ).toHaveCount(0);
    });
  });

  test.describe("as technician", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.tech);
      },
    });

    test("(f) technician has no nav item and /payroll redirects to /dashboard", async ({
      page,
    }) => {
      await page.goto("/dashboard");
      // The role-gated nav item is absent from the DOM for a technician.
      await expect(page.locator('[data-nav-id="payroll"]')).toHaveCount(0);

      // The route itself is the security boundary — a direct visit silently
      // redirects to /dashboard.
      await page.goto("/payroll");
      await page.waitForURL(/\/dashboard(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/dashboard");
    });
  });
});

// ─── US2: open a tech's detail screen ────────────────────────────────────────

test.describe("US2: tech detail screen", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("(a) clicking a ledger row opens that tech's detail screen", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);
      await page.goto("/payroll");

      // Click the owner's ledger row — the stretched row link routes to the
      // tech-detail screen for that staff id.
      const ownerRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`
      );
      await ownerRow.locator('[data-slot="ledger-row-link"]').click();

      await page.waitForURL(new RegExp(`/payroll/${staffFixture.owner.id}(\\?|$)`));
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      // The header names this tech and the daily-activity chart renders.
      const header = page.locator('[data-slot="tech-detail-header"]');
      await expect(header).toBeVisible();
      await expect(header.locator('[data-slot="tech-avatar"]')).toHaveAttribute(
        "data-staff-name",
        staffFixture.owner.displayName
      );
      await expect(page.locator('[data-slot="tech-daily-chart"]')).toBeVisible();
      await expect(page.locator('[data-slot="tech-breakdown"]')).toBeVisible();

      // Owner earned this period — the "cash to hand over" figure shows $197
      // (17730 income-after-split + 2000 tips-after-split). Internal per-row
      // figure, not a salon-wide total (research R11).
      const bignum = page.locator('[data-slot="cash-to-hand-over"]');
      await expect(bignum).toContainText("$197");

      // A working day shows in the chart (the seed closed a ticket today).
      const workingDays = page.locator('[data-slot="chart-day"][data-closed="false"]');
      expect(await workingDays.count()).toBeGreaterThan(0);
    });

    test("(b) prev/next move between techs in ledger order", async ({ page, staffFixture }) => {
      await seedPayroll(staffFixture);

      // Open the manager's detail directly, then step to a neighbour. The
      // worker trio is sorted by display name; manager sits between owner-
      // and tech-named rows, so at least one of prev/next is enabled.
      await page.goto(`/payroll/${staffFixture.manager.id}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      const prev = page.locator('[data-slot="prev-tech"]');
      const next = page.locator('[data-slot="next-tech"]');
      await expect(prev).toBeVisible();
      await expect(next).toBeVisible();

      // Follow whichever neighbour control is an active link. The ledger is
      // sorted by display name across every active tech, so a fixture-trio
      // manager always has at least one neighbour.
      const prevIsLink = (await prev.getAttribute("href")) !== null;
      const target = prevIsLink ? prev : next;
      const targetHref = await target.getAttribute("href");
      expect(targetHref).not.toBeNull();
      // The neighbour is a different tech — its route differs from this one.
      expect(targetHref).not.toBe(`/payroll/${staffFixture.manager.id}`);

      await target.click();
      // Wait for the specific neighbour route — the regex form would match the
      // current URL and resolve before navigation completes.
      await page.waitForURL(`**${targetHref}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();
      expect(new URL(page.url()).pathname).not.toBe(`/payroll/${staffFixture.manager.id}`);
    });

    test("(c) back returns to the ledger", async ({ page, staffFixture }) => {
      await seedPayroll(staffFixture);
      await page.goto(`/payroll/${staffFixture.owner.id}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      await page.locator('[data-slot="back-to-ledger"]').click();
      await page.waitForURL(/\/payroll(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/payroll");
      await expect(page.locator('[data-slot="payroll-ledger"]')).toBeVisible();
    });

    test("(d) a no-work tech's detail screen shows the empty states", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);
      // The tech has no rates and no tickets → a no-work ledger row.
      await page.goto(`/payroll/${staffFixture.tech.id}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      // No-work badge, no cash-to-hand-over figure, empty chart + breakdown.
      await expect(
        page.locator('[data-slot="tech-detail-header"] [data-slot="state-pill"]')
      ).toHaveAttribute("data-state", "no_work");
      await expect(page.locator('[data-slot="cash-to-hand-over"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="chart-empty"]')).toBeVisible();
      await expect(page.locator('[data-slot="breakdown-empty"]')).toBeVisible();
    });
  });

  test.describe("as technician", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.tech);
      },
    });

    test("(e) the tech-detail route redirects a technician to /dashboard", async ({
      page,
      staffFixture,
    }) => {
      // The nested route is the security boundary too — a direct visit
      // silently redirects (SC-005/FR-002).
      await page.goto(`/payroll/${staffFixture.owner.id}`);
      await page.waitForURL(/\/dashboard(\?|$)/);
      expect(new URL(page.url()).pathname).toBe("/dashboard");
    });
  });
});

// ─── US3: mark a tech paid and record the payment method ─────────────────────

test.describe("US3: record and undo a payout", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("(a) mark paid → reload → still paid → undo → pending", async ({ page, staffFixture }) => {
      await seedPayroll(staffFixture);

      // Open the worker's own owner-tech detail screen — that tech earned
      // this period, so a pay-action card renders in the pending state.
      await page.goto(`/payroll/${staffFixture.owner.id}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      const payCard = page.locator('[data-slot="tech-pay-action"]');
      await expect(payCard).toBeVisible();

      // Pick the Zelle payment method, then mark paid.
      await payCard.locator('[data-slot="pay-method"][data-method="zelle"]').click();
      await payCard.locator('[data-slot="mark-paid"]').click();

      // The card flips to the paid receipt — method named, undo offered.
      // `recordPayout` recomputes the snapshot server-side, then `router.refresh()`
      // re-renders the RSC tree in place. In the parallel `main` pool that
      // write-then-refresh round trip can outrun the default 5s expect budget
      // (playwright.config.ts notes form-submits stretching well past 30s under
      // contention), so the in-place flip waits explicitly.
      await expect(payCard.locator('[data-slot="pay-receipt"]')).toBeVisible({
        timeout: 15_000,
      });
      await expect(payCard.locator('[data-slot="pay-receipt"]')).toContainText("Zelle");
      await expect(payCard.locator('[data-slot="undo-payout"]')).toBeVisible();

      // The detail-header state badge now reads Paid.
      await expect(
        page.locator('[data-slot="tech-detail-header"] [data-slot="state-pill"]')
      ).toHaveAttribute("data-state", "paid");

      // Reload — the payout persisted as an immutable snapshot. Still Paid
      // with the recorded method.
      await page.reload();
      await expect(page.locator('[data-slot="tech-pay-action"]')).toBeVisible();
      await expect(
        page.locator('[data-slot="tech-pay-action"] [data-slot="pay-receipt"]')
      ).toContainText("Zelle");
      await expect(
        page.locator('[data-slot="tech-detail-header"] [data-slot="state-pill"]')
      ).toHaveAttribute("data-state", "paid");

      // The ledger row for this tech also reflects Paid (revalidatePath).
      await page.goto("/payroll");
      await expect(
        page
          .locator(`tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`)
          .locator('[data-slot="state-pill"]')
      ).toHaveAttribute("data-state", "paid");

      // Undo — back to Pending, the method tabs return.
      await page.goto(`/payroll/${staffFixture.owner.id}`);
      await page.locator('[data-slot="tech-pay-action"] [data-slot="undo-payout"]').click();
      // Same write-then-refresh round trip as mark-paid — wait explicitly.
      await expect(
        page.locator('[data-slot="tech-pay-action"] [data-slot="pay-method-tabs"]')
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.locator('[data-slot="tech-detail-header"] [data-slot="state-pill"]')
      ).toHaveAttribute("data-state", "pending");

      // The ledger row is Pending again.
      await page.goto("/payroll");
      await expect(
        page
          .locator(`tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`)
          .locator('[data-slot="state-pill"]')
      ).toHaveAttribute("data-state", "pending");
    });

    test("(b) a no-work tech's detail screen offers no pay action", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);

      // The worker's tech has no rates and no tickets → a no-work row, so no
      // pay-action card is rendered (FR-025).
      await page.goto(`/payroll/${staffFixture.tech.id}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();
      await expect(page.locator('[data-slot="tech-pay-action"]')).toHaveCount(0);
    });
  });
});

// ─── US4: close a pay period and browse payroll history ──────────────────────
//
// Closing a period is TERMINAL — it can never be reopened. So this block must
// not close the salon-wide seeded open period (May 16 – 31), which other specs
// depend on. Two parallel-safe strategies are used:
//   - Read-only + history RENDER checks run against the already-seeded closed
//     period (May 1 – 15, 2026 — offset -1). They assert presence, never a
//     salon-wide count, so they stay concurrency-safe.
//   - The close MUTATION is exercised on a DISPOSABLE worker-scoped pay period
//     (a unique non-standard `starts_on` per worker) by calling the
//     `payroll_close_period` RPC directly — the same RPC `closePeriod` wraps —
//     then asserting the row flipped to `closed`. The disposable period is
//     dropped in `afterEach`, so reruns stay idempotent.
//   - The owner-only gate (FR-029) is verified through the UI: a manager sees
//     no Close-period control on the open period, an owner does.

// A disposable worker-scoped pay period — a unique `starts_on` keyed to the
// worker index keeps two workers from colliding on the `pay_periods` unique
// constraint. The date is intentionally non-standard so it is never resolved
// by `loadPayrollLedger`'s offset math (it exists only to exercise the RPC).
function disposablePeriod(w: number): {
  id: string;
  startsOn: string;
  endsOn: string;
  payDate: string;
} {
  return {
    id: `71000000-0000-0000-00${workerHex(w)}-0000000000d1`,
    // 2099 — far outside any resolvable window; `${w}` keeps the day unique.
    startsOn: `2099-01-${String((w % 27) + 1).padStart(2, "0")}`,
    endsOn: `2099-01-${String((w % 27) + 1).padStart(2, "0")}`,
    payDate: `2099-01-${String((w % 27) + 3).padStart(2, "0")}`,
  };
}

async function clearDisposablePeriod(fixture: StaffFixture): Promise<void> {
  const admin = adminClient();
  const period = disposablePeriod(fixture.workerIndex);
  await admin.from("payroll_payouts").delete().eq("pay_period_id", period.id);
  await admin.from("pay_periods").delete().eq("id", period.id);
}

test.describe("US4: close a period and browse history", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test.afterEach(async ({ staffFixture }) => {
      if (!supabaseUp) return;
      await clearDisposablePeriod(staffFixture);
    });

    test("(a) the seeded closed period renders read-only — no close control", async ({ page }) => {
      // Offset -1 is the seeded closed period (May 1 – 15, 2026).
      await page.goto("/payroll?offset=-1");
      await expect(page.locator('[data-slot="payroll-header"]')).toBeVisible();

      // A closed period shows the read-only badge, not the Close-period CTA.
      await expect(page.locator('[data-slot="period-readonly-badge"]')).toBeVisible();
      await expect(page.locator('[data-slot="close-period-trigger"]')).toHaveCount(0);

      // The open period DOES offer the Close-period control to an owner.
      await page.goto("/payroll");
      await expect(page.locator('[data-slot="close-period-trigger"]')).toBeVisible();
      await expect(page.locator('[data-slot="period-readonly-badge"]')).toHaveCount(0);
    });

    test("(b) a closed period's detail screen offers no pay/undo action", async ({ page }) => {
      // Maya is a seeded tech with a frozen payout in the closed period.
      const mayaId = "10000000-0000-0000-0000-000000000001";
      await page.goto(`/payroll/${mayaId}?offset=-1`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      // The period is closed — no pay-action card on the detail screen.
      await expect(page.locator('[data-slot="tech-pay-action"]')).toHaveCount(0);
      // The frozen figure still renders — read-only, not blank.
      await expect(page.locator('[data-slot="cash-to-hand-over"]')).toBeVisible();
    });

    test("(c) History lists the seeded closed period and links to it", async ({ page }) => {
      await page.goto("/payroll");

      // Open the History dialog from the header.
      await page.locator('[data-slot="payroll-history-trigger"]').click();
      const dialog = page.locator('[data-slot="payroll-history-dialog"]');
      await expect(dialog).toBeVisible();

      // The seeded closed period (id 70000000-…-002) is listed. Assert by id —
      // never by count, which would race other workers.
      const seededRow = dialog.locator(
        '[data-slot="payroll-history-row"][data-period-id="70000000-0000-0000-0000-000000000002"]'
      );
      await expect(seededRow).toBeVisible();
      await expect(seededRow).toContainText("May 1 – 15, 2026");

      // Following the row link lands on that period's read-only ledger with its
      // frozen figures unchanged.
      await seededRow.click();
      await page.waitForURL(/\/payroll\?offset=-1$/);
      await expect(page.locator('[data-slot="period-readonly-badge"]')).toBeVisible();
      // The seeded closed period froze Maya's row at $5,200 cash — unchanged.
      const mayaRow = page.locator(
        'tr[data-slot="ledger-row"][data-tech-id="10000000-0000-0000-0000-000000000001"]'
      );
      await expect(mayaRow.locator('[data-slot="state-pill"]')).toHaveAttribute(
        "data-state",
        "paid"
      );
    });

    test("(d) the close RPC freezes an unpaid tech and locks the period", async ({
      staffFixture,
    }) => {
      // Exercise the close MUTATION on a disposable worker-scoped period — the
      // same `payroll_close_period` RPC the `closePeriod` Server Action wraps.
      // Closing the shared open period would be terminal and corrupt other
      // specs, so a throwaway period is used.
      const admin = adminClient();
      const period = disposablePeriod(staffFixture.workerIndex);

      // A fresh OPEN disposable period.
      await clearDisposablePeriod(staffFixture);
      const { error: insErr } = await admin.from("pay_periods").insert({
        id: period.id,
        starts_on: period.startsOn,
        ends_on: period.endsOn,
        pay_date: period.payDate,
        status: "open",
      });
      expect(insErr).toBeNull();

      // Close it — freeze the worker's tech as a paid=false placeholder.
      const { error: rpcErr } = await admin.rpc("payroll_close_period", {
        p_pay_period_id: period.id,
        p_frozen_rows: [
          {
            staff_id: staffFixture.tech.id,
            commissionable_cents: 12345,
            income_after_split_cents: 9876,
            card_tips_cents: 0,
            tips_after_split_cents: 0,
            check_portion_cents: 0,
            cash_payment_cents: 9876,
            service_commission_pct: 0.8,
            tip_split_pct: 1.0,
          },
        ],
        p_period_totals: { commissionable_cents: 12345, cash_cents: 9876 },
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(rpcErr).toBeNull();

      // The period flipped to closed — terminal.
      const { data: periodRow } = await admin
        .from("pay_periods")
        .select("status, closed_by_staff_id")
        .eq("id", period.id)
        .single();
      expect(periodRow?.status).toBe("closed");
      expect(periodRow?.closed_by_staff_id).toBe(staffFixture.owner.id);

      // The unpaid tech was frozen as a paid=false placeholder snapshot.
      const { data: payoutRow } = await admin
        .from("payroll_payouts")
        .select("paid, cash_payment_cents")
        .eq("pay_period_id", period.id)
        .eq("staff_id", staffFixture.tech.id)
        .single();
      expect(payoutRow?.paid).toBe(false);
      expect(payoutRow?.cash_payment_cents).toBe(9876);

      // Closing again is refused — the period is no longer open (terminal).
      const { error: reErr } = await admin.rpc("payroll_close_period", {
        p_pay_period_id: period.id,
        p_frozen_rows: [],
        p_period_totals: {},
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(reErr).not.toBeNull();
      expect(reErr?.message ?? "").toContain("payroll_period_not_open");
    });
  });

  test.describe("as manager", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.manager);
      },
    });

    test("(e) a manager can view history but is blocked from closing", async ({ page }) => {
      await page.goto("/payroll");
      await expect(page.locator('[data-slot="payroll-header"]')).toBeVisible();

      // FR-029 — closing is owner-only. A manager never sees the Close-period
      // control, even on the open period.
      await expect(page.locator('[data-slot="close-period-trigger"]')).toHaveCount(0);

      // A manager CAN still browse history.
      await expect(page.locator('[data-slot="payroll-history-trigger"]')).toBeVisible();
      await page.locator('[data-slot="payroll-history-trigger"]').click();
      await expect(page.locator('[data-slot="payroll-history-dialog"]')).toBeVisible();
    });
  });
});

// ─── US5: configure per-tech payroll rates in Staff settings ─────────────────
//
// FR-033 — editing per-tech payroll rates is owner-only; FR-002/SC-005 — a
// manager attempting it is blocked. The rate edit recomputes the OPEN period's
// pending rows (FR-033 acceptance scenario 2).
//
// Worker-fixture-scoped: each test edits the worker's OWN owner-tech and
// asserts that tech's ledger row only — never a salon-wide total — so the
// block stays parallel-safe in the `main` project (research R11). The rate is
// restored to the seeded value in `afterEach` so reruns stay green.

// Reset the worker trio's payroll-rate columns to 0 (the migration default).
// `upsertStaffTrio` does not touch these columns, so a UI edit must be undone
// explicitly here for re-runs.
async function resetPayrollRates(fixture: StaffFixture): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("staff")
    .update({
      service_commission_pct: 0,
      tip_split_pct: 0,
      check_portion_cents: 0,
    })
    .in("id", [fixture.owner.id, fixture.manager.id, fixture.tech.id]);
  if (error) throw new Error(`payroll-rate reset failed: ${error.message}`);
}

test.describe("US5: configure per-tech payroll rates", () => {
  test.afterEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await resetPayrollRates(staffFixture);
  });

  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("(a) editing a tech's service commission recomputes the open-period ledger", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);

      // Baseline — the worker's manager-tech earns at 85% commission: cash
      // ticket $100, no card fee → commissionable 10000 cents →
      // income-after-split round(10000×0.85)=8500 → $85, cash $85.
      // We edit the MANAGER row (not the owner row): an owner editing their
      // own row leaves the role select disabled, which omits `role` from the
      // FormData — editing a non-self tech keeps every field submittable.
      await page.goto("/payroll");
      const managerRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.manager.id}"]`
      );
      await expect(managerRow).toBeVisible();
      expect(parseMoney(await cellText(managerRow, 3))).toBe(85);
      expect(parseMoney(await cellText(managerRow, 7))).toBe(85);

      // Open the worker's manager-tech in Staff settings and lower the service
      // commission from 85% to 50% through the UI.
      await page.goto(`/settings/staff?selected=${staffFixture.manager.id}`);
      const ratesSection = page.locator('[data-slot="payroll-rates-section"]');
      await expect(ratesSection).toBeVisible();

      const commissionInput = page.locator('[data-slot="payroll-rates-commission-input"]');
      await expect(commissionInput).toBeEnabled();
      await expect(commissionInput).toHaveValue("85");
      await commissionInput.fill("50");

      // The Save button enables once the draft is dirty — wait for the
      // re-render before clicking.
      const saveButton = page.locator('[data-slot="edit-panel-save"]');
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      // The save action redirects back to the staff page with the
      // changes-saved toast — wait for that specific param so the assertion
      // below doesn't race the in-flight Server Action.
      await page.waitForURL(/\/settings\/staff\?.*toast=changes_saved/);

      // Back on Payroll — the open period recomputed with the new rate.
      // income-after-split round(10000×0.5)=5000 → $50, cash $50 (no tips)
      // (FR-033 acceptance scenario 2).
      await page.goto("/payroll");
      const recomputedRow = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.manager.id}"]`
      );
      await expect(recomputedRow).toBeVisible();
      expect(parseMoney(await cellText(recomputedRow, 3))).toBe(50);
      expect(parseMoney(await cellText(recomputedRow, 7))).toBe(50);
    });
  });

  test.describe("as manager", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.manager);
      },
    });

    test("(b) a manager cannot edit the payroll-rate fields", async ({ page, staffFixture }) => {
      // Open the worker's own tech in Staff settings as a manager.
      await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

      // The Payroll rates section still renders, but read-only for a manager
      // (FR-002/FR-033/SC-005).
      const ratesSection = page.locator('[data-slot="payroll-rates-section"]');
      await expect(ratesSection).toBeVisible();

      // The owner-only note replaces the editable form inputs.
      await expect(page.locator('[data-slot="payroll-rates-owner-only-note"]')).toBeVisible();

      // Every rate input is disabled — a manager cannot change them.
      await expect(page.locator('[data-slot="payroll-rates-commission-input"]')).toBeDisabled();
      await expect(page.locator('[data-slot="payroll-rates-tip-split-input"]')).toBeDisabled();
      await expect(page.locator('[data-slot="payroll-rates-check-portion-input"]')).toBeDisabled();
    });
  });
});

// ─── 053-US2: add, edit, and delete manual payout adjustments ────────────────
//
// The owner-tech earns this period (seedPayroll gives them a card ticket), so
// their open-period detail screen renders the AdjustmentsCard with a live form.
// A deduction drops the net payout and lists the line with creator + timestamp;
// editing the amount moves the net; deleting restores it. The dialog confirm is
// disabled for a zero amount and for an empty reason. The ledger Adj./Net-payout
// columns and the Adjustments / Cash-to-pay KPIs reflect the change.
//
// Describe name carries the `US2` token so the scoped `-g "US2"` gate catches it.

test.describe("053-US2: manual payout adjustments", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("(a) add → edit → delete a deduction; net reconciles; KPIs + ledger follow", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);

      // The owner-tech earns ~$197 cash this period (see seedPayroll comment).
      await page.goto(`/payroll/${staffFixture.owner.id}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      const card = page.locator('[data-slot="adjustments-card"]');
      await expect(card).toBeVisible();
      await expect(card.locator('[data-slot="adjustments-empty"]')).toBeVisible();

      const bignum = page.locator('[data-slot="cash-to-hand-over"]');
      const netBefore = parseMoney(
        (await bignum.locator(".pp-detail-bignum-v").textContent()) ?? "$0"
      );
      expect(netBefore).toBeGreaterThan(0);

      // ── Open the add dialog ──
      await card.locator('[data-slot="add-adjustment-trigger"]').click();
      const dialog = page.locator('[data-slot="adjustment-dialog"]');
      await expect(dialog).toBeVisible();

      const confirm = dialog.locator('[data-slot="adjustment-confirm"]');
      // Disabled with no amount / no reason yet.
      await expect(confirm).toBeDisabled();

      // Amount but still no reason → still disabled.
      await dialog.locator('[data-slot="adjustment-amount-input"]').fill("10");
      await expect(confirm).toBeDisabled();

      // Reason but zero amount → disabled (clear the amount).
      await dialog.locator('[data-slot="adjustment-amount-input"]').fill("");
      await dialog.locator('[data-slot="reason-chip"]', { hasText: "Product charge" }).click();
      await expect(confirm).toBeDisabled();

      // ── A $25 deduction ──
      await dialog.locator('[data-slot="direction-deduct"]').click();
      await dialog.locator('[data-slot="adjustment-amount-input"]').fill("25");
      await expect(confirm).toBeEnabled();
      await confirm.click();
      // The dialog closes once the action resolves (success → onDone).
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      // The card's in-place `router.refresh()` is best-effort, so we verify the
      // AUTHORITATIVE persisted result after a hard reload — the same way the
      // US3 recordPayout test (and feature 047) confirm a payroll mutation.
      const admin = adminClient();
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("payout_adjustments")
              .select("amount_cents")
              .eq("staff_id", staffFixture.owner.id);
            return data?.length ?? 0;
          },
          { timeout: 15_000 }
        )
        .toBe(1);
      await page.reload();
      const line = card.locator('[data-slot="adjustment-line"]').first();
      await expect(line).toBeVisible({ timeout: 15_000 });
      await expect(line.locator('[data-slot="adjustment-amount"]')).toContainText("−$25");
      await expect(line.locator(".pp-adj-line-meta")).toContainText(staffFixture.owner.displayName);

      // Net payout dropped by $25.
      const netAfterAdd = parseMoney(
        (await bignum.locator(".pp-detail-bignum-v").textContent()) ?? "$0"
      );
      expect(netAfterAdd).toBe(netBefore - 25);

      // The ledger reflects the Adj. + Net-payout columns + the KPIs.
      await page.goto("/payroll");
      const row = page.locator(
        `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`
      );
      await expect(row.locator('[data-slot="ledger-adj"]')).toContainText("−$25", {
        timeout: 15_000,
      });
      await expect(row.locator('[data-slot="ledger-net-payout"]')).toContainText(
        `$${netBefore - 25}`
      );
      const kpiAdj = page.locator('[data-slot="kpi-adjustments"]');
      await expect(kpiAdj).toBeVisible();
      await expect(kpiAdj).toContainText("−$25");
      await expect(kpiAdj).toContainText("Cash to pay");

      // ── Edit the amount to a $5 deduction ──
      await page.goto(`/payroll/${staffFixture.owner.id}`);
      await expect(card.locator('[data-slot="adjustment-line"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await card.locator('[data-slot="adjustment-line"]').first().scrollIntoViewIfNeeded();
      await card.locator('[data-slot="adjustment-edit"]').first().click();
      await expect(dialog).toBeVisible();
      await dialog.locator('[data-slot="adjustment-amount-input"]').fill("5");
      await dialog.locator('[data-slot="adjustment-confirm"]').click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      // Verify the edit persisted, then reload for the reflected figures.
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("payout_adjustments")
              .select("amount_cents")
              .eq("staff_id", staffFixture.owner.id)
              .maybeSingle();
            return data?.amount_cents ?? null;
          },
          { timeout: 15_000 }
        )
        .toBe(-500);
      await page.reload();
      await expect(
        card
          .locator('[data-slot="adjustment-line"]')
          .first()
          .locator('[data-slot="adjustment-amount"]')
      ).toContainText("−$5", { timeout: 15_000 });
      const netAfterEdit = parseMoney(
        (await bignum.locator(".pp-detail-bignum-v").textContent()) ?? "$0"
      );
      expect(netAfterEdit).toBe(netBefore - 5);

      // ── Delete the adjustment → line gone, net restored ──
      await card.locator('[data-slot="adjustment-delete"]').first().click();
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("payout_adjustments")
              .select("id")
              .eq("staff_id", staffFixture.owner.id);
            return data?.length ?? 0;
          },
          { timeout: 15_000 }
        )
        .toBe(0);
      await page.reload();
      await expect(card.locator('[data-slot="adjustments-empty"]')).toBeVisible({
        timeout: 15_000,
      });
      const netAfterDelete = parseMoney(
        (await bignum.locator(".pp-detail-bignum-v").textContent()) ?? "$0"
      );
      expect(netAfterDelete).toBe(netBefore);
    });
  });
});

// ─── 053-US3: adjustments lock once the period is closed or the tech is paid ──
//
// The no-clawback rule (FR-012): once a tech is paid or the period is closed,
// the adjustments card freezes — the prior lines + the net still show, but every
// write affordance is gone and a "Period closed" lock badge replaces them. The
// server is the real boundary, so a stale mutation fired after the lock is
// REFUSED by the RPC guard (`payroll_assert_adjustable`):
//   - a paid-out tech → `payroll_payout_exists`
//   - a closed period → `payroll_period_not_open`
//
// Two parallel-safe slices:
//   (a) The paid-out-tech path is driven through the UI on the worker's own
//       owner-tech: add an adjustment, mark the tech paid, reload, assert the
//       card is read-only (lock badge, no add / edit / delete) with the line +
//       net still visible — then prove a stale add/edit RPC is refused.
//   (b) The closed-period path is exercised at the RPC layer on a DISPOSABLE
//       worker-scoped period (closing the shared open period would be terminal
//       and corrupt other specs): insert an adjustment, close the period, then
//       assert every adjustment mutation RPC is refused with
//       `payroll_period_not_open` while the row stays put (frozen, not clawed).
//
// Describe name carries the `US3` token so the scoped `-g "US3"` gate catches it.

// A disposable adjustment id for the worker's closed-period slice.
function disposableAdjId(w: number): string {
  return `71000000-0000-0000-00${workerHex(w)}-0000000000a9`;
}

async function clearDisposableAdjustments(fixture: StaffFixture): Promise<void> {
  const admin = adminClient();
  await admin.from("payout_adjustments").delete().eq("id", disposableAdjId(fixture.workerIndex));
}

test.describe("053-US3: adjustments lock when closed or paid out", () => {
  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test.afterEach(async ({ staffFixture }) => {
      if (!supabaseUp) return;
      await clearDisposableAdjustments(staffFixture);
      await clearDisposablePeriod(staffFixture);
    });

    test("(a) a paid-out tech freezes the card; the line + net stay; stale writes are refused", async ({
      page,
      staffFixture,
    }) => {
      await seedPayroll(staffFixture);

      // The owner-tech earns this period — open the detail screen with the live
      // adjustments card.
      await page.goto(`/payroll/${staffFixture.owner.id}`);
      await expect(page.locator('[data-slot="tech-detail-page"]')).toBeVisible();

      const card = page.locator('[data-slot="adjustments-card"]');
      await expect(card).toBeVisible();

      // ── Add a $30 deduction while the period is open + the tech unpaid ──
      await card.locator('[data-slot="add-adjustment-trigger"]').click();
      const dialog = page.locator('[data-slot="adjustment-dialog"]');
      await expect(dialog).toBeVisible();
      await dialog.locator('[data-slot="direction-deduct"]').click();
      await dialog.locator('[data-slot="adjustment-amount-input"]').fill("30");
      await dialog.locator('[data-slot="reason-chip"]', { hasText: "Correction" }).click();
      await dialog.locator('[data-slot="adjustment-confirm"]').click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });

      // The in-place refresh is best-effort; confirm the persisted row (and grab
      // its id for the stale-edit attempt later), then reload to see it listed.
      const admin = adminClient();
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("payout_adjustments")
              .select("id")
              .eq("staff_id", staffFixture.owner.id);
            return data?.length ?? 0;
          },
          { timeout: 15_000 }
        )
        .toBe(1);
      const { data: adjRows } = await admin
        .from("payout_adjustments")
        .select("id")
        .eq("staff_id", staffFixture.owner.id);
      const adjId = adjRows?.[0]?.id as string;
      expect(adjId).toBeTruthy();
      await page.reload();
      await expect(card.locator('[data-slot="adjustment-line"]')).toHaveCount(1);

      // ── Mark the tech paid (Zelle) ──
      const payCard = page.locator('[data-slot="tech-pay-action"]');
      await expect(payCard).toBeVisible();
      await payCard.locator('[data-slot="pay-method"][data-method="zelle"]').click();
      await payCard.locator('[data-slot="mark-paid"]').click();
      // recordPayout is best-effort in-place; confirm the persisted payout row.
      await expect
        .poll(
          async () => {
            const { data } = await admin
              .from("payroll_payouts")
              .select("id")
              .eq("staff_id", staffFixture.owner.id);
            return data?.length ?? 0;
          },
          { timeout: 15_000 }
        )
        .toBe(1);

      // ── Reload → the card is now read-only (the tech is paid) ──
      await page.reload();
      await expect(card).toBeVisible();

      // The "Period closed" lock badge replaces the write affordances. Generous
      // timeout: this fires right after a reload, so under the parallel `main`
      // pool the RSC re-render can lag the default expect window.
      await expect(card.locator('[data-slot="adjustments-lock-badge"]')).toBeVisible({
        timeout: 15_000,
      });
      // No Add trigger, no per-line edit / delete buttons.
      await expect(card.locator('[data-slot="add-adjustment-trigger"]')).toHaveCount(0);
      await expect(card.locator('[data-slot="adjustment-edit"]')).toHaveCount(0);
      await expect(card.locator('[data-slot="adjustment-delete"]')).toHaveCount(0);

      // The frozen line + the net are STILL shown (no clawback — FR-012).
      const line = card.locator('[data-slot="adjustment-line"]').first();
      await expect(line).toBeVisible();
      await expect(line.locator('[data-slot="adjustment-amount"]')).toContainText("−$30");
      await expect(card.locator('[data-slot="adjustments-net"]')).toBeVisible();

      // ── The server is the real boundary: a stale mutation is refused. ──
      const { data: payoutRow } = await admin
        .from("payroll_payouts")
        .select("pay_period_id")
        .eq("staff_id", staffFixture.owner.id)
        .single();
      const payPeriodId = payoutRow?.pay_period_id as string;
      expect(payPeriodId).toBeTruthy();

      // A stale add for the now-paid tech → `payroll_payout_exists`.
      const { error: addErr } = await admin.rpc("payroll_add_adjustment", {
        p_pay_period_id: payPeriodId,
        p_staff_id: staffFixture.owner.id,
        p_amount_cents: -500,
        p_reason: "Stale add after payout",
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(addErr).not.toBeNull();
      expect(addErr?.message ?? "").toContain("payroll_payout_exists");

      // A stale edit of the existing line → also `payroll_payout_exists`.
      const { error: editErr } = await admin.rpc("payroll_edit_adjustment", {
        p_adjustment_id: adjId,
        p_amount_cents: -100,
        p_reason: "Stale edit after payout",
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(editErr).not.toBeNull();
      expect(editErr?.message ?? "").toContain("payroll_payout_exists");

      // The frozen line is unchanged — the stale writes did not claw it back.
      const { data: afterRow } = await admin
        .from("payout_adjustments")
        .select("amount_cents")
        .eq("id", adjId)
        .single();
      expect(afterRow?.amount_cents).toBe(-3000);
    });

    test("(b) closing a period refuses every adjustment mutation RPC", async ({ staffFixture }) => {
      const admin = adminClient();
      const period = disposablePeriod(staffFixture.workerIndex);
      const adjId = disposableAdjId(staffFixture.workerIndex);

      // A fresh OPEN disposable period with one adjustment on the worker's tech.
      await clearDisposableAdjustments(staffFixture);
      await clearDisposablePeriod(staffFixture);
      const { error: insErr } = await admin.from("pay_periods").insert({
        id: period.id,
        starts_on: period.startsOn,
        ends_on: period.endsOn,
        pay_date: period.payDate,
        status: "open",
      });
      expect(insErr).toBeNull();

      const { error: adjErr } = await admin.from("payout_adjustments").insert({
        id: adjId,
        pay_period_id: period.id,
        staff_id: staffFixture.tech.id,
        amount_cents: -1500,
        reason: "Frozen by close",
        created_by_staff_id: staffFixture.owner.id,
      });
      expect(adjErr).toBeNull();

      // Close the period — terminal.
      const { error: closeErr } = await admin.rpc("payroll_close_period", {
        p_pay_period_id: period.id,
        p_frozen_rows: [],
        p_period_totals: {},
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(closeErr).toBeNull();

      // Every adjustment mutation is now refused with `payroll_period_not_open`.
      const { error: addErr } = await admin.rpc("payroll_add_adjustment", {
        p_pay_period_id: period.id,
        p_staff_id: staffFixture.tech.id,
        p_amount_cents: -500,
        p_reason: "Stale add after close",
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(addErr?.message ?? "").toContain("payroll_period_not_open");

      const { error: editErr } = await admin.rpc("payroll_edit_adjustment", {
        p_adjustment_id: adjId,
        p_amount_cents: -100,
        p_reason: "Stale edit after close",
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(editErr?.message ?? "").toContain("payroll_period_not_open");

      const { error: delErr } = await admin.rpc("payroll_delete_adjustment", {
        p_adjustment_id: adjId,
        p_operator: staffFixture.owner.id,
        p_device_user_id: null,
      });
      expect(delErr?.message ?? "").toContain("payroll_period_not_open");

      // The frozen line survived every refused mutation — no clawback (FR-012).
      const { data: stillThere } = await admin
        .from("payout_adjustments")
        .select("amount_cents")
        .eq("id", adjId)
        .single();
      expect(stillThere?.amount_cents).toBe(-1500);
    });
  });
});
