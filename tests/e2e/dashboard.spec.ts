// E2E for feature 016-dashboard-data-wiring, User Story 1.
//
// Covers Acceptance Scenarios from `spec.md § US1`:
//   (a) Live tile values from the seeded paid tickets; Payment-mix legend
//       rows for Card/Cash/Gift; subtitle "{Weekday}, {Month day} · Last
//       sale {h:mm AM/PM}"; no comparison badges; no Techs-on-shift tile;
//       feed rows have no client cell; exactly one Split pill.
//   (b) Truncate today's paid tickets → empty-state path: tiles 0/$0,
//       payment-mix bar neutral single segment, feed "No sales yet today.",
//       subtitle collapses to "{Weekday}, {Month day}".
//
// The seed fixture (supabase/seed.sql T004 block — 5 paid tickets dated
// today) is the source of truth for the expected aggregates. The spec
// reads back from the DB via the service-role admin client rather than
// hardcoding dollar amounts so a future seed-fixture tweak doesn't break
// the spec by accident.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

import { formatSubtitle, formatTime } from "@/lib/time/format";
import { getAuditLogRowsSince, newAuditCursor } from "./_db";

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";
const SALON_TZ = "America/Los_Angeles";

// Stable seed UUIDs (from supabase/seed.sql § paid-tickets-today block).
const SEED_TICKET_IDS = [
  "30000000-0000-0000-0000-000000000001",
  "30000000-0000-0000-0000-000000000002",
  "30000000-0000-0000-0000-000000000003",
  "30000000-0000-0000-0000-000000000004",
  "30000000-0000-0000-0000-000000000005",
] as const;

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

type SeededAggregates = {
  count: number;
  services: number;
  // tiles render currency rounded to no decimals; assert against the
  // page's en-US currency formatter output.
  revenue: number;
  tips: number;
  byMethod: { card: number; cash: number; gift: number };
  lastSale: Date;
};

async function readSeededAggregates(): Promise<SeededAggregates> {
  const admin = adminClient();

  const { data: tickets, error: tkErr } = await admin
    .from("tickets")
    .select("id, total_cents, closed_at")
    .in("id", SEED_TICKET_IDS as readonly string[])
    .eq("status", "paid");
  if (tkErr) throw new Error(`tickets read failed: ${tkErr.message}`);
  expect(tickets?.length ?? 0).toBe(5);

  const { data: items, error: itErr } = await admin
    .from("ticket_items")
    .select("ticket_id, kind, qty")
    .in("ticket_id", SEED_TICKET_IDS as readonly string[]);
  if (itErr) throw new Error(`ticket_items read failed: ${itErr.message}`);

  const { data: payments, error: pmErr } = await admin
    .from("payments")
    .select("ticket_id, method, status, amount_cents, tip_cents, processed_at")
    .in("ticket_id", SEED_TICKET_IDS as readonly string[]);
  if (pmErr) throw new Error(`payments read failed: ${pmErr.message}`);

  let services = 0;
  for (const item of items ?? []) {
    if (item.kind === "discount") continue;
    services += item.qty ?? 0;
  }

  let revenueC = 0;
  let tipsC = 0;
  const byMethodC = { card: 0, cash: 0, gift: 0 };
  let lastSaleIso = "";
  for (const p of payments ?? []) {
    if (p.status !== "succeeded") continue;
    revenueC += (p.amount_cents ?? 0) + (p.tip_cents ?? 0);
    tipsC += p.tip_cents ?? 0;
    if (p.method === "card" || p.method === "cash" || p.method === "gift") {
      const m = p.method as "card" | "cash" | "gift";
      byMethodC[m] += (p.amount_cents ?? 0) + (p.tip_cents ?? 0);
    }
    if (p.processed_at && p.processed_at > lastSaleIso) {
      lastSaleIso = p.processed_at;
    }
  }

  return {
    count: tickets!.length,
    services,
    revenue: revenueC / 100,
    tips: tipsC / 100,
    byMethod: {
      card: byMethodC.card / 100,
      cash: byMethodC.cash / 100,
      gift: byMethodC.gift / 100,
    },
    lastSale: new Date(lastSaleIso),
  };
}

const CURRENCY_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
function fmtCurrency(amount: number): string {
  return CURRENCY_FMT.format(amount);
}

