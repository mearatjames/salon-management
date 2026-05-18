// E2E for feature 019-end-of-day-cash, User Story 1.
//
// Covers the "Count and close, exact match" acceptance scenario from
// `specs/019-end-of-day-cash/spec.md` and the manual smoke from
// `quickstart.md`:
//   1. Sign in as owner (Maya).
//   2. Visit `/end-of-day`.
//   3. Read the expected total from the panel footer.
//   4. Tap each digit on the numpad to type the same amount.
//   5. The Comparison block flips to "Exact match" + the Close Out Day
//      button enables.
//   6. Click Close Out Day → the done screen renders.
//   7. Reload → closed state persists.
//   8. Audit-log: exactly one `cash_drawer.closed` row written since the
//      test cursor, with the expected payload shape.
//
// Docker / Supabase availability: same probe pattern as the rest of the
// suite — skip when the local Supabase is unreachable.

import { expect, test } from "@playwright/test";

import { createClient } from "@supabase/supabase-js";

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

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Reuses the standard sign-in flow: Maya Patel (owner; PIN 1234).
async function signInAsMaya(
  page: import("@playwright/test").Page,
  next = "/end-of-day"
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

// Stable seed UUIDs (from supabase/seed.sql § paid-tickets-today block).
// We pin the seeded cash payments (Tickets 2 + 4 in the seed) to recent
// past relative to "now", so the dashboard's `processed_at IN
// todayWindow()` filter always sees them regardless of wall-clock time.
const CASH_TICKET_IDS = [
  "30000000-0000-0000-0000-000000000002", // pure cash $75
  "30000000-0000-0000-0000-000000000004", // split tender; cash leg $40
] as const;

// Wipes today's existing cash_drawer session row(s) and any pending
// closes from a previous run — so this spec always starts on the "Open"
// state. Also closes the audit-log gap by capturing the cursor AFTER the
// cleanup so leftover sign-in rows don't muddy the assertion.
async function resetCashDrawerForToday(): Promise<void> {
  const admin = adminClient();
  // Use the salon TZ (America/Los_Angeles per existing settings seed) to
  // compute today's business-day string the same way the page does.
  const todayLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await admin.from("cash_drawer_sessions").delete().eq("business_day", todayLocal);
}

// Wipes every paid ticket dated today (salon TZ), regardless of source.
// Why: the end-of-day read aggregates ALL today's cash payments, so
// leftover rows from earlier checkout-cash / split-tender specs would
// inflate the expected total and break the "type the exact amount"
// assertion. Identical pattern to dashboard.spec.ts.
async function clearAllTodayPaidTickets(): Promise<void> {
  const admin = adminClient();
  const todayStartIso = (() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = fmt.format(new Date()); // YYYY-MM-DD in LA
    // Reconstruct the UTC instant for LA midnight today (good enough — the
    // earliest seed/staggered payment is 60+ min after midnight LA).
    return `${today}T07:00:00Z`; // LA = UTC-7 in PDT, UTC-8 in PST
  })();
  const { data: ids } = await admin
    .from("tickets")
    .select("id")
    .eq("status", "paid")
    .gte("closed_at", todayStartIso);
  const ticketIds = (ids ?? []).map((r) => r.id);
  if (ticketIds.length === 0) return;
  await admin.from("ticket_items").delete().in("ticket_id", ticketIds);
  await admin.from("payments").delete().in("ticket_id", ticketIds);
  await admin.from("tickets").delete().in("id", ticketIds);
}

// LA-today-midnight as a UTC instant. Mirrors the helper in
// dashboard.spec.ts — kept inline here to avoid cross-spec coupling.
function laTodayMidnightUtcMs(): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const partVal = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const elapsed =
    partVal("hour") * 3_600_000 + partVal("minute") * 60_000 + partVal("second") * 1000;
  return now.getTime() - elapsed;
}

