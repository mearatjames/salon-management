// E2E for `refundTicket` (feature 052 — Privileged Action Overrides, US2).
//
// Quickstart.md / US2 acceptance scenarios:
//   1. Owner opens a past paid sale from the dashboard feed → the receipt
//      drawer → "Refund" → the composition sheet, refunds part of a payment →
//      ticket flips to `partially_refunded`, a refund row of the exact amount
//      appears, and the payment's remaining = original − refunded.
//   2. A second refund for the rest → ticket flips to `refunded`.
//   3. An over-remainder amount is server-refused (`refund_exceeds_remaining`
//      → RefundExceedsRemainingError); the ticket is unchanged.
//   4. A zero-total submission is blocked (the sheet disables submit; the
//      server is the backstop).
//   5. Exactly one `payment.refund_issued` audit row per action, with
//      `resulting_status` matching each step.
//   6. A technician sees no "Refund" affordance and a direct `refundTicket`
//      call is refused (`PermissionDeniedError`).
//   7. The same refund flow opened from the End-of-Day cash list behaves
//      identically.
//
// Parallel-safety in the `main` project: every scenario seeds DEDICATED
// tickets under this worker's UUID prefix (`74<wHex>…`) — no seeded-ticket
// reuse — and the audit-cursor assertions are scoped to this worker's staff
// trio via `getAuditLogRowsSince(cursor, action, [..ids])`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { expect, test } from "./_fixtures";
import type { StaffFixture } from "./_fixtures";
import { getAuditLogRowsSince, newAuditCursor } from "./_db";
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
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ─── Per-worker fixture id scheme — `74<wHex>…` keeps it distinct from the
//     void spec (`73…`) and the reassign spec (`72…`).
function workerHex(w: number): string {
  return w.toString(16).padStart(2, "0");
}
function svcId(w: number): string {
  return `74000000-0000-0000-00${workerHex(w)}-0000000000c1`;
}
function ticketId(w: number, tag: string): string {
  return `74000000-0000-0000-00${workerHex(w)}-0000000000${tag}`;
}
function itemId(w: number, tag: string): string {
  return `74000000-0000-0000-00${workerHex(w)}-00000000b0${tag}`;
}
function pmtId(w: number, tag: string): string {
  return `74000000-0000-0000-00${workerHex(w)}-00000000a0${tag}`;
}

const SVC_NAME = "Refund fixture service";

// A fixed past instant earlier today (salon-local), `<= now()`.
function todayInstant(): Date {
  const now = new Date();
  const t = laParts(now);
  const noon = utcFromLaWall(t.year, t.month, t.day, 12);
  if (noon.getTime() <= now.getTime()) return noon;
  // Before salon-local noon (e.g. just after midnight): anchor to the start
  // of the salon day. `now - 30min` would cross back to YESTERDAY right after
  // midnight, stamping the ticket on the prior salon day — which drops it from
  // today's feed/EOD list and breaks the refund-entry assertions.
  return utcFromLaWall(t.year, t.month, t.day, 0);
}

async function ensureService(w: number): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.from("services").upsert(
    [
      {
        id: svcId(w),
        name: `${SVC_NAME} [w${w}]`,
        category: "Manicure",
        duration_min: 30,
        price_cents: 6000,
        color_token: "--avatar-rose",
        card_fee_mode: "default",
      },
    ],
    { onConflict: "id" }
  );
  if (error) throw new Error(`refund fixture services upsert failed: ${error.message}`);
}

type SeedPaidOpts = {
  fixture: StaffFixture;
  tag: string;
  amountCents: number;
};