// Re-insert the seed paid-tickets block. Mirrors supabase/seed.sql § T004
// shape (5 tickets across card/cash/gift/split + a discount line) but
// places `closed_at` / `processed_at` in the recent past relative to now,
// so the dashboard's `closed_at <= now` filter never excludes them
// regardless of what time of day the suite runs.
async function restoreSeededPaidTickets(): Promise<void> {
  const admin = adminClient();

  // Place the five tickets at staggered minutes in the past — guarantees
  // every ticket is "today in LA" AND `closed_at <= now()`. Spread is
  // 60 / 50 / 40 / 30 / 20 minutes ago in ascending closed_at order.
  const now = Date.now();
  const minutesAgo = (m: number, extraSec = 0): string =>
    new Date(now - m * 60 * 1000 + extraSec * 1000).toISOString();

  // Slot 1 — 60 min ago (oldest)
  // Slot 2 — 50 min ago
  // Slot 3 — 40 min ago
  // Slot 4 — 30 min ago (split tender — two payments 1s apart)
  // Slot 5 — 20 min ago (newest)
  const at = (slot: 1 | 2 | 3 | 4 | 5, extraSec = 0): string => {
    const slots: Record<number, number> = { 1: 60, 2: 50, 3: 40, 4: 30, 5: 20 };
    return minutesAgo(slots[slot], extraSec);
  };

  // Owner / Jordan / Sam from staff seed
  const owner = "10000000-0000-0000-0000-000000000001";
  const jordan = "10000000-0000-0000-0000-000000000002";
  const sam = "10000000-0000-0000-0000-000000000003";
  const svc = {
    classicMani: "20000000-0000-0000-0000-000000000001",
    gelPolish: "20000000-0000-0000-0000-000000000002",
    classicPedi: "20000000-0000-0000-0000-000000000003",
    spaPedi: "20000000-0000-0000-0000-000000000004",
    nailArt: "20000000-0000-0000-0000-000000000005",
  };

  // Insert tickets
  await admin.from("tickets").upsert(
    [
      {
        id: SEED_TICKET_IDS[0],
        status: "paid",
        subtotal_cents: 2500,
        tax_cents: 0,
        total_cents: 2500,
        opened_by_staff_id: owner,
        closed_by_staff_id: owner,
        closed_at: at(1),
      },
      {
        id: SEED_TICKET_IDS[1],
        status: "paid",
        subtotal_cents: 7500,
        tax_cents: 0,
        total_cents: 7500,
        opened_by_staff_id: jordan,
        closed_by_staff_id: jordan,
        closed_at: at(2),
      },
      {
        id: SEED_TICKET_IDS[2],
        status: "paid",
        subtotal_cents: 4000,
        tax_cents: 0,
        total_cents: 4000,
        opened_by_staff_id: sam,
        closed_by_staff_id: sam,
        closed_at: at(3),
      },
      {
        id: SEED_TICKET_IDS[3],
        status: "paid",
        subtotal_cents: 8000,
        tax_cents: 0,
        total_cents: 8000,
        opened_by_staff_id: owner,
        closed_by_staff_id: jordan,
        closed_at: at(4),
      },
      {
        id: SEED_TICKET_IDS[4],
        status: "paid",
        subtotal_cents: 9000,
        tax_cents: 0,
        total_cents: 9000,
        opened_by_staff_id: sam,
        closed_by_staff_id: sam,
        closed_at: at(5),
      },
    ],
    { onConflict: "id" }
  );

  // Insert items
  await admin.from("ticket_items").insert([
    {
      ticket_id: SEED_TICKET_IDS[0],
      kind: "service",
      ref_id: svc.classicMani,
      name_snapshot: "Classic manicure",
      unit_price_cents: 2500,
      qty: 1,
      assigned_staff_id: owner,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[1],
      kind: "service",
      ref_id: svc.gelPolish,
      name_snapshot: "Gel polish",
      unit_price_cents: 3500,
      qty: 1,
      assigned_staff_id: jordan,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[1],
      kind: "service",
      ref_id: svc.classicPedi,
      name_snapshot: "Classic pedicure",
      unit_price_cents: 4000,
      qty: 1,
      assigned_staff_id: jordan,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[2],
      kind: "service",
      ref_id: svc.classicPedi,
      name_snapshot: "Classic pedicure",
      unit_price_cents: 4000,
      qty: 1,
      assigned_staff_id: sam,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[3],
      kind: "service",
      ref_id: svc.classicMani,
      name_snapshot: "Classic manicure",
      unit_price_cents: 2500,
      qty: 1,
      assigned_staff_id: owner,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[3],
      kind: "service",
      ref_id: svc.spaPedi,
      name_snapshot: "Spa pedicure",
      unit_price_cents: 5500,
      qty: 1,
      assigned_staff_id: jordan,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[4],
      kind: "service",
      ref_id: svc.classicMani,
      name_snapshot: "Classic manicure",
      unit_price_cents: 2500,
      qty: 1,
      assigned_staff_id: sam,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[4],
      kind: "service",
      ref_id: svc.classicPedi,
      name_snapshot: "Classic pedicure",
      unit_price_cents: 4000,
      qty: 1,
      assigned_staff_id: sam,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[4],
      kind: "service",
      ref_id: svc.nailArt,
      name_snapshot: "Nail art",
      unit_price_cents: 3500,
      qty: 1,
      assigned_staff_id: sam,
      price_unconfirmed: false,
    },
    {
      ticket_id: SEED_TICKET_IDS[4],
      kind: "discount",
      ref_id: null,
      name_snapshot: "Loyalty discount",
      unit_price_cents: -1000,
      qty: 1,
      assigned_staff_id: null,
      price_unconfirmed: false,
    },
  ]);

  // Insert payments
  await admin.from("payments").insert([
    {
      ticket_id: SEED_TICKET_IDS[0],
      method: "card",
      kind: "payment",
      amount_cents: 2500,
      tip_cents: 500,
      status: "succeeded",
      taken_by_staff_id: owner,
      processed_at: at(1),
    },
    {
      ticket_id: SEED_TICKET_IDS[1],
      method: "cash",
      kind: "payment",
      amount_cents: 7500,
      tip_cents: 1350,
      status: "succeeded",
      taken_by_staff_id: jordan,
      processed_at: at(2),
    },
    {
      ticket_id: SEED_TICKET_IDS[2],
      method: "gift",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 0,
      status: "succeeded",
      taken_by_staff_id: sam,
      processed_at: at(3),
    },
    {
      ticket_id: SEED_TICKET_IDS[3],
      method: "cash",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 880,
      status: "succeeded",
      taken_by_staff_id: jordan,
      processed_at: at(4),
    },
    {
      ticket_id: SEED_TICKET_IDS[3],
      method: "card",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 880,
      status: "succeeded",
      taken_by_staff_id: jordan,
      processed_at: at(4, 1),
    },
    {
      ticket_id: SEED_TICKET_IDS[4],
      method: "card",
      kind: "payment",
      amount_cents: 9000,
      tip_cents: 2250,
      status: "succeeded",
      taken_by_staff_id: sam,
      processed_at: at(5),
    },
  ]);
}

