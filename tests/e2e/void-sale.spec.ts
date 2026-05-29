// E2E for `voidSale` (feature 052 — Privileged Action Overrides, US1).
//
// Quickstart.md §§1–5:
//   1. Owner voids a same-day cash sale from the paid DoneScreen → ticket
//      flips to `void`, a mirrored `kind='refund'` row appears, and exactly
//      one `payment.void_issued` audit row is written (acting_as_staff_id =
//      the acting owner).
//   2. A split cash + card sale produces a refund row per original payment
//      (the card leg settles through the Square server stub's /v2/refunds).
//   3. A technician sees no "Void sale" affordance on the same paid ticket.
//   4. An already-voided ticket offers no re-void.
//   5. A prior-day paid ticket offers no void (refund path only).
//
// Parallel-safety in the `main` project: every scenario seeds DEDICATED
// tickets under this worker's UUID prefix (`73<wHex>…`) — no seeded-ticket
// reuse — and the audit-cursor assertions are scoped to this worker's staff
// trio via `getAuditLogRowsSince(cursor, action, [..ids])`. The split
// cash+card scenario needs a connected Square, so it runs serially under the
// shared Square server-stub lock.

import { type Page, type BrowserContext } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { expect, test } from "./_fixtures";
import type { StaffFixture } from "./_fixtures";
import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { laParts, utcFromLaWall, shiftDays } from "./_la-time";
import {
  acquireStubLock,
  getStubControls,
  releaseStubLock,
  type ServerStubControls,
} from "./_square-server-stub";

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

// ─── Per-worker fixture id scheme — `73<wHex>…` keeps it distinct from the
//     reassign spec (`72…`) and the transactions spec (`60…`/`61…`). The last
//     hex pair tags the scenario so the four `main`-project tickets coexist.
function workerHex(w: number): string {
  return w.toString(16).padStart(2, "0");
}
function svcId(w: number): string {
  return `73000000-0000-0000-00${workerHex(w)}-0000000000c1`;
}
function ticketId(w: number, tag: string): string {
  return `73000000-0000-0000-00${workerHex(w)}-0000000000${tag}`;
}
function itemId(w: number, tag: string): string {
  return `73000000-0000-0000-00${workerHex(w)}-00000000b0${tag}`;
}
function pmtId(w: number, tag: string): string {
  return `73000000-0000-0000-00${workerHex(w)}-00000000a0${tag}`;
}

const SVC_NAME = "Void fixture service";

// A fixed past instant earlier today (salon-local), `<= now()`.
function todayInstant(): Date {
  const now = new Date();
  const t = laParts(now);
  const noon = utcFromLaWall(t.year, t.month, t.day, 12);
  if (noon.getTime() <= now.getTime()) return noon;
  // Before salon-local noon (e.g. just after midnight): anchor to the start
  // of the salon day. `now - 30min` would cross back to YESTERDAY right after
  // midnight, stamping the ticket on the prior salon day — which hides the
  // same-day void affordance and drops the ticket from today's feed/EOD list.
  return utcFromLaWall(t.year, t.month, t.day, 0);
}

// A fixed instant yesterday (salon-local) noon — the prior-day case.
function yesterdayInstant(): Date {
  const t = laParts(new Date());
  const y = shiftDays(t.year, t.month, t.day, -1);
  return utcFromLaWall(y.year, y.month, y.day, 12);
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
        price_cents: 5000,
        color_token: "--avatar-rose",
        card_fee_mode: "default",
      },
    ],
    { onConflict: "id" }
  );
  if (error) throw new Error(`void fixture services upsert failed: ${error.message}`);
}

type SeedPaidOpts = {
  fixture: StaffFixture;
  tag: string;
  closedAt: Date;
  // One or more payment legs. Cash legs settle immediately; card legs carry
  // a `squarePaymentId` so the void path can issue a Square refund.
  legs: Array<{ method: "cash" | "card"; amountCents: number; squarePaymentId?: string }>;
};

