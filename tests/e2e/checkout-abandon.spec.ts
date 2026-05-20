// tests/e2e/checkout-abandon.spec.ts
//
// Feature 043-checkout-ephemeral-draft — User Story 2:
// "Abandon an unsubmitted checkout with no residue."
//
// The in-progress checkout cart is an ephemeral in-memory draft — nothing
// is written to the DB while the operator builds the cart. Leaving
// checkout before payment must therefore leave ZERO database residue
// (FR-017/FR-018), and the header's two exit buttons collapse into one
// context-aware control (FR-019/FR-020): in ephemeral mode it is labeled
// "Cancel" and simply navigates to /dashboard with no DB effect.
//
// Scenarios:
//   (a) open /checkout, add several services then remove them, click the
//       consolidated exit control ("Cancel") → /dashboard → zero ticket /
//       ticket_item / payment / audit residue.
//   (b) open /checkout, add nothing, leave via the exit control → DB
//       unchanged.
//   (c) open /checkout, build a partial cart, navigate away WITHOUT the
//       exit control (page.goto('/dashboard')) → still no residue.
//   (d) after an abandon the dashboard daily counts / activity feed are
//       unaffected.
//
// Race-safety: the local Supabase stack is shared with parallel Claude
// Code sessions, so a global `select count(*) from tickets` would race
// against sibling specs. Two scoping layers make every assertion here
// race-free:
//   - the per-test audit-log cursor (`newAuditCursor()` /
//     `getAuditLogRowsSince()`) — only rows written after this test's
//     cursor are considered; and
//   - filtering to THIS worker's owner `actor_user_id` — the
//     worker-scoped fixture in `_fixtures.ts` gives each worker a
//     distinct owner auth user, so a sibling worker's real ticket /
//     discard rows (different `actor_user_id`) never count as residue
//     here. A `ticket.created` audit row is written by
//     `pos_create_ticket_from_draft` whenever a ticket is persisted, so
//     "zero residue rows for our operator since the cursor" is a
//     reliable proxy for "this operator created/touched no ticket."
//
// Describe name uses "US2" so `-g "US2"` filters this spec.

import { expect, test } from "./_fixtures";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

const SUPABASE_HEALTH_URL = "http://127.0.0.1:54321/auth/v1/health";

// Audit actions that would prove DB residue from building/abandoning a
// cart. Any one of these appearing since the cursor means the ephemeral
// draft leaked into the database.
const RESIDUE_ACTIONS = [
  "ticket.created",
  "ticket.line_added",
  "ticket.line_removed",
  "payment.captured",
  "payment.initiated",
  "ticket.discarded",
];

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

// Assert no checkout-residue audit rows were written since `cursor` by
// `actorUserId` (this worker's owner). Filtering on the actor keeps the
// assertion race-free against sibling workers' real sales/discards.
async function expectNoResidueSince(cursor: string, actorUserId: string): Promise<void> {
  const rows = await getAuditLogRowsSince(cursor);
  const residue = rows.filter(
    (r) => r.actor_user_id === actorUserId && RESIDUE_ACTIONS.includes(r.action)
  );
  expect(
    residue,
    `expected zero checkout-residue audit rows after abandoning an ephemeral cart, ` +
      `found: ${residue.map((r) => r.action).join(", ")}`
  ).toHaveLength(0);
}

test.describe.configure({ mode: "serial" });