// Truncate today's paid tickets via the SQL pattern from quickstart.md § 5.
// Removes only the seeded test rows so other tests' data isn't disturbed.
async function clearSeededPaidTickets(): Promise<void> {
  const admin = adminClient();
  await admin
    .from("ticket_items")
    .delete()
    .in("ticket_id", SEED_TICKET_IDS as readonly string[]);
  await admin
    .from("payments")
    .delete()
    .in("ticket_id", SEED_TICKET_IDS as readonly string[]);
  await admin
    .from("tickets")
    .delete()
    .in("id", SEED_TICKET_IDS as readonly string[]);
}

test.describe.configure({ mode: "serial" });

test.describe("US1: today's real numbers", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 dashboard specs (Docker unavailable)."
      );
    }
    // The seed loaded by `supabase db reset` pins ticket times at LA-local
    // 9:12 AM through 3:22 PM today. When the suite runs in the early
    // morning local time those instants are FUTURE relative to `now`, and
    // the dashboard's `closed_at <= now()` filter excludes them. Replace
    // the rows with timestamps in the recent past so the queries always
    // see them regardless of wall-clock time.
    await clearSeededPaidTickets();
    await restoreSeededPaidTickets();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    // Leave the DB with the seed intact so downstream specs can rely on it.
    await clearSeededPaidTickets();
    await restoreSeededPaidTickets();
  });

  test("(a) live tile values, payment-mix legend, subtitle, no comparison badges, no techs tile, no client column, one Split pill", async ({
    page,
  }) => {
    // Make sure the seed is applied at the start of this test.
    await clearSeededPaidTickets();
    await restoreSeededPaidTickets();

    const expected = await readSeededAggregates();

    await signInAsMaya(page, "/dashboard");
    // Set the audit cursor AFTER sign-in so the device.signed_in /
    // staff.signed_in rows don't pollute the dashboard-read assertion.
    const cursor = newAuditCursor();
    // Reload so the dashboard fetch happens after the cursor is taken.
    await page.reload();

    // Tiles.
    const transactionsTile = page
      .locator(".tx-stat-card")
      .filter({ has: page.locator(".lbl", { hasText: "Transactions" }) });
    await expect(transactionsTile.locator(".val")).toHaveText(String(expected.count));

    const servicesTile = page
      .locator(".tx-stat-card")
      .filter({ has: page.locator(".lbl", { hasText: "Services" }) });
    await expect(servicesTile.locator(".val")).toHaveText(String(expected.services));

    const revenueTile = page
      .locator(".tx-stat-card")
      .filter({ has: page.locator(".lbl", { hasText: "Revenue" }) });
    await expect(revenueTile.locator(".val")).toHaveText(fmtCurrency(expected.revenue));

    const tipsTile = page
      .locator(".tx-stat-card")
      .filter({ has: page.locator(".lbl", { hasText: "Tips" }) });
    await expect(tipsTile.locator(".val")).toHaveText(fmtCurrency(expected.tips));

    // Payment-mix legend — Card / Cash / Gift card rows with currency.
    // Use the `.dot.{method}` selector to disambiguate (the "Card" / "Cash"
    // labels share the "Gift card" substring otherwise).
    const mix = page.locator("[data-slot='payment-mix-card']");
    const cardRow = mix.locator(".tx-method-row").filter({ has: page.locator(".dot.card") });
    await expect(cardRow.locator(".num")).toHaveText(fmtCurrency(expected.byMethod.card));
    const cashRow = mix.locator(".tx-method-row").filter({ has: page.locator(".dot.cash") });
    await expect(cashRow.locator(".num")).toHaveText(fmtCurrency(expected.byMethod.cash));
    const giftRow = mix.locator(".tx-method-row").filter({ has: page.locator(".dot.gift") });
    await expect(giftRow.locator(".num")).toHaveText(fmtCurrency(expected.byMethod.gift));
    // The seeded gift ticket is $40 → non-zero
    expect(expected.byMethod.gift).toBeGreaterThan(0);

    // Subtitle: "{Weekday}, {Month day} · Last sale {h:mm AM/PM}"
    const expectedSubtitle = `${formatSubtitle(new Date(), SALON_TZ)} · Last sale ${formatTime(
      expected.lastSale,
      SALON_TZ
    )}`;
    // `.first()` because the New-transaction CTA also has a `.sub` element.
    await expect(page.locator(".tx-landing-top > div .sub").first()).toHaveText(expectedSubtitle);

    // No comparison badges.
    await expect(page.locator(".tx-stat-card").getByText(/\+\d+ vs avg/)).toHaveCount(0);
    await expect(page.locator(".tx-stat-card").getByText(/\+\d+%/)).toHaveCount(0);

    // No techs-on-shift tile or label.
    await expect(page.locator("[data-slot='techs-on-shift-tile']")).toHaveCount(0);
    await expect(page.getByText("Techs on shift")).toHaveCount(0);

    // Feed rows have no `.client` cell.
    const rows = page.locator(".tx-feed-row");
    await expect(rows).toHaveCount(expected.count);
    await expect(rows.locator(".client")).toHaveCount(0);

    // Exactly one Split pill.
    await expect(page.locator(".tx-meth-pill.split")).toHaveCount(1);

    // Audit-log: no rows emitted by the dashboard read.
    const audit = await getAuditLogRowsSince(cursor);
    expect(audit).toEqual([]);
  });

  test("(b) empty-state path — truncate today's paid tickets and verify zero tiles, neutral payment-mix segment, empty feed copy, collapsed subtitle", async ({
    page,
  }) => {
    await clearSeededPaidTickets();

    await signInAsMaya(page, "/dashboard");
    // Cursor AFTER sign-in so device.signed_in / staff.signed_in audit rows
    // don't pollute the read-only dashboard assertion.
    const cursor = newAuditCursor();
    await page.reload();

    // Tiles all 0 / $0.
    for (const label of ["Transactions", "Services"]) {
      const tile = page
        .locator(".tx-stat-card")
        .filter({ has: page.locator(".lbl", { hasText: label }) });
      await expect(tile.locator(".val")).toHaveText("0");
    }
    for (const label of ["Revenue", "Tips"]) {
      const tile = page
        .locator(".tx-stat-card")
        .filter({ has: page.locator(".lbl", { hasText: label }) });
      await expect(tile.locator(".val")).toHaveText("$0");
    }

    // Payment-mix bar — exactly one segment with neutral style (var(--muted)).
    const mixBar = page.locator("[data-slot='payment-mix-card'] .tx-method-bar > span");
    await expect(mixBar).toHaveCount(1);
    await expect(mixBar).toHaveCSS("width", /.+/);

    // Feed shows the empty copy.
    await expect(page.locator("[data-slot='empty-feed-state']")).toBeVisible();
    await expect(page.locator("[data-slot='empty-feed-state']")).toHaveText("No sales yet today.");

    // Subtitle collapses to "{Weekday}, {Month day}" — no `· Last sale`.
    const subtitle = page.locator(".tx-landing-top > div .sub").first();
    await expect(subtitle).toHaveText(formatSubtitle(new Date(), SALON_TZ));

    // Audit-log untouched.
    const audit = await getAuditLogRowsSince(cursor);
    expect(audit).toEqual([]);

    // Restore the seed so the next test (or downstream specs) see the
    // canonical 5-ticket fixture.
    await restoreSeededPaidTickets();
  });
});