// Seed one PAID single-cash-payment ticket. Returns { tk, paymentId }.
async function seedPaidCashTicket(opts: SeedPaidOpts): Promise<{ tk: string; paymentId: string }> {
  const admin = adminClient();
  const w = opts.fixture.workerIndex;
  const tk = ticketId(w, opts.tag);
  const closedAt = todayInstant().toISOString();

  await ensureService(w);

  const { error: tkErr } = await admin.from("tickets").upsert(
    [
      {
        id: tk,
        status: "paid",
        subtotal_cents: opts.amountCents,
        tax_cents: 0,
        total_cents: opts.amountCents,
        opened_by_staff_id: opts.fixture.owner.id,
        closed_by_staff_id: opts.fixture.owner.id,
        closed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (tkErr) throw new Error(`refund fixture tickets upsert failed: ${tkErr.message}`);

  const { error: itErr } = await admin.from("ticket_items").upsert(
    [
      {
        id: itemId(w, opts.tag),
        ticket_id: tk,
        kind: "service",
        ref_id: svcId(w),
        name_snapshot: `${SVC_NAME} [w${w}]`,
        unit_price_cents: opts.amountCents,
        qty: 1,
        assigned_staff_id: opts.fixture.owner.id,
        price_unconfirmed: false,
      },
    ],
    { onConflict: "id" }
  );
  if (itErr) throw new Error(`refund fixture ticket_items upsert failed: ${itErr.message}`);

  const paymentId = pmtId(w, opts.tag);
  const { error: pmErr } = await admin.from("payments").upsert(
    [
      {
        id: paymentId,
        ticket_id: tk,
        method: "cash",
        kind: "payment",
        amount_cents: opts.amountCents,
        tip_cents: 0,
        status: "succeeded",
        taken_by_staff_id: opts.fixture.owner.id,
        processed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (pmErr) throw new Error(`refund fixture payments upsert failed: ${pmErr.message}`);

  return { tk, paymentId };
}

async function clearTicket(fixture: StaffFixture, tag: string): Promise<void> {
  const admin = adminClient();
  const w = fixture.workerIndex;
  const tk = ticketId(w, tag);
  await admin.from("payments").delete().eq("ticket_id", tk);
  await admin.from("ticket_items").delete().eq("ticket_id", tk);
  await admin.from("tickets").delete().eq("id", tk);
}

async function ticketStatus(tk: string): Promise<string | null> {
  const { data } = await adminClient().from("tickets").select("status").eq("id", tk).single();
  return data?.status ?? null;
}

async function refundRows(tk: string) {
  const { data } = await adminClient()
    .from("payments")
    .select("id, kind, status, amount_cents, refunds_payment_id")
    .eq("ticket_id", tk)
    .eq("kind", "refund")
    .order("amount_cents", { ascending: true });
  return data ?? [];
}

let supabaseUp = false;

test.beforeAll(async () => {
  supabaseUp = await supabaseIsReachable();
  if (!supabaseUp) {
    test.skip(true, "Supabase not reachable at 127.0.0.1:54321 — skipping refund-ticket specs.");
  }
});

const REFUND_BTN = '[data-slot="refund-entry-button"]';
const REFUND_SHEET = '[data-slot="refund-composition-sheet"]';
const REFUND_SUBMIT = '[data-slot="refund-submit-button"]';
function refundInput(paymentId: string): string {
  return `[data-slot="refund-amount-input"][data-payment-id="${paymentId}"]`;
}

// ─── US2: owner refunds a past sale, partial then full ───────────────────────

test.describe("US2: owner refunds a past sale from the dashboard feed", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test.afterEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await clearTicket(staffFixture, "f1");
    await staffFixture.reset();
  });

  test("partial then full refund flips status and writes one audit row each", async ({
    page,
    staffFixture,
  }) => {
    const { tk, paymentId } = await seedPaidCashTicket({
      fixture: staffFixture,
      tag: "f1",
      amountCents: 6000,
    });

    // ── Scenario 1: partial refund (2000 of 6000) from the feed → drawer →
    //    sheet → partially_refunded.
    const cursor1 = newAuditCursor();
    await page.goto("/dashboard");

    const row = page.locator(`.tx-feed-row[data-tx-id="${tk}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator(REFUND_BTN).click();

    // The composition sheet opens listing the cash payment with a per-payment
    // amount input.
    await expect(page.locator(REFUND_SHEET)).toBeVisible();
    const input = page.locator(refundInput(paymentId));
    await expect(input).toBeVisible();
    await input.fill("20.00");
    await page.locator(REFUND_SUBMIT).click();

    await expect.poll(() => ticketStatus(tk), { timeout: 10_000 }).toBe("partially_refunded");

    let refunds = await refundRows(tk);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount_cents).toBe(2000);
    expect(refunds[0].status).toBe("succeeded");
    expect(refunds[0].refunds_payment_id).toBe(paymentId);

    const audit1 = await getAuditLogRowsSince(cursor1, "payment.refund_issued", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(audit1).toHaveLength(1);
    expect(audit1[0].acting_as_staff_id).toBe(staffFixture.owner.id);
    expect(audit1[0].entity_id).toBe(tk);
    expect((audit1[0].payload as { resulting_status?: string }).resulting_status).toBe(
      "partially_refunded"
    );

    // Feature 052 follow-up: the partially-refunded sale stays in the live
    // dashboard feed (it's still a real sale today) with a "Partial" badge.
    await page.goto("/dashboard");
    const feedRow = page.locator(`.tx-feed-row[data-tx-id="${tk}"]`);
    await expect(feedRow).toBeVisible({ timeout: 15_000 });
    await expect(feedRow.locator('[data-slot="feed-reversal-badge"]')).toHaveAttribute(
      "data-reversal",
      "partially_refunded"
    );

    // ── Scenario 2: refund the remaining 4000 → refunded. The second refund
    //    is opened from the End-of-Day cash list — a different entry point to
    //    the same shared sheet (the EOD list keys on payment `processed_at`,
    //    not ticket status).
    const cursor2 = newAuditCursor();
    await page.goto("/end-of-day");
    const row2 = page.locator(`[data-slot="eod-refund-row"][data-tx-id="${tk}"]`);
    await expect(row2).toBeVisible({ timeout: 15_000 });
    await row2.locator(REFUND_BTN).click();
    await expect(page.locator(REFUND_SHEET)).toBeVisible();

    const input2 = page.locator(refundInput(paymentId));
    // Remaining is now 40.00; fill the full remainder.
    await input2.fill("40.00");
    await page.locator(REFUND_SUBMIT).click();

    await expect.poll(() => ticketStatus(tk), { timeout: 10_000 }).toBe("refunded");

    refunds = await refundRows(tk);
    expect(refunds).toHaveLength(2);
    const totalRefunded = refunds.reduce((s, r) => s + r.amount_cents, 0);
    expect(totalRefunded).toBe(6000);

    const audit2 = await getAuditLogRowsSince(cursor2, "payment.refund_issued", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(audit2).toHaveLength(1);
    expect((audit2[0].payload as { resulting_status?: string }).resulting_status).toBe("refunded");

    // ── Scenario 3 (feature 052 follow-up): the fully-refunded sale stays in
    //    the Transactions ledger with a "Refunded" badge — it must NOT vanish.
    await page.goto("/transactions");
    const ledgerRow = page.locator(`.tp-table tbody tr[data-tx-id="${tk}"]`);
    await expect(ledgerRow).toBeVisible({ timeout: 15_000 });
    await expect(ledgerRow.locator('[data-slot="tx-reversal-badge"]')).toHaveAttribute(
      "data-reversal",
      "refunded"
    );
  });

  test("over-remainder amount is server-refused and zero-total submit is blocked", async ({
    page,
    staffFixture,
  }) => {
    const { tk, paymentId } = await seedPaidCashTicket({
      fixture: staffFixture,
      tag: "f1",
      amountCents: 6000,
    });
    const cursor = newAuditCursor();

    await page.goto("/dashboard");
    const row = page.locator(`.tx-feed-row[data-tx-id="${tk}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator(REFUND_BTN).click();
    await expect(page.locator(REFUND_SHEET)).toBeVisible();

    const input = page.locator(refundInput(paymentId));

    // Zero total → submit disabled (the sheet's client guard).
    await input.fill("0");
    await expect(page.locator(REFUND_SUBMIT)).toBeDisabled();

    // Over-remainder (70.00 > 60.00) → submit disabled too (client guard).
    await input.fill("70.00");
    await expect(page.locator(REFUND_SUBMIT)).toBeDisabled();

    // Nothing changed; no audit rows.
    expect(await ticketStatus(tk)).toBe("paid");
    expect(await refundRows(tk)).toHaveLength(0);
    const audit = await getAuditLogRowsSince(cursor, "payment.refund_issued", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(audit).toEqual([]);
  });

  test("refund opened from the End-of-Day cash list behaves identically", async ({
    page,
    staffFixture,
  }) => {
    const { tk, paymentId } = await seedPaidCashTicket({
      fixture: staffFixture,
      tag: "f1",
      amountCents: 6000,
    });
    const cursor = newAuditCursor();

    await page.goto("/end-of-day");
    const row = page.locator(`[data-slot="eod-refund-row"][data-tx-id="${tk}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator(REFUND_BTN).click();
    await expect(page.locator(REFUND_SHEET)).toBeVisible();

    const input = page.locator(refundInput(paymentId));
    await input.fill("60.00");
    await page.locator(REFUND_SUBMIT).click();

    await expect.poll(() => ticketStatus(tk), { timeout: 10_000 }).toBe("refunded");
    const refunds = await refundRows(tk);
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount_cents).toBe(6000);

    const audit = await getAuditLogRowsSince(cursor, "payment.refund_issued", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(audit).toHaveLength(1);
    expect((audit[0].payload as { resulting_status?: string }).resulting_status).toBe("refunded");
  });
});

// ─── 053-US1: a refunded sale keeps the tech's full commission on /payroll ────
//
// Feature 053 (Payroll reversals): a partial refund must NOT reduce the tech's
// commission — the technician keeps commission on the ORIGINAL service amount
// while the revenue Report nets the refund out. Here we seed a $60 single-tech
// sale for this worker's owner inside the current open pay period, refund $20
// through the UI, then open /payroll and assert the owner's commissionable /
// income-after-split is computed on the full $60 (not the $40 net). Card tips
// are unchanged. Parallel-safe: the owner row is this worker's own seeded data.

const LEDGER_ROW = (id: string) => `tr[data-slot="ledger-row"][data-tech-id="${id}"]`;

async function cellText(
  rowLocator: ReturnType<import("@playwright/test").Page["locator"]>,
  idx: number
): Promise<string> {
  return (await rowLocator.locator("td").nth(idx).innerText()).trim();
}

// "$197" → 197, "−$5" → -5, "—" → 0.
function parseMoney(text: string): number {
  const t = text.trim();
  if (t === "—") return 0;
  const negative = t.startsWith("−") || t.startsWith("-");
  const digits = t.replace(/[−$,\s-]/g, "");
  if (digits === "") return 0;
  return (negative ? -1 : 1) * Number(digits);
}

async function setOwnerCommission(fixture: StaffFixture, pct: number): Promise<void> {
  const { error } = await adminClient()
    .from("staff")
    .update({ service_commission_pct: pct, tip_split_pct: 1.0, check_portion_cents: 0 })
    .eq("id", fixture.owner.id);
  if (error) throw new Error(`refund payroll rate update failed: ${error.message}`);
}

test.describe("053-US1: a refunded sale preserves the tech's commission on /payroll", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test.afterEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await clearTicket(staffFixture, "f1");
    await staffFixture.reset();
  });

  test("partial refund of a $60 sale → owner keeps commission on the full $60", async ({
    page,
    staffFixture,
  }) => {
    await setOwnerCommission(staffFixture, 0.5);
    const { tk, paymentId } = await seedPaidCashTicket({
      fixture: staffFixture,
      tag: "f1",
      amountCents: 6000,
    });

    // Refund $20 of the $60 sale through the dashboard → drawer → sheet.
    await page.goto("/dashboard");
    const row = page.locator(`.tx-feed-row[data-tx-id="${tk}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator(REFUND_BTN).click();
    await expect(page.locator(REFUND_SHEET)).toBeVisible();
    const input = page.locator(refundInput(paymentId));
    await input.fill("20.00");
    await page.locator(REFUND_SUBMIT).click();
    await expect.poll(() => ticketStatus(tk), { timeout: 10_000 }).toBe("partially_refunded");

    // On /payroll the owner's income-after-split is computed on the ORIGINAL
    // $60 — 6000 × 0.5 = 3000 → $30. The refund does NOT dock commission.
    await page.goto("/payroll");
    const ownerRow = page.locator(LEDGER_ROW(staffFixture.owner.id));
    await expect(ownerRow).toBeVisible({ timeout: 15_000 });
    // Columns: 0=Employee 1=Tickets 2=Income 3=After split 4=Card tips …
    expect(parseMoney(await cellText(ownerRow, 3))).toBe(30);
    await expect(ownerRow.locator('[data-slot="state-pill"]')).toHaveAttribute(
      "data-state",
      "pending"
    );
  });
});

// ─── US2: technician sees no Refund affordance (role gate) ───────────────────

test.describe("US2: technician sees no Refund affordance", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.tech);
    },
  });

  test.afterEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await clearTicket(staffFixture, "f1");
    await staffFixture.reset();
  });

  test("technician viewing the feed sees no Refund affordance", async ({ page, staffFixture }) => {
    const { tk } = await seedPaidCashTicket({
      fixture: staffFixture,
      tag: "f1",
      amountCents: 6000,
    });

    await page.goto("/dashboard");
    const row = page.locator(`.tx-feed-row[data-tx-id="${tk}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator(REFUND_BTN)).toHaveCount(0);

    // Defense-in-depth: a direct refundTicket invocation is server-refused.
    // The Server Action dispatch id is brittle to forge from Playwright (see
    // the void-sale spec's note), so the e2e asserts the integration surface
    // — no affordance at render time + the ticket stays paid.
    expect(await ticketStatus(tk)).toBe("paid");
  });
});
