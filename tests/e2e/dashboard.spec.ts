// E2E for feature 016-dashboard-data-wiring, User Story 3.
//
// US1 and US2 from the original spec were retired in PR #6 of the e2e
// pruning audit (see `docs/e2e-pruning-audit.md` → dashboard section):
//   - US1 (a) live tile values + payment-mix legend + Split pill: covered
//     by `tests/unit/dashboard/queries.test.ts`, `aggregate.test.ts`,
//     `format.test.ts` — pure-function aggregation + projection.
//   - US1 (b) empty-state path: covered by `aggregate.test.ts` (empty
//     summarize) and `format.test.ts` (neutral payment-mix branch).
//   - US2 period toggle Today / Week / Month: covered by
//     `tests/unit/time/period-windows.test.ts` (window math) and
//     `queries.test.ts` (today/week/month query bounds).
//
// What remains: the 15-row feed scroll + "feed always shows today
// regardless of period" invariant. That's an RSC + layout contract that
// only the browser can exercise — internal scroll vs page scroll, and
// the dashboard's pinned-to-today feed irrespective of the period
// toggle.
//
// The shared TZ-aware fixture helpers used by this spec (and reusable by
// other specs that need to seed paid tickets at LA-local instants) live
// in `./_la-time.ts`.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

import { todayWindow } from "@/lib/time/period-windows";
import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { laTodayMidnightUtcMs, SALON_TZ } from "./_la-time";
import { acquireTicketStateLock, releaseTicketStateLock } from "./_square-server-stub";

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";

// Stable seed UUIDs (from supabase/seed.sql § paid-tickets-today block).
// We restore these in `afterAll` so downstream specs see the canonical
// 5-ticket fixture after this spec wipes today's tickets.
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

// Re-insert the canonical 5-ticket seed paid-tickets block. Mirrors
// supabase/seed.sql § T004 shape (5 tickets across card/cash/gift/split + a
// discount line) but places `closed_at` / `processed_at` in the recent
// past relative to now, so the dashboard's `closed_at <= now` filter
// never excludes them regardless of what time of day the suite runs.
async function restoreSeededPaidTickets(): Promise<void> {
  const admin = adminClient();

  // Pin the spread to `[laMidnight + 1min, now - 30s]`, compressing when
  // the wall clock is close to LA midnight.
  const laMidnightUtcMs = laTodayMidnightUtcMs();
  const nowMs = Date.now();
  const earliest = Math.max(laMidnightUtcMs + 60_000, nowMs - 60 * 60_000);
  const latest = nowMs - 30_000;
  const step = Math.max(0, (latest - earliest) / 4);

  const at = (slot: 1 | 2 | 3 | 4 | 5, extraSec = 0): string => {
    return new Date(earliest + step * (slot - 1) + extraSec * 1000).toISOString();
  };

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

// Wipes EVERY paid ticket dated today (salon TZ), regardless of source.
// The dashboard aggregates all today's paid tickets, so leftover rows
// from earlier checkout-* specs would inflate US3's "expect 15" assertion
// on single-worker runs where those specs sort before dashboard.spec.ts.
async function clearAllTodayPaidTickets(): Promise<void> {
  const admin = adminClient();
  const [todayStart] = todayWindow(SALON_TZ, new Date());
  const { data: ids } = await admin
    .from("tickets")
    .select("id")
    .eq("status", "paid")
    .gte("closed_at", todayStart.toISOString());
  const ticketIds = (ids ?? []).map((r) => r.id);
  if (ticketIds.length === 0) return;
  await admin.from("ticket_items").delete().in("ticket_id", ticketIds);
  await admin.from("payments").delete().in("ticket_id", ticketIds);
  await admin.from("tickets").delete().in("id", ticketIds);
}

test.describe.configure({ mode: "serial" });

// Cross-worker serialization (issue #41). end-of-day-cash also wipes +
// restores today's paid-tickets seed; if they run concurrently under
// workers > 1 the wipes race and dashboard reads see a sub-seed count.
test.beforeAll(async () => {
  await acquireTicketStateLock();
});
test.afterAll(() => {
  releaseTicketStateLock();
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
// zero tip — keeps the fixture focused on the row-count + ordering contract.

const US3_TICKET_COUNT = 15;
const US3_TICKET_IDS: readonly string[] = Array.from(
  { length: US3_TICKET_COUNT },
  (_, i) =>
    // Distinct UUID prefix `50000000-…` so US3 fixtures never collide with
    // the canonical seed (30000000-…).
    `50000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`
);

// Slot i (1…15) → minutes-ago: slot 1 is the oldest (75 min), slot 15 the
// newest (5 min). All instants are clamped to today's LA window so the
// dashboard's "today in LA" filter sees every row, even when the suite
// runs within ~75 minutes of LA midnight (CI on UTC hosts crosses LA
// midnight ~07:00–08:00 UTC). When the wall clock is close to midnight
// the spread compresses, but the row count and ordering still hold.
function us3SlotTimestamp(slotIndex0Based: number): string {
  const laMidnight = laTodayMidnightUtcMs();
  const now = Date.now();
  const lo = Math.max(laMidnight + 60_000, now - 75 * 60_000);
  const hi = now - 30_000;
  const step = (hi - lo) / Math.max(1, US3_TICKET_COUNT - 1);
  return new Date(lo + slotIndex0Based * step).toISOString();
}

async function insertUs3Fixture(): Promise<void> {
  const admin = adminClient();
  const owner = "10000000-0000-0000-0000-000000000001";
  const svcClassicMani = "20000000-0000-0000-0000-000000000001";

  const tickets = US3_TICKET_IDS.map((id, i) => {
    const iso = us3SlotTimestamp(i);
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
    return {
      ticket_id: id,
      method: "card",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 0,
      status: "succeeded",
      taken_by_staff_id: owner,
      processed_at: us3SlotTimestamp(i),
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

// Parse an `h:mm AM/PM` cell into minutes-past-midnight. Returns null if
// it can't parse.
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
    // US3 asserts exactly 15 rows in the feed. Wipe every paid ticket
    // dated today — the canonical seed AND any residue from upstream
    // checkout-* specs — so the count assertion holds.
    await clearAllTodayPaidTickets();
    await clearUs3Fixture();
    await insertUs3Fixture();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await clearUs3Fixture();
    // Leave the canonical seed restored so downstream specs see the
    // 5-ticket baseline.
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