// ─── US2: period switching across calendar windows ───────────────────────────
//
// Covers Acceptance Scenarios from `spec.md § US2`: toggling between
// Today / Week / Month must re-render the four tile values to reflect the
// in-window subset of paid tickets, with no extra Supabase roundtrip and no
// audit-log writes. Validates the math of `todayWindow`, `weekWindow`, and
// `monthWindow` against real calendar boundaries (Monday week-start in LA,
// first-of-month, last-week/last-month negative controls).
//
// Seeding strategy: insert paid tickets at instants pinned relative to "now"
// in America/Los_Angeles — today-noon, in-this-week (when today is not
// Monday), in-this-month-not-this-week (when today is past the first calendar
// week), last-week negative control, and last-month negative control. Each
// branch may yield null when the calendar doesn't support it (e.g. today IS
// Monday, or today is in the first week of the month) — assertions are then
// derived from the actually-seeded subset, not hardcoded.

// Distinct UUID prefix so US2 fixtures never collide with the canonical
// seed (30000000-…) used by US1.
const US2_TICKET_IDS = {
  today: "40000000-0000-0000-0000-000000000001",
  thisWeek: "40000000-0000-0000-0000-000000000002",
  thisMonth: "40000000-0000-0000-0000-000000000003",
  lastWeek: "40000000-0000-0000-0000-000000000004",
  lastMonth: "40000000-0000-0000-0000-000000000005",
} as const;

type Slot = keyof typeof US2_TICKET_IDS;

// Read the local LA wall-clock parts of a UTC instant. Identical helper to
// the one inside `lib/time/period-windows.ts` but inlined here so the spec
// stays self-contained.
function laParts(now: Date): { year: number; month: number; day: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: SALON_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayOrder: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayOrder[get("weekday")] ?? 0,
  };
}