// Restore just the cash ticket fixtures we care about for this spec —
// reuses the same shape as the seeded rows but rewrites timestamps so
// they always fall inside today's LA window, even when the wall clock
// is within an hour of LA midnight (e.g. CI on UTC hosts).
async function restoreSeededCashTickets(): Promise<void> {
  const admin = adminClient();
  const owner = "10000000-0000-0000-0000-000000000001";
  const jordan = "10000000-0000-0000-0000-000000000002";
  const sam = "10000000-0000-0000-0000-000000000003";
  const svcGel = "20000000-0000-0000-0000-000000000002";
  const svcPedi = "20000000-0000-0000-0000-000000000003";
  const svcMani = "20000000-0000-0000-0000-000000000001";
  const svcSpa = "20000000-0000-0000-0000-000000000004";

  const laMidnightUtcMs = laTodayMidnightUtcMs();
  const now = Date.now();
  // Clamp "X minutes ago" forward so it never lands before LA-today-midnight.
  // The actual ordering only matters within today's window; both seeded
  // payments still resolve in ascending processed_at order.
  const minutesAgo = (m: number): string => {
    const desired = now - m * 60 * 1000;
    const floor = laMidnightUtcMs + 60_000; // 1 min past LA midnight
    return new Date(Math.max(desired, floor)).toISOString();
  };

  // Ticket 2: pure cash $75 (Jordan/Jordan)
  await admin.from("tickets").upsert(
    [
      {
        id: CASH_TICKET_IDS[0],
        status: "paid",
        subtotal_cents: 7500,
        tax_cents: 0,
        total_cents: 7500,
        opened_by_staff_id: jordan,
        closed_by_staff_id: jordan,
        closed_at: minutesAgo(40),
      },
      // Ticket 4: split tender (cash $40 + card $40) → 8000 subtotal
      {
        id: CASH_TICKET_IDS[1],
        status: "paid",
        subtotal_cents: 8000,
        tax_cents: 0,
        total_cents: 8000,
        opened_by_staff_id: owner,
        closed_by_staff_id: jordan,
        closed_at: minutesAgo(20),
      },
    ],
    { onConflict: "id" }
  );

  await admin.from("ticket_items").insert([
    {
      ticket_id: CASH_TICKET_IDS[0],
      kind: "service",
      ref_id: svcGel,
      name_snapshot: "Gel polish",
      unit_price_cents: 3500,
      qty: 1,
      assigned_staff_id: jordan,
      price_unconfirmed: false,
    },
    {
      ticket_id: CASH_TICKET_IDS[0],
      kind: "service",
      ref_id: svcPedi,
      name_snapshot: "Classic pedicure",
      unit_price_cents: 4000,
      qty: 1,
      assigned_staff_id: jordan,
      price_unconfirmed: false,
    },
    {
      ticket_id: CASH_TICKET_IDS[1],
      kind: "service",
      ref_id: svcMani,
      name_snapshot: "Classic manicure",
      unit_price_cents: 2500,
      qty: 1,
      assigned_staff_id: owner,
      price_unconfirmed: false,
    },
    {
      ticket_id: CASH_TICKET_IDS[1],
      kind: "service",
      ref_id: svcSpa,
      name_snapshot: "Spa pedicure",
      unit_price_cents: 5500,
      qty: 1,
      assigned_staff_id: sam,
      price_unconfirmed: false,
    },
  ]);

  await admin.from("payments").insert([
    {
      ticket_id: CASH_TICKET_IDS[0],
      method: "cash",
      kind: "payment",
      amount_cents: 7500,
      tip_cents: 1350,
      status: "succeeded",
      taken_by_staff_id: jordan,
      processed_at: minutesAgo(40),
    },
    {
      ticket_id: CASH_TICKET_IDS[1],
      method: "cash",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 880,
      status: "succeeded",
      taken_by_staff_id: jordan,
      processed_at: minutesAgo(20),
    },
    {
      ticket_id: CASH_TICKET_IDS[1],
      method: "card",
      kind: "payment",
      amount_cents: 4000,
      tip_cents: 880,
      status: "succeeded",
      taken_by_staff_id: jordan,
      processed_at: minutesAgo(19),
    },
  ]);
}

