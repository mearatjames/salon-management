// E2E for US2 — sidebar "Checkout" resume rule (FR-003).
//
// Covers the five scenarios called out in tasks.md T032:
//   (a) one same-day open ticket → resumed
//   (b) no same-day open ticket → fresh created
//   (c) multiple same-day open tickets → most recently updated wins
//   (d) prior-day open exists but no same-day → fresh created (the
//       prior-day stays open in DB; it is simply not resumed)
//   (e) a discarded ticket from earlier today → fresh created (terminal
//       status is never returned by the resume query)
//
// Resume vs fresh dispatch:
//   - Sidebar "Checkout" link → `/checkout` (no query) → `resumeOrCreateTicket()`
//   - Dashboard CTA           → `/checkout?fresh=1`   → `createEmptyTicket('dashboard_cta')`
//
// Tests mutate `tickets.created_at` and `tickets.status` directly via the
// service-role admin client to simulate cross-day + terminal cases without
// waiting real time. Audit-log assertions use the per-test cursor pattern
// (`newAuditCursor()`) per CLAUDE.md.

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

// Maya Patel — owner — is the seeded operator the rest of the checkout
// suite signs in as. Her staff id is deterministic (see supabase/seed.sql
// and tests/e2e/_db.ts SEEDED_STAFF).
const MAYA_STAFF_ID = "10000000-0000-0000-0000-000000000001";

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

/**
 * Click the sidebar "Checkout" nav item — the entry point this story is
 * exercising. The sidebar renders an anchor with href="/checkout" (no
 * query) per `components/lacquer/sidebar/nav-items.ts`.
 *
 * Falls back to `page.goto('/checkout')` if Playwright cannot find the
 * link (e.g. sidebar collapsed in headless run). Functionally equivalent
 * — both hit the same Server Component dispatcher.
 */
async function navigateSidebarCheckout(page: import("@playwright/test").Page): Promise<void> {
  const link = page.locator('aside.studio-sidebar a[href="/checkout"]').first();
  if ((await link.count()) > 0 && (await link.isVisible())) {
    await link.click();
  } else {
    await page.goto("/checkout");
  }
  // The dispatcher redirects to /checkout/[ticketId]. Wait for that.
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 15_000 });
}

/**
 * Resets the operator's ticket history to a known-clean state by
 * discarding every non-terminal ticket they opened. Cheaper than a full
 * `supabase db reset` between tests, and the discarded rows are correctly
 * skipped by the resume query.
 */
async function discardAllOpenTicketsForOperator(
  admin: SupabaseClient,
  staffId: string
): Promise<void> {
  await admin
    .from("tickets")
    .update({
      status: "discarded",
      closed_at: new Date().toISOString(),
      closed_by_staff_id: staffId,
    })
    .eq("opened_by_staff_id", staffId)
    .eq("status", "open");
}

/**
 * Cleanup helper — turn any tickets created during a test (open or paid)
 * into 'discarded' so the next test starts from a clean slate. Idempotent.
 */
async function cleanupTickets(
  admin: SupabaseClient,
  ticketIds: ReadonlyArray<string>
): Promise<void> {
  const ids = ticketIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return;
  await admin
    .from("tickets")
    .update({
      status: "discarded",
      closed_at: new Date().toISOString(),
      closed_by_staff_id: MAYA_STAFF_ID,
    })
    .in("id", ids);
}

test.describe.configure({ mode: "serial" });