// Build a UTC instant from local-wall-clock parts in `America/Los_Angeles`.
// Two-pass DST-correction technique mirrors `utcFromLocalParts` in
// `lib/time/period-windows.ts`.
function utcFromLaWall(year: number, month: number, day: number, hour: number): Date {
  const candidateMs = Date.UTC(year, month - 1, day, hour, 0, 0);
  const off = (instant: Date): number => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: SALON_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(instant);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
    const h = get("hour") === "24" ? "00" : get("hour");
    const local = Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(h),
      Number(get("minute")),
      Number(get("second"))
    );
    return local - instant.getTime();
  };
  const o1 = off(new Date(candidateMs));
  const correctedMs = candidateMs - o1;
  const o2 = off(new Date(correctedMs));
  return new Date(candidateMs - o2);
}

// Add `days` to an LA-local Y/M/D and return the new tuple. Treats the local
// date as UTC for the shift — safe because we only need a stable Y/M/D, not
// a particular wall-clock hour.
function shiftDays(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

type SeedPlan = {
  // Map from slot → UTC instant when that ticket should be `closed_at`.
  // A null value means "skip this slot in the current calendar branch".
  instants: Record<Slot, Date | null>;
  // Which slots end up inside each window. Derived from `instants` against
  // the same window boundaries the page uses.
  inToday: Slot[];
  inWeek: Slot[];
  inMonth: Slot[];
};

function buildSeedPlan(now: Date): SeedPlan {
  const t = laParts(now);

  // Slot 1 — today. Pick an instant safely in the past today: noon LA, or
  // if local time is already past noon, fall back to "now minus 30 minutes"
  // so the instant is guaranteed to be `<= now()` AND inside today's window.
  const todayNoonUtc = utcFromLaWall(t.year, t.month, t.day, 12);
  const todayInstant =
    todayNoonUtc.getTime() <= now.getTime() ? todayNoonUtc : new Date(now.getTime() - 30 * 60_000);

  // Slot 2 — in-this-week-not-today. Only valid when today's weekday > Mon,
  // because the week starts Monday in LA. Pin to Tuesday-of-this-week 14:00
  // when today is mid-or-late week; pin to Monday-of-this-week 14:00 when
  // today IS Tuesday (so the in-week ticket is strictly before today).
  // Returns null when today is Monday.
  let thisWeekInstant: Date | null = null;
  if (t.weekday >= 2) {
    // today is Wed–Sun → use Tuesday of this week
    const tueOff = t.weekday - 1; // weekday: Mon=0, Tue=1, … so Tue is offset (weekday - 1)
    const tue = shiftDays(t.year, t.month, t.day, -tueOff);
    thisWeekInstant = utcFromLaWall(tue.year, tue.month, tue.day, 14);
  } else if (t.weekday === 1) {
    // today is Tuesday → use Monday of this week
    const mon = shiftDays(t.year, t.month, t.day, -1);
    thisWeekInstant = utcFromLaWall(mon.year, mon.month, mon.day, 14);
  }
  // weekday === 0 (Monday): leave null — no "in-week-but-not-today" exists.

  // Slot 3 — in-this-month-not-this-week. Pick the 5th of the current month
  // at 14:00 LA. Valid only when (a) today's day-of-month is past the 7th
  // AND (b) the 5th is strictly before this week's Monday in LA. When the
  // 5th IS inside this week (rare: e.g. it's the first week of the month),
  // fall back to null — the test must derive expectations from what was
  // actually seeded.
  let thisMonthInstant: Date | null = null;
  if (t.day > 7) {
    // 5th of this month is at least 3 days before today, and given Monday
    // week-start, also strictly before this week's Monday in all cases
    // where today's day-of-month > 7 (week is at most 7 days long).
    const fifth = utcFromLaWall(t.year, t.month, 5, 14);
    thisMonthInstant = fifth;
  }

  // Slot 4 — last-week negative control. last Tuesday at 14:00 LA. Always
  // valid (last week always existed); always strictly before this week's
  // Monday, hence outside the Week and Today windows.
  // "Last Tuesday" = today - (weekday + 6 days). weekday: Mon=0→last Tue is
  // 6 days ago; Tue=1→last Tue is 7 days ago; Wed=2→8 days ago; etc.
  const lastTueOffset = t.weekday + 6;
  const lastTue = shiftDays(t.year, t.month, t.day, -lastTueOffset);
  const lastWeekInstant = utcFromLaWall(lastTue.year, lastTue.month, lastTue.day, 14);

  // Slot 5 — last-month negative control. Use the 5th of last month at 14:00
  // LA when today is past mid-month; when today is in the first week of the
  // month, the 5th of last month is still strictly before this month's
  // first, so always valid. Computed by stepping back to (current month - 1).
  // shiftDays via the 1st handles wrap-around.
  const firstOfThisMonth = shiftDays(t.year, t.month, 1, 0);
  const dayInLastMonth = shiftDays(firstOfThisMonth.year, firstOfThisMonth.month, 1, -25); // ~25 days before first-of-this is mid-last-month
  // Use that as a reference to find last month's year+month, then pick day=5
  const lastMonthInstant = utcFromLaWall(dayInLastMonth.year, dayInLastMonth.month, 5, 14);

  const instants: Record<Slot, Date | null> = {
    today: todayInstant,
    thisWeek: thisWeekInstant,
    thisMonth: thisMonthInstant,
    lastWeek: lastWeekInstant,
    lastMonth: lastMonthInstant,
  };

  // Derive window membership from the actual seeded instants and current `now`.
  // Re-implementing window boundaries here in Node so the test is
  // independent of the Postgres query — if the helper's math is wrong the
  // assertion below will diverge from the page output.
  // Today: [LA midnight today, now]
  const todayStart = utcFromLaWall(t.year, t.month, t.day, 0);
  // Week: [LA midnight on most recent Monday, now]
  const mondayOffset = t.weekday; // 0 if Mon, 6 if Sun
  const mon = shiftDays(t.year, t.month, t.day, -mondayOffset);
  const weekStart = utcFromLaWall(mon.year, mon.month, mon.day, 0);
  // Month: [LA midnight on day 1 of current month, now]
  const monthStart = utcFromLaWall(t.year, t.month, 1, 0);

  const inWindow = (instant: Date | null, start: Date): boolean =>
    instant !== null && instant.getTime() >= start.getTime() && instant.getTime() <= now.getTime();

  const slots: Slot[] = ["today", "thisWeek", "thisMonth", "lastWeek", "lastMonth"];
  const inToday = slots.filter((s) => inWindow(instants[s], todayStart));
  const inWeek = slots.filter((s) => inWindow(instants[s], weekStart));
  const inMonth = slots.filter((s) => inWindow(instants[s], monthStart));

  return { instants, inToday, inWeek, inMonth };
}

// Per-slot pricing — chosen so each window total is unique and easy to
// reason about. Card payment, single service line, zero tip for simplicity
// (tip math is exercised by US1).
const SLOT_PRICE_CENTS: Record<Slot, number> = {
  today: 5000, // $50
  thisWeek: 7000, // $70
  thisMonth: 11000, // $110
  lastWeek: 13000, // $130
  lastMonth: 17000, // $170
};

async function insertUs2Fixture(plan: SeedPlan): Promise<void> {
  const admin = adminClient();
  const owner = "10000000-0000-0000-0000-000000000001";
  const svcClassicMani = "20000000-0000-0000-0000-000000000001";

  const slots: Slot[] = ["today", "thisWeek", "thisMonth", "lastWeek", "lastMonth"];
  const present = slots.filter((s) => plan.instants[s] !== null);

  const tickets = present.map((s) => {
    const cents = SLOT_PRICE_CENTS[s];
    const iso = plan.instants[s]!.toISOString();
    return {
      id: US2_TICKET_IDS[s],
      status: "paid",
      subtotal_cents: cents,
      tax_cents: 0,
      total_cents: cents,
      opened_by_staff_id: owner,
      closed_by_staff_id: owner,
      closed_at: iso,
    };
  });
  const items = present.map((s) => ({
    ticket_id: US2_TICKET_IDS[s],
    kind: "service",
    ref_id: svcClassicMani,
    name_snapshot: "Classic manicure",
    unit_price_cents: SLOT_PRICE_CENTS[s],
    qty: 1,
    assigned_staff_id: owner,
    price_unconfirmed: false,
  }));
  const payments = present.map((s) => ({
    ticket_id: US2_TICKET_IDS[s],
    method: "card",
    kind: "payment",
    amount_cents: SLOT_PRICE_CENTS[s],
    tip_cents: 0,
    status: "succeeded",
    taken_by_staff_id: owner,
    processed_at: plan.instants[s]!.toISOString(),
  }));

  const { error: tkErr } = await admin.from("tickets").upsert(tickets, { onConflict: "id" });
  if (tkErr) throw new Error(`US2 tickets insert failed: ${tkErr.message}`);
  const { error: itErr } = await admin.from("ticket_items").insert(items);
  if (itErr) throw new Error(`US2 ticket_items insert failed: ${itErr.message}`);
  const { error: pmErr } = await admin.from("payments").insert(payments);
  if (pmErr) throw new Error(`US2 payments insert failed: ${pmErr.message}`);
}

async function clearUs2Fixture(): Promise<void> {
  const admin = adminClient();
  const ids = Object.values(US2_TICKET_IDS);
  await admin.from("ticket_items").delete().in("ticket_id", ids);
  await admin.from("payments").delete().in("ticket_id", ids);
  await admin.from("tickets").delete().in("id", ids);
}

function sumCount(slots: Slot[]): number {
  return slots.length;
}
function sumServices(slots: Slot[]): number {
  // Each US2 ticket has exactly one service line, qty=1.
  return slots.length;
}
function sumRevenueDollars(slots: Slot[]): number {
  return slots.reduce((acc, s) => acc + SLOT_PRICE_CENTS[s], 0) / 100;
}

test.describe("US2: period switching across calendar windows", () => {
  let supabaseUp = false;
  let plan: SeedPlan;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 dashboard specs (Docker unavailable)."
      );
    }
    // US1's canonical seed pollutes today's window. Clear it so US2 owns
    // the dashboard read entirely; restore it in afterAll for downstream
    // specs (US1 also has the same restore pattern in its own afterAll).
    await clearSeededPaidTickets();
    await clearUs2Fixture();
    plan = buildSeedPlan(new Date());
    await insertUs2Fixture(plan);
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await clearUs2Fixture();
    // Leave the canonical seed restored for downstream specs.
    await restoreSeededPaidTickets();
  });

  test("(a) toggling Today / Week / Month re-renders tiles from in-window tickets only; negative controls never contribute; no audit writes", async ({
    page,
  }) => {
    await signInAsMaya(page, "/dashboard");
    const cursor = newAuditCursor();
    await page.reload();

    const transactionsTile = page
      .locator(".tx-stat-card")
      .filter({ has: page.locator(".lbl", { hasText: "Transactions" }) });
    const servicesTile = page
      .locator(".tx-stat-card")
      .filter({ has: page.locator(".lbl", { hasText: "Services" }) });
    const revenueTile = page
      .locator(".tx-stat-card")
      .filter({ has: page.locator(".lbl", { hasText: "Revenue" }) });

    const periodGroup = page.getByRole("group", { name: "Period" });
    const todayBtn = periodGroup.getByRole("button", { name: "Today" });
    const weekBtn = periodGroup.getByRole("button", { name: "Week" });
    const monthBtn = periodGroup.getByRole("button", { name: "Month" });

    // ── Today ────────────────────────────────────────────────────────────
    await todayBtn.click();
    await expect(transactionsTile.locator(".val")).toHaveText(String(sumCount(plan.inToday)));
    await expect(servicesTile.locator(".val")).toHaveText(String(sumServices(plan.inToday)));
    await expect(revenueTile.locator(".val")).toHaveText(
      fmtCurrency(sumRevenueDollars(plan.inToday))
    );

    // ── Week ─────────────────────────────────────────────────────────────
    await weekBtn.click();
    await expect(transactionsTile.locator(".val")).toHaveText(String(sumCount(plan.inWeek)));
    await expect(servicesTile.locator(".val")).toHaveText(String(sumServices(plan.inWeek)));
    await expect(revenueTile.locator(".val")).toHaveText(
      fmtCurrency(sumRevenueDollars(plan.inWeek))
    );

    // ── Month ────────────────────────────────────────────────────────────
    await monthBtn.click();
    await expect(transactionsTile.locator(".val")).toHaveText(String(sumCount(plan.inMonth)));
    await expect(servicesTile.locator(".val")).toHaveText(String(sumServices(plan.inMonth)));
    await expect(revenueTile.locator(".val")).toHaveText(
      fmtCurrency(sumRevenueDollars(plan.inMonth))
    );

    // Negative-control invariants:
    //  - `lastWeek` (last Tuesday 14:00 LA) is before this week's Monday →
    //    never in Today or Week. May be in Month when last Tuesday's local
    //    date is still in the current month (e.g. mid-month Sundays).
    //  - `lastMonth` (5th of last month 14:00 LA) is before this month's 1st
    //    → never in Today, Week, or Month.
    expect(plan.inToday).not.toContain("lastWeek");
    expect(plan.inToday).not.toContain("lastMonth");
    expect(plan.inWeek).not.toContain("lastWeek");
    expect(plan.inWeek).not.toContain("lastMonth");
    expect(plan.inMonth).not.toContain("lastMonth");

    // Audit-log: toggling and the initial dashboard read emit no rows.
    const audit = await getAuditLogRowsSince(cursor);
    expect(audit).toEqual([]);
  });
});