test.describe("US2: abandon an unsubmitted checkout with no residue", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 abandon spec (Docker unavailable)."
      );
    }
  });

  test("(a) add then remove services, click Cancel → /dashboard, zero DB residue", async ({
    page,
    staffFixture,
  }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();
    const ownerUserId = staffFixture.owner.userId!;

    await page.goto("/dashboard");

    // Open the paramless /checkout — an ephemeral in-memory draft. The URL
    // stays /checkout (no /checkout/[ticketId]) while the cart is built.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await expect(page.locator("[data-slot='checkout-shell']")).toHaveAttribute(
      "data-ephemeral",
      "true"
    );

    // Pick a tech so the cart can take service lines.
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();

    // Add several services.
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000002']")
      .click();
    await expect(page.locator("[data-slot='cart-line']")).toHaveCount(2);

    // Remove them all again — back to an empty draft.
    const firstRemove = page.locator("[data-slot='cart-line-remove']").first();
    await firstRemove.click();
    await expect(page.locator("[data-slot='cart-line']")).toHaveCount(1);
    await page.locator("[data-slot='cart-line-remove']").first().click();
    await expect(page.locator("[data-slot='cart-line']")).toHaveCount(0);

    // Click the consolidated exit control. In ephemeral mode it is labeled
    // "Cancel" and just routes to /dashboard with no DB effect.
    const exit = page.locator("[data-slot='checkout-exit-control']");
    await expect(exit).toBeVisible();
    await expect(exit).toContainText(/Cancel/i);
    await exit.click();
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    // Zero residue: no ticket / line / payment / discard audit rows.
    await expectNoResidueSince(cursor, ownerUserId);
  });

  test("(b) open /checkout, add nothing, click Cancel → DB unchanged", async ({
    page,
    staffFixture,
  }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();
    const ownerUserId = staffFixture.owner.userId!;

    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await expect(page.locator("[data-slot='checkout-shell']")).toHaveAttribute(
      "data-ephemeral",
      "true"
    );

    // Leave immediately via the exit control without touching the cart.
    const exit = page.locator("[data-slot='checkout-exit-control']");
    await expect(exit).toContainText(/Cancel/i);
    await exit.click();
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    await expectNoResidueSince(cursor, ownerUserId);
  });

  test("(c) build a partial cart then navigate away (no exit control) → no residue", async ({
    page,
    staffFixture,
  }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();
    const ownerUserId = staffFixture.owner.userId!;

    await page.goto("/dashboard");
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });

    // Build a partial cart.
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='cart-line']")).toHaveCount(1);

    // Navigate away WITHOUT the exit control — a hard goto, the same as
    // tapping a sidebar link or closing the tab. The ephemeral draft is
    // discarded with the page; nothing was ever persisted.
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    await expectNoResidueSince(cursor, ownerUserId);
  });

  test("(d) after an abandon the dashboard feed / daily counts are unaffected", async ({
    page,
    staffFixture,
  }) => {
    if (!supabaseUp) test.skip();
    const cursor = newAuditCursor();
    const ownerUserId = staffFixture.owner.userId!;

    await page.goto("/dashboard");
    // The dashboard recent-transactions feed is present (empty or seeded).
    // Scope to the real feed — `loading.tsx` renders an `aria-hidden`
    // skeleton with the same data-slot as the Suspense fallback.
    const feed = page.locator("[data-slot='recent-transactions-feed']:not([aria-hidden='true'])");
    await expect(feed).toBeVisible();

    // Open checkout, build a cart, abandon it via the exit control.
    await page.locator("[data-slot='new-transaction-cta']").click();
    await page.waitForURL(/\/checkout$/, { timeout: 10_000 });
    await page.locator("[data-slot='checkout-tech-row'] [data-staff-name='Jordan Lee']").click();
    await page
      .locator("[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']")
      .click();
    await expect(page.locator("[data-slot='cart-line']")).toHaveCount(1);

    const exit = page.locator("[data-slot='checkout-exit-control']");
    await exit.click();
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 10_000 });

    // The feed is still there and the abandon produced no transaction row.
    // Asserting zero `ticket.created` audit rows since the cursor is the
    // race-free proxy for "no new entry appeared in the activity feed /
    // daily transaction count" — a literal count of feed rows would race
    // against parallel workers' real sales.
    await expect(feed).toBeVisible();
    const createdRows = (await getAuditLogRowsSince(cursor, "ticket.created")).filter(
      (r) => r.actor_user_id === ownerUserId
    );
    expect(
      createdRows,
      "abandoning an ephemeral cart must add no ticket.created row — the dashboard feed/counts stay unaffected"
    ).toHaveLength(0);
  });
});