// Insert one extra cash payment dated "now" for today, attached to a
// fresh ad-hoc paid ticket. Used by the US2 stale-rejection test to
// simulate a cash sale happening between page-load and submit; also
// reused by future specs that need to nudge the expected total.
//
// Returns the ticket id so the caller can clean up if needed (the
// `clearAllTodayPaidTickets()` afterAll path already wipes everything,
// so most callers can ignore it).
async function seedExtraCashPaymentNow(amountCents: number): Promise<string> {
  const admin = adminClient();
  const jordan = "10000000-0000-0000-0000-000000000002";
  const svcMani = "20000000-0000-0000-0000-000000000001";
  const nowIso = new Date().toISOString();

  const { data: ticketRow, error: tErr } = await admin
    .from("tickets")
    .insert({
      status: "paid",
      subtotal_cents: amountCents,
      tax_cents: 0,
      total_cents: amountCents,
      opened_by_staff_id: jordan,
      closed_by_staff_id: jordan,
      closed_at: nowIso,
    })
    .select("id")
    .single();
  if (tErr || !ticketRow) {
    throw new Error(`seedExtraCashPaymentNow: ticket insert failed: ${tErr?.message}`);
  }
  const ticketId = ticketRow.id as string;

  await admin.from("ticket_items").insert({
    ticket_id: ticketId,
    kind: "service",
    ref_id: svcMani,
    name_snapshot: "Classic manicure",
    unit_price_cents: amountCents,
    qty: 1,
    assigned_staff_id: jordan,
    price_unconfirmed: false,
  });

  await admin.from("payments").insert({
    ticket_id: ticketId,
    method: "cash",
    kind: "payment",
    amount_cents: amountCents,
    tip_cents: 0,
    status: "succeeded",
    taken_by_staff_id: jordan,
    processed_at: nowIso,
  });

  return ticketId;
}

test.describe.configure({ mode: "serial" });

test.describe("US1: count + close exact match", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 end-of-day specs (Docker unavailable)."
      );
    }
    // Start from a known-good baseline: clear all today's paid tickets
    // (any residue from upstream checkout-* specs) and re-seed exactly
    // the two cash tickets we expect.
    await clearAllTodayPaidTickets();
    await restoreSeededCashTickets();
    await resetCashDrawerForToday();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    // Leave the DB clean for downstream specs.
    await resetCashDrawerForToday();
    await clearAllTodayPaidTickets();
  });

  test("type expected total → Exact match → Close Out Day → done screen persists → audit row", async ({
    page,
  }) => {
    await signInAsMaya(page, "/end-of-day");
    // Cursor AFTER sign-in so the device.signed_in / staff.signed_in rows
    // don't bleed into the cash_drawer.closed audit assertion.
    const cursor = newAuditCursor();
    await page.reload();

    // Read expected total from the panel footer ("$X.XX").
    const expectedText = await page.locator("[data-slot='eod-foot-amount']").innerText();
    expect(expectedText).toMatch(/^\$\d+\.\d{2}$/);
    const expectedDollars = expectedText.replace(/^\$/, "");
    // Seeded cash today: $75 + $40 = $115.00.
    expect(expectedDollars).toBe("115.00");

    // Type the same amount on the numpad — "115" then "." then "00".
    // The digit characters we need to press, in order.
    const keys = "11500"; // "115.00" — but we tap the '.' explicitly below
    // Press "1" "1" "5"
    await page.locator("[data-slot='eod-key'][data-key='1']").click();
    await page.locator("[data-slot='eod-key'][data-key='1']").click();
    await page.locator("[data-slot='eod-key'][data-key='5']").click();
    await page.locator("[data-slot='eod-key'][data-key='.']").click();
    await page.locator("[data-slot='eod-key'][data-key='0']").click();
    await page.locator("[data-slot='eod-key'][data-key='0']").click();
    // unused — keep the literal so a future failed assertion can trace it
    void keys;

    // Comparison block should report "Exact match".
    await expect(page.getByText("Exact match")).toBeVisible();

    // CTA enabled and clickable.
    const cta = page.locator("[data-slot='eod-close-cta']");
    await expect(cta).toBeEnabled();
    await cta.click();

    // Done screen renders.
    await expect(page.locator("[data-slot='eod-done-screen']")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Day closed out")).toBeVisible();

    // Reload → closed state persists (the done screen stays mounted).
    await page.reload();
    await expect(page.locator("[data-slot='eod-done-screen']")).toBeVisible();

    // Audit: exactly one cash_drawer.closed row written since the cursor.
    const auditRows = await getAuditLogRowsSince(cursor, "cash_drawer.closed");
    expect(auditRows.length).toBe(1);
    const row = auditRows[0]!;
    expect(row.entity_type).toBe("cash_drawer");
    expect(row.entity_id).toBeTruthy();
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    expect(payload.expected_cents).toBe(11500);
    expect(payload.counted_cents).toBe(11500);
    expect(payload.variance_cents).toBe(0);
    // Notes for an exact-match close: empty / null.
    expect(payload.notes === null || payload.notes === "" || payload.notes === undefined).toBe(
      true
    );
    expect(payload.session_id).toBeTruthy();
  });
});