// Seed one PAID ticket (single service line assigned to the worker's owner)
// with the requested payment legs. Returns the ticket id.
async function seedPaidTicket(opts: SeedPaidOpts): Promise<string> {
  const admin = adminClient();
  const w = opts.fixture.workerIndex;
  const tk = ticketId(w, opts.tag);
  const closedAt = opts.closedAt.toISOString();
  const total = opts.legs.reduce((s, l) => s + l.amountCents, 0);

  await ensureService(w);

  const { error: tkErr } = await admin.from("tickets").upsert(
    [
      {
        id: tk,
        status: "paid",
        subtotal_cents: total,
        tax_cents: 0,
        total_cents: total,
        opened_by_staff_id: opts.fixture.owner.id,
        closed_by_staff_id: opts.fixture.owner.id,
        closed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (tkErr) throw new Error(`void fixture tickets upsert failed: ${tkErr.message}`);

  const { error: itErr } = await admin.from("ticket_items").upsert(
    [
      {
        id: itemId(w, opts.tag),
        ticket_id: tk,
        kind: "service",
        ref_id: svcId(w),
        name_snapshot: `${SVC_NAME} [w${w}]`,
        unit_price_cents: total,
        qty: 1,
        assigned_staff_id: opts.fixture.owner.id,
        price_unconfirmed: false,
      },
    ],
    { onConflict: "id" }
  );
  if (itErr) throw new Error(`void fixture ticket_items upsert failed: ${itErr.message}`);

  const rows = opts.legs.map((leg, i) => ({
    id: pmtId(w, `${opts.tag}${i}`.slice(-2)),
    ticket_id: tk,
    method: leg.method,
    kind: "payment" as const,
    amount_cents: leg.amountCents,
    tip_cents: 0,
    status: "succeeded" as const,
    taken_by_staff_id: opts.fixture.owner.id,
    processed_at: closedAt,
    square_payment_id: leg.squarePaymentId ?? null,
  }));
  const { error: pmErr } = await admin.from("payments").upsert(rows, { onConflict: "id" });
  if (pmErr) throw new Error(`void fixture payments upsert failed: ${pmErr.message}`);

  return tk;
}

async function clearTicket(fixture: StaffFixture, tag: string): Promise<void> {
  const admin = adminClient();
  const w = fixture.workerIndex;
  const tk = ticketId(w, tag);
  await admin.from("payments").delete().eq("ticket_id", tk);
  await admin.from("ticket_items").delete().eq("ticket_id", tk);
  await admin.from("tickets").delete().eq("id", tk);
}

// Mark a paid ticket already-voided (insert one refund leg + flip status) so
// the "no re-void" case has a void-eligibility blocker present.
async function markAlreadyVoided(fixture: StaffFixture, tag: string): Promise<void> {
  const admin = adminClient();
  const w = fixture.workerIndex;
  const tk = ticketId(w, tag);
  const { data: pay } = await admin
    .from("payments")
    .select("id, method, amount_cents")
    .eq("ticket_id", tk)
    .eq("kind", "payment")
    .limit(1)
    .single();
  await admin.from("payments").insert({
    ticket_id: tk,
    method: pay!.method,
    kind: "refund",
    amount_cents: pay!.amount_cents,
    tip_cents: 0,
    status: "succeeded",
    taken_by_staff_id: fixture.owner.id,
    refunds_payment_id: pay!.id,
  });
  await admin.from("tickets").update({ status: "void" }).eq("id", tk);
}

let supabaseUp = false;

test.beforeAll(async () => {
  supabaseUp = await supabaseIsReachable();
  if (!supabaseUp) {
    test.skip(true, "Supabase not reachable at 127.0.0.1:54321 — skipping void-sale specs.");
  }
});

const VOID_BTN = '[data-slot="void-sale-button"]';
const VOID_CONFIRM = '[data-slot="void-confirm-button"]';

// ─── US1: owner voids a same-day cash sale ───────────────────────────────────

test.describe("US1: owner voids a same-day cash sale", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test.afterEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await clearTicket(staffFixture, "e1");
    await staffFixture.reset();
  });

  test("owner voids a same-day cash ticket → status void, refund row, one audit row", async ({
    page,
    staffFixture,
  }) => {
    const admin = adminClient();
    const tk = await seedPaidTicket({
      fixture: staffFixture,
      tag: "e1",
      closedAt: todayInstant(),
      legs: [{ method: "cash", amountCents: 5000 }],
    });
    const cursor = newAuditCursor();

    await page.goto(`/checkout/${tk}`);

    // The owner sees the "Void sale" affordance on the paid DoneScreen.
    await expect(page.locator(VOID_BTN)).toBeVisible();
    await page.locator(VOID_BTN).click();

    // Confirm the full reversal in the dialog.
    await expect(page.locator(VOID_CONFIRM)).toBeVisible();
    await page.locator(VOID_CONFIRM).click();

    // The ticket flips to `void` and a mirrored refund row appears.
    await expect
      .poll(
        async () => {
          const { data } = await admin.from("tickets").select("status").eq("id", tk).single();
          return data?.status ?? null;
        },
        { timeout: 10_000 }
      )
      .toBe("void");

    // After the void's router.refresh() the page must render the read-only
    // reversed notice — NOT the editable open-cart (which would re-open the
    // ticket and miscount the refund row as a second payment leg).
    await expect(page.locator('[data-slot="checkout-reversed"]')).toBeVisible();
    await expect(page.locator('[data-slot="checkout-reversed"]')).toHaveAttribute(
      "data-reversal-status",
      "void"
    );
    await expect(page.locator('[data-slot="checkout-paid"]')).toHaveCount(0);

    const { data: refunds } = await admin
      .from("payments")
      .select("id, kind, status, amount_cents, refunds_payment_id")
      .eq("ticket_id", tk)
      .eq("kind", "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds![0].status).toBe("succeeded");
    expect(refunds![0].amount_cents).toBe(5000);
    expect(refunds![0].refunds_payment_id).toBeTruthy();

    // Exactly one `payment.void_issued` audit row scoped to this worker's
    // trio, with acting_as_staff_id = the acting owner.
    const auditRows = await getAuditLogRowsSince(cursor, "payment.void_issued", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].acting_as_staff_id).toBe(staffFixture.owner.id);
    expect(auditRows[0].entity_id).toBe(tk);
  });

  test("already-voided ticket offers no re-void affordance", async ({ page, staffFixture }) => {
    const tk = await seedPaidTicket({
      fixture: staffFixture,
      tag: "e1",
      closedAt: todayInstant(),
      legs: [{ method: "cash", amountCents: 5000 }],
    });
    await markAlreadyVoided(staffFixture, "e1");

    await page.goto(`/checkout/${tk}`);

    // A void ticket renders the read-only reversed notice — not the paid
    // DoneScreen (no void affordance) and NOT the editable open-cart.
    await expect(page.locator('[data-slot="checkout-reversed"]')).toBeVisible();
    await expect(page.locator('[data-slot="checkout-reversed"]')).toHaveAttribute(
      "data-reversal-status",
      "void"
    );
    await expect(page.locator(VOID_BTN)).toHaveCount(0);
    await expect(page.locator('[data-slot="checkout-paid"]')).toHaveCount(0);
  });

  test("prior-day paid ticket offers no void affordance", async ({ page, staffFixture }) => {
    const tk = await seedPaidTicket({
      fixture: staffFixture,
      tag: "e1",
      closedAt: yesterdayInstant(),
      legs: [{ method: "cash", amountCents: 5000 }],
    });

    await page.goto(`/checkout/${tk}`);

    // Paid DoneScreen renders, but the ticket closed yesterday → no void.
    await expect(page.locator('[data-slot="done-screen"]')).toBeVisible();
    await expect(page.locator(VOID_BTN)).toHaveCount(0);
  });
});