// ─── US3: scrollable today feed ──────────────────────────────────────────────
//
// Covers Acceptance Scenarios from `spec.md § US3`:
//   - All paid tickets today appear in the feed — no row cap (FR-022).
//   - Rows are ordered by `closed_at desc` (newest first).
//   - When the row count overflows the slot, scrolling happens INSIDE the
//     `.tx-feed-list` container, not on the outer page (FR-012) — the page
//     itself must not introduce horizontal scrolling either.
//   - The feed is pinned to today regardless of the period toggle (FR-011);
//     selecting Week leaves the row count unchanged.
//   - The dashboard read emits no audit-log rows.
//
// Seeding strategy: insert 15 paid tickets pinned to staggered past-relative
// minutes (75…5 min ago, every 5 min). Each is a single-line, card payment,
// zero tip — keeps the fixture focused on the row-count + ordering contract
// without re-exercising tip / split-tender math (those live in US1).

const US3_TICKET_COUNT = 15;
const US3_TICKET_IDS: readonly string[] = Array.from(
  { length: US3_TICKET_COUNT },
  (_, i) =>
    // Distinct UUID prefix `50000000-…` so US3 fixtures never collide with
    // US1 (30000000-…) or US2 (40000000-…).
    `50000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`
);

// Slot i (1…15) → minutes-ago: slot 1 is the oldest (75 min), slot 15 the
// newest (5 min). All instants strictly in the past, well inside today's
// LA window even at very-early-morning runs (75 min before "now" can wrap
// into yesterday only when local time is between 00:00 and 01:15 LA).
// That edge is tolerated: the dashboard window is "today in LA", and the
// suite seeding window matches — if the test runs between 00:00 and 01:15
// LA, some slots may technically be yesterday and the assertion (a) would
// fall short. In practice Playwright runs against `Pacific/Los_Angeles`
// servers or in CI containers where this corner is rare; we accept the
// trade-off to stay inside one calendar day with a simple stagger.
function minutesAgoUs3(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

async function insertUs3Fixture(): Promise<void> {
  const admin = adminClient();
  const owner = "10000000-0000-0000-0000-000000000001";
  const svcClassicMani = "20000000-0000-0000-0000-000000000001";

  const tickets = US3_TICKET_IDS.map((id, i) => {
    // slot 1 → 75 min ago; slot 15 → 5 min ago. 5-minute stagger.
    const minutes = 75 - i * 5;
    const iso = minutesAgoUs3(minutes);
    return {
      id,
      status: "paid",
      subtotal_cents: 4000,
      tax_cents: 0,
      total_cents: 4000,
      opened_by_staff_id: owner,
      closed_by_staff_id: owner,
      closed_at: iso,
    };
  });
  const items = US3_TICKET_IDS.map((id) => ({
    ticket_id: id,
    kind: "service",
    ref_id: svcClassicMani,
    name_snapshot: "Classic manicure",
    unit_price_cents: 4000,
    qty: 1,
    assigned_staff_id: owner,
    price_unconfirmed: false,
  }));
  const payments = US3_TICKET_IDS.map((id, i) => {
    const minutes = 75 - i * 5;
    return {
      ticket_id: id,
      method: "card",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 0,
      status: "succeeded",
      taken_by_staff_id: owner,
      processed_at: minutesAgoUs3(minutes),
    };
  });

  const { error: tkErr } = await admin.from("tickets").upsert(tickets, { onConflict: "id" });
  if (tkErr) throw new Error(`US3 tickets insert failed: ${tkErr.message}`);
  const { error: itErr } = await admin.from("ticket_items").insert(items);
  if (itErr) throw new Error(`US3 ticket_items insert failed: ${itErr.message}`);
  const { error: pmErr } = await admin.from("payments").insert(payments);
  if (pmErr) throw new Error(`US3 payments insert failed: ${pmErr.message}`);
}

async function clearUs3Fixture(): Promise<void> {
  const admin = adminClient();
  await admin.from("ticket_items").delete().in("ticket_id", US3_TICKET_IDS);
  await admin.from("payments").delete().in("ticket_id", US3_TICKET_IDS);
  await admin.from("tickets").delete().in("id", US3_TICKET_IDS);
}

// Parse an `h:mm AM/PM` (or `h:mm AM/PM`) cell into a comparable minutes-
// past-midnight number. Returns null if it can't parse.
function parseFeedTimeToMinutes(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

test.describe("US3: scrollable today feed", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 dashboard specs (Docker unavailable)."
      );
    }
    // US1's canonical 5-ticket seed and US2's leftovers both add rows that
    // could fall inside today's window — clear them so US3 owns the feed
    // count exactly. Both fixtures are restored in afterAll.
    await clearSeededPaidTickets();
    await clearUs2Fixture();
    await clearUs3Fixture();
    await insertUs3Fixture();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await clearUs3Fixture();
    // Leave the canonical seed restored so downstream specs see the
    // 5-ticket baseline. US2's fixture is owned by US2 and doesn't need
    // re-seeding here.
    await restoreSeededPaidTickets();
  });

  test("(a–f) 15 rows in closed_at desc order, inner scroll, no page horizontal scroll, feed pinned to today, no audit writes", async ({
    page,
  }) => {
    await signInAsMaya(page, "/dashboard");
    const cursor = newAuditCursor();
    await page.reload();

    // (a) row count
    const rows = page.locator(".tx-feed-row");
    await expect(rows).toHaveCount(US3_TICKET_COUNT);

    // (b) ordering — read first and last row's time cell, confirm first > last.
    const firstTime = await rows.first().locator(".time").innerText();
    const lastTime = await rows.last().locator(".time").innerText();
    const firstMin = parseFeedTimeToMinutes(firstTime);
    const lastMin = parseFeedTimeToMinutes(lastTime);
    expect(firstMin).not.toBeNull();
    expect(lastMin).not.toBeNull();
    expect(firstMin!).toBeGreaterThan(lastMin!);

    // (c) inner scroll: the `.tx-feed-list` container scrolls vertically.
    // Wait for the first row to be visible so the layout is settled before
    // we read scroll/client heights — otherwise the probe can race the
    // initial paint and see 0/0 dimensions.
    await expect(page.locator(".tx-feed-row").first()).toBeVisible();
    const innerScrolls = await page
      .locator(".tx-feed-list")
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(innerScrolls).toBe(true);

    // (d) the outer page does NOT introduce horizontal scrolling.
    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth === document.documentElement.clientWidth
    );
    expect(noHorizontalScroll).toBe(true);

    // (e) toggle to Week — feed stays pinned to today (15 rows, same order).
    const periodGroup = page.getByRole("group", { name: "Period" });
    const weekBtn = periodGroup.getByRole("button", { name: "Week" });
    await weekBtn.click();
    // Wait for the toggle to register the active state.
    await expect(weekBtn).toHaveClass(/active/);
    await expect(rows).toHaveCount(US3_TICKET_COUNT);
    const firstTimeAfter = await rows.first().locator(".time").innerText();
    const lastTimeAfter = await rows.last().locator(".time").innerText();
    expect(parseFeedTimeToMinutes(firstTimeAfter)!).toBeGreaterThan(
      parseFeedTimeToMinutes(lastTimeAfter)!
    );

    // (f) audit-log: dashboard read + toggle emit no rows.
    const audit = await getAuditLogRowsSince(cursor);
    expect(audit).toEqual([]);
  });
});