test.describe("US2: variance + note required + close", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 end-of-day specs (Docker unavailable)."
      );
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    // Each US2 sub-test wants a clean Open day with exactly the two seeded
    // cash tickets ($115 expected). beforeEach (not beforeAll) because the
    // stale-rejection test mutates the payment set mid-test.
    await clearAllTodayPaidTickets();
    await restoreSeededCashTickets();
    await resetCashDrawerForToday();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await resetCashDrawerForToday();
    await clearAllTodayPaidTickets();
  });

  // Helper: type a dollar amount like "112.50" onto the numpad.
  async function typeAmount(page: import("@playwright/test").Page, amount: string): Promise<void> {
    for (const ch of amount) {
      await page.locator(`[data-slot='eod-key'][data-key='${ch}']`).click();
    }
  }

  test("short variance with note → confirmation shows variance + italic note + audit row", async ({
    page,
  }) => {
    await signInAsMaya(page, "/end-of-day");
    const cursor = newAuditCursor();
    await page.reload();

    // Expected is $115.00 from the seeded cash tickets. Type $113.00 →
    // short by $2.00.
    const expectedText = await page.locator("[data-slot='eod-foot-amount']").innerText();
    expect(expectedText).toBe("$115.00");

    await typeAmount(page, "113.00");

    // Display border is destructive (state="short").
    await expect(page.locator("[data-slot='eod-display']")).toHaveAttribute("data-state", "short");
    // Comparison shows the short delta with the U+2212 minus glyph.
    await expect(page.getByText("Short")).toBeVisible();
    await expect(page.getByText("−$2.00")).toBeVisible();

    // CTA disabled until a note is typed.
    const cta = page.locator("[data-slot='eod-close-cta']");
    await expect(cta).toBeDisabled();

    // Note textarea visible with the destructive hint.
    const note = page.locator("[data-slot='eod-note']");
    await expect(note).toBeVisible();
    await expect(page.getByText("Required to close out")).toBeVisible();

    // Type a note → CTA enables.
    const noteText = "Two dollar tip discrepancy — investigated.";
    await note.fill(noteText);
    await expect(cta).toBeEnabled();

    await cta.click();

    // Done screen renders with the note rendered as the italic block and
    // the short-tinted Difference row.
    await expect(page.locator("[data-slot='eod-done-screen']")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-slot='eod-done-screen']")).toHaveAttribute(
      "data-state",
      "short"
    );
    await expect(page.getByText(noteText)).toBeVisible();
    await expect(page.locator("[data-slot='eod-done-diff']")).toContainText("−$2.00");

    // Audit row: exactly one cash_drawer.closed with variance_cents=-200
    // and notes==<noteText>.
    const auditRows = await getAuditLogRowsSince(cursor, "cash_drawer.closed");
    expect(auditRows.length).toBe(1);
    const payload = (auditRows[0]!.payload ?? {}) as Record<string, unknown>;
    expect(payload.expected_cents).toBe(11500);
    expect(payload.counted_cents).toBe(11300);
    expect(payload.variance_cents).toBe(-200);
    expect(payload.notes).toBe(noteText);
  });

  test("over variance with note → confirmation shows over + audit row", async ({ page }) => {
    await signInAsMaya(page, "/end-of-day");
    const cursor = newAuditCursor();
    await page.reload();

    const expectedText = await page.locator("[data-slot='eod-foot-amount']").innerText();
    expect(expectedText).toBe("$115.00");

    // Type $118.50 → over by $3.50.
    await typeAmount(page, "118.50");

    await expect(page.locator("[data-slot='eod-display']")).toHaveAttribute("data-state", "over");
    await expect(page.getByText("Over")).toBeVisible();
    await expect(page.getByText("+$3.50")).toBeVisible();

    const cta = page.locator("[data-slot='eod-close-cta']");
    await expect(cta).toBeDisabled();

    const note = page.locator("[data-slot='eod-note']");
    await expect(note).toBeVisible();

    const noteText = "Found extra bill in the drawer.";
    await note.fill(noteText);
    await expect(cta).toBeEnabled();

    await cta.click();

    await expect(page.locator("[data-slot='eod-done-screen']")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-slot='eod-done-screen']")).toHaveAttribute(
      "data-state",
      "over"
    );
    await expect(page.getByText(noteText)).toBeVisible();
    await expect(page.locator("[data-slot='eod-done-diff']")).toContainText("+$3.50");

    const auditRows = await getAuditLogRowsSince(cursor, "cash_drawer.closed");
    expect(auditRows.length).toBe(1);
    const payload = (auditRows[0]!.payload ?? {}) as Record<string, unknown>;
    expect(payload.expected_cents).toBe(11500);
    expect(payload.counted_cents).toBe(11850);
    expect(payload.variance_cents).toBe(350);
    expect(payload.notes).toBe(noteText);
  });

  test("stale rejection → recount banner + no audit row written", async ({ page }) => {
    await signInAsMaya(page, "/end-of-day");
    const cursor = newAuditCursor();
    await page.reload();

    // Read expected — $115.00 from the two seeded cash tickets.
    const expectedText = await page.locator("[data-slot='eod-foot-amount']").innerText();
    expect(expectedText).toBe("$115.00");

    // Type the expected amount exactly so the local match is true.
    await typeAmount(page, "115.00");
    await expect(page.getByText("Exact match")).toBeVisible();

    // Inject an extra cash payment AFTER the page rendered but BEFORE the
    // submit lands. This is the staleness condition — the server's
    // recomputed expected will be $115 + $42.50 = $157.50, so the RPC
    // will reject with cash_drawer_expected_changed.
    await seedExtraCashPaymentNow(4250);

    // Submit — the close action should fail with EXPECTED_CHANGED.
    const cta = page.locator("[data-slot='eod-close-cta']");
    await expect(cta).toBeEnabled();
    await cta.click();

    // Banner appears with the exact spec copy.
    const banner = page.locator("[data-slot='eod-banner']");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveText("A new cash payment was recorded. Please recount the drawer.");

    // No audit row was written for this stale submit.
    const auditRows = await getAuditLogRowsSince(cursor, "cash_drawer.closed");
    expect(auditRows.length).toBe(0);
  });
});