test.describe("US2: sidebar resume vs fresh dispatch", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 resume specs (Docker unavailable)."
      );
    }
  });

  test.beforeEach(async () => {
    // Start each test with no resumable tickets for Maya so the cases
    // under test see a controlled starting roster.
    const admin = adminClient();
    await discardAllOpenTicketsForOperator(admin, MAYA_STAFF_ID);
  });

  test("(a) one same-day open ticket → resumed", async ({ page }) => {
    const admin = adminClient();
    const created: string[] = [];

    await signInAsMaya(page, "/dashboard");

    // Open a fresh ticket via the dashboard CTA (?fresh=1 path).
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const expectedTicketId = new URL(page.url()).pathname.split("/").pop()!;
    created.push(expectedTicketId);

    // Navigate away.
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard(\?|$)/);

    // Click the sidebar Checkout entry → must land on the same ticket.
    await navigateSidebarCheckout(page);
    const resumedTicketId = new URL(page.url()).pathname.split("/").pop()!;
    expect(resumedTicketId).toBe(expectedTicketId);

    await cleanupTickets(admin, created);
  });

  test("(b) no same-day open ticket → fresh created", async ({ page }) => {
    const admin = adminClient();
    const cursor = newAuditCursor();

    await signInAsMaya(page, "/dashboard");

    // Pre-condition is already enforced by beforeEach (no open tickets).
    await navigateSidebarCheckout(page);
    const freshTicketId = new URL(page.url()).pathname.split("/").pop()!;

    // The DB row should exist, status=open, opened by Maya, and the audit
    // row should carry `created_by_entry_point = 'sidebar_resume_or_create'`.
    const { data: row, error } = await admin
      .from("tickets")
      .select("id, status, opened_by_staff_id")
      .eq("id", freshTicketId)
      .single();
    expect(error).toBeNull();
    expect(row!.status).toBe("open");
    expect(row!.opened_by_staff_id).toBe(MAYA_STAFF_ID);

    const auditRows = await getAuditLogRowsSince(cursor, "ticket.created");
    const matching = auditRows.filter((r) => r.entity_id === freshTicketId);
    expect(matching).toHaveLength(1);
    expect((matching[0].payload ?? {}).created_by_entry_point).toBe("sidebar_resume_or_create");

    await cleanupTickets(admin, [freshTicketId]);
  });

  test("(c) multiple same-day open tickets → most-recently-updated wins", async ({ page }) => {
    const admin = adminClient();
    const created: string[] = [];

    await signInAsMaya(page, "/dashboard");

    // Open ticket A via dashboard CTA.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketA = new URL(page.url()).pathname.split("/").pop()!;
    created.push(ticketA);

    // Open ticket B (newer created_at) by going back to /dashboard then
    // dashboard CTA again.
    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const ticketB = new URL(page.url()).pathname.split("/").pop()!;
    created.push(ticketB);
    expect(ticketB).not.toBe(ticketA);

    // Force ticketA to be the most-recently-updated by bumping its
    // updated_at to "now+1s" (later than ticketB's). Bumping via update
    // also exercises the trigger that maintains updated_at.
    const futureMs = Date.now() + 1000;
    const future = new Date(futureMs).toISOString();
    await admin.from("tickets").update({ updated_at: future }).eq("id", ticketA);

    // Sanity: ticketA's updated_at > ticketB's.
    const { data: rows } = await admin
      .from("tickets")
      .select("id, updated_at")
      .in("id", [ticketA, ticketB]);
    const aTs = rows!.find((r) => r.id === ticketA)!.updated_at as string;
    const bTs = rows!.find((r) => r.id === ticketB)!.updated_at as string;
    expect(new Date(aTs).getTime()).toBeGreaterThan(new Date(bTs).getTime());

    // Sidebar Checkout → must resume ticketA (most-recently-updated).
    await page.goto("/dashboard");
    await navigateSidebarCheckout(page);
    const resumedTicketId = new URL(page.url()).pathname.split("/").pop()!;
    expect(resumedTicketId).toBe(ticketA);

    await cleanupTickets(admin, created);
  });

  test("(d) prior-day open exists but no same-day → fresh created", async ({ page }) => {
    const admin = adminClient();
    const created: string[] = [];

    await signInAsMaya(page, "/dashboard");

    // Open a ticket today, then mutate its created_at to yesterday so the
    // resume query's date-window predicate excludes it.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const priorTicketId = new URL(page.url()).pathname.split("/").pop()!;
    created.push(priorTicketId);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await admin.from("tickets").update({ created_at: yesterday }).eq("id", priorTicketId);

    // Sidebar Checkout → must NOT resume the prior-day ticket. A fresh
    // ticket id is returned, and the prior-day row is left untouched.
    await page.goto("/dashboard");
    await navigateSidebarCheckout(page);
    const newTicketId = new URL(page.url()).pathname.split("/").pop()!;
    expect(newTicketId).not.toBe(priorTicketId);
    created.push(newTicketId);

    // Prior-day ticket is still 'open' in the DB.
    const { data: priorRow, error } = await admin
      .from("tickets")
      .select("id, status")
      .eq("id", priorTicketId)
      .single();
    expect(error).toBeNull();
    expect(priorRow!.status).toBe("open");

    await cleanupTickets(admin, created);
  });

  test("(e) discarded earlier today → fresh created", async ({ page }) => {
    const admin = adminClient();
    const created: string[] = [];

    await signInAsMaya(page, "/dashboard");

    // Open a ticket via dashboard CTA, then discard it directly.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}(\?|$)/, { timeout: 10_000 });
    const discardedTicketId = new URL(page.url()).pathname.split("/").pop()!;
    created.push(discardedTicketId);

    await admin
      .from("tickets")
      .update({
        status: "discarded",
        closed_at: new Date().toISOString(),
        closed_by_staff_id: MAYA_STAFF_ID,
      })
      .eq("id", discardedTicketId);

    // Sidebar Checkout → must create a fresh ticket; the discarded one is
    // never returned by the partial index (predicate `status = 'open'`).
    await page.goto("/dashboard");
    await navigateSidebarCheckout(page);
    const newTicketId = new URL(page.url()).pathname.split("/").pop()!;
    expect(newTicketId).not.toBe(discardedTicketId);
    created.push(newTicketId);

    await cleanupTickets(admin, created);
  });
});