// ─── US1: technician sees no affordance (role gate) ──────────────────────────
//
// The DoneScreen renders the void affordance only for owner/manager. A
// technician viewing the same same-day paid ticket sees no button. The
// server-side role gate (`voidSale` throws `PermissionDeniedError` for a
// non-privileged role before any DB work) is enforced in
// `app/(studio)/checkout/actions.ts`; Server Actions dispatch via a
// bundler-generated `Next-Action` id that's brittle to forge from
// Playwright, so the e2e asserts the integration surface — no affordance at
// render time + zero audit rows after the navigation (precedent:
// `transactions-paid-line-reassign.spec.ts` US2).

test.describe("US1: technician sees no Void sale affordance", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.tech);
    },
  });

  test.afterEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await clearTicket(staffFixture, "e1");
    await staffFixture.reset();
  });

  test("technician viewing a same-day paid ticket sees no void affordance", async ({
    page,
    staffFixture,
  }) => {
    const tk = await seedPaidTicket({
      fixture: staffFixture,
      tag: "e1",
      closedAt: todayInstant(),
      legs: [{ method: "cash", amountCents: 5000 }],
    });
    const cursor = newAuditCursor();

    await page.goto(`/checkout/${tk}`);

    await expect(page.locator('[data-slot="done-screen"]')).toBeVisible();
    await expect(page.locator(VOID_BTN)).toHaveCount(0);

    // No void was issued — zero audit rows for this worker's trio.
    const auditRows = await getAuditLogRowsSince(cursor, "payment.void_issued", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(auditRows).toEqual([]);
  });
});