test.describe("US3: numpad correction", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 end-of-day specs (Docker unavailable)."
      );
    }
  });

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    // Same baseline as US1/US2: exactly two seeded cash tickets totalling
    // $115.00 expected, no open cash_drawer session.
    await clearAllTodayPaidTickets();
    await restoreSeededCashTickets();
    await resetCashDrawerForToday();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    await resetCashDrawerForToday();
    await clearAllTodayPaidTickets();
  });

  test("mistype → backspace → clear → retype exactly → caps + decimal-once enforced → submit", async ({
    page,
  }) => {
    await signInAsMaya(page, "/end-of-day");
    const cursor = newAuditCursor();
    await page.reload();

    // Confirm we're on the expected $115.00 baseline.
    const expectedText = await page.locator("[data-slot='eod-foot-amount']").innerText();
    expect(expectedText).toBe("$115.00");

    const display = page.locator("[data-slot='eod-display-val']");
    const clearLink = page.locator("[data-slot='eod-clear']");

    // Mistype: 1, 2, 3 → display reads "123".
    await page.locator("[data-slot='eod-key'][data-key='1']").click();
    await page.locator("[data-slot='eod-key'][data-key='2']").click();
    await page.locator("[data-slot='eod-key'][data-key='3']").click();
    await expect(display).toHaveText("123");
    // Clear link visible once buffer is non-empty.
    await expect(clearLink).toBeVisible();

    // Backspace → "12".
    await page.locator("[data-slot='eod-key'][data-key='back']").click();
    await expect(display).toHaveText("12");

    // Clear → buffer empties, placeholder "0" returns, Counted row shows
    // the em-dash, and the discrepancy textarea unmounts (no eod-note in
    // DOM — comparison state is "empty").
    await clearLink.click();
    await expect(display).toHaveText("0");
    await expect(page.locator("[data-slot='eod-display']")).toHaveAttribute("data-state", "empty");
    await expect(clearLink).toHaveCount(0);
    await expect(page.locator("[data-slot='eod-note']")).toHaveCount(0);

    // Retype the exact expected: 1, 1, 5, ., 0, 0.
    await page.locator("[data-slot='eod-key'][data-key='1']").click();
    await page.locator("[data-slot='eod-key'][data-key='1']").click();
    await page.locator("[data-slot='eod-key'][data-key='5']").click();
    await page.locator("[data-slot='eod-key'][data-key='.']").click();
    await page.locator("[data-slot='eod-key'][data-key='0']").click();
    await page.locator("[data-slot='eod-key'][data-key='0']").click();
    await expect(display).toHaveText("115.00");

    // Decimal-once: tap '.' again → no change.
    await page.locator("[data-slot='eod-key'][data-key='.']").click();
    await expect(display).toHaveText("115.00");

    // Two-decimal cap: tap another digit → no change.
    await page.locator("[data-slot='eod-key'][data-key='9']").click();
    await expect(display).toHaveText("115.00");

    // Comparison shows exact match and CTA is enabled.
    await expect(page.getByText("Exact match")).toBeVisible();
    const cta = page.locator("[data-slot='eod-close-cta']");
    await expect(cta).toBeEnabled();

    // Submit → done screen.
    await cta.click();
    await expect(page.locator("[data-slot='eod-done-screen']")).toBeVisible({ timeout: 10_000 });

    // Audit row sanity — exactly one cash_drawer.closed with the same
    // expected/counted/zero variance.
    const auditRows = await getAuditLogRowsSince(cursor, "cash_drawer.closed");
    expect(auditRows.length).toBe(1);
    const payload = (auditRows[0]!.payload ?? {}) as Record<string, unknown>;
    expect(payload.expected_cents).toBe(11500);
    expect(payload.counted_cents).toBe(11500);
    expect(payload.variance_cents).toBe(0);
  });
});