// ─── US1: split cash + card → a refund row per payment ───────────────────────
//
// Needs a connected Square so the card refund leg settles through the
// server stub's /v2/refunds handler. Runs serially under the shared stub
// lock; seeds its own card payment with a known `square_payment_id`.

test.describe.configure({ mode: "serial" });

test.describe("US1: split cash + card void issues a refund per payment", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  let serverStub: ServerStubControls;

  test.beforeAll(async () => {
    if (!supabaseUp) return;
    await acquireStubLock();
    serverStub = getStubControls();
  });

  test.afterAll(async () => {
    if (!supabaseUp) return;
    releaseStubLock();
  });

  test.afterEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await clearTicket(staffFixture, "e2");
    await clearSquareTables();
    await staffFixture.reset();
  });

  async function clearSquareTables(): Promise<void> {
    const c = adminClient();
    await c.from("square_devices").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await c.from("square_oauth").delete().eq("id", true);
  }

  async function connectSquareViaStub(
    page: Page,
    context: BrowserContext,
    baseURL: string
  ): Promise<void> {
    await context.route(
      (url) =>
        url.hostname === "connect.squareupsandbox.com" &&
        url.pathname.startsWith("/oauth2/authorize"),
      (route) => {
        const url = new URL(route.request().url());
        const state = url.searchParams.get("state") ?? "";
        const callback = new URL("/settings/square/callback", baseURL);
        callback.searchParams.set("code", "stub-auth-code");
        callback.searchParams.set("state", state);
        return route.fulfill({
          status: 302,
          headers: { location: callback.toString() },
          body: "",
        });
      }
    );
    await page.goto("/settings/square");
    await expect(page.getByTestId("square-connect-button")).toBeVisible();
    await page.getByTestId("square-connect-button").click();
    await expect(page.getByText(/Connected to Stub Salon/i)).toBeVisible({ timeout: 15_000 });
  }

  test.beforeEach(async () => {
    if (!supabaseUp) return;
    await serverStub.reset();
    await serverStub.setMerchant({ id: "MERCHANT_STUB", business_name: "Stub Salon" });
    await serverStub.setDevices([{ id: "device:STUB_VOID", name: "Lobby", status: "PAIRED" }]);
    await clearSquareTables();
  });

  test("voiding a cash + card ticket creates one refund row per original payment", async ({
    page,
    context,
    baseURL,
    staffFixture,
  }) => {
    const admin = adminClient();

    // 1) Connect Square so the card refund leg can settle through the stub.
    await connectSquareViaStub(page, context, baseURL!);

    // 2) Seed a split cash($2000) + card($3000) paid ticket today. The card
    //    leg carries a square_payment_id the refund path reverses.
    const tk = await seedPaidTicket({
      fixture: staffFixture,
      tag: "e2",
      closedAt: todayInstant(),
      legs: [
        { method: "cash", amountCents: 2000 },
        { method: "card", amountCents: 3000, squarePaymentId: "pay_void_card_stub" },
      ],
    });
    const cursor = newAuditCursor();

    // 3) Void from the paid DoneScreen.
    await page.goto(`/checkout/${tk}`);
    await expect(page.locator(VOID_BTN)).toBeVisible();
    await page.locator(VOID_BTN).click();
    await expect(page.locator(VOID_CONFIRM)).toBeVisible();
    await page.locator(VOID_CONFIRM).click();

    // 4) Ticket flips to void; one refund row per original payment (2), both
    //    succeeded (cash immediately; card after the stub refund settles).
    await expect
      .poll(
        async () => {
          const { data } = await admin.from("tickets").select("status").eq("id", tk).single();
          return data?.status ?? null;
        },
        { timeout: 15_000 }
      )
      .toBe("void");

    const { data: refunds } = await admin
      .from("payments")
      .select("method, status, amount_cents, refunds_payment_id, square_refund_id")
      .eq("ticket_id", tk)
      .eq("kind", "refund")
      .order("amount_cents", { ascending: true });
    expect(refunds).toHaveLength(2);
    for (const r of refunds!) {
      expect(r.status).toBe("succeeded");
      expect(r.refunds_payment_id).toBeTruthy();
    }
    const cardRefund = refunds!.find((r) => r.method === "card");
    expect(cardRefund?.square_refund_id).toBeTruthy();

    const auditRows = await getAuditLogRowsSince(cursor, "payment.void_issued", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(auditRows).toHaveLength(1);
  });
});
