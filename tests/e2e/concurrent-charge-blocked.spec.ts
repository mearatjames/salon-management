// tests/e2e/concurrent-charge-blocked.spec.ts
//
// US2 — FR-022 enforcement. Two browser contexts open the same ticket and
// both compose / try to activate split-tender legs. The second context's
// activation hits the partial-unique-index `payments_one_in_flight_per_ticket_idx`
// (raised as Postgres 23505) and the action surfaces
// `TicketAlreadyBeingChargedError` — the UI renders the spec's "Ticket is
// already being charged on another device" copy.
//
// The race is engineered by parking a `'pending'` row server-side first
// (mimicking a card or gift leg already in flight from device A) and then
// attempting an activation from device B. Square is not involved in this
// path — we exercise the DB-side guard directly.

import { type Page } from "@playwright/test";
import { expect, test } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

test.use({
  storageState: async ({ authState }, provide) => {
    await provide(authState.owner);
  },
});

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

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

test.describe.configure({ mode: "serial" });

test.describe("US2: concurrent charge blocked", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(true, "Supabase not reachable — skipping concurrent-charge spec.");
      return;
    }
  });

  test("US2: a second device's compose attempt is refused while a leg is pending", async ({
    browser,
    authState,
  }) => {
    if (!supabaseUp) test.skip();
    const ownerStatePath = authState.owner;
    const supabase = serviceClient();

    // 1) Resolve Maya's staff id (used as the operator).
    const { data: maya } = await supabase
      .from("staff")
      .select("id")
      .eq("display_name", "Maya Patel")
      .single();
    const ownerId = maya!.id;

    // 2) Create a fresh open ticket directly (skip the UI dashboard step
    //    to keep the test focused on the race).
    const { data: ticket, error: tkErr } = await supabase
      .from("tickets")
      .insert({
        opened_by_staff_id: ownerId,
        status: "open",
        subtotal_cents: 4000,
        tax_cents: 0,
        total_cents: 4000,
      })
      .select("id")
      .single();
    if (tkErr || !ticket) throw new Error(`seed ticket failed: ${tkErr?.message}`);
    const ticketId = ticket.id;

    // 3) Seed a service line so the ticket isn't "empty" from RPC guards.
    await supabase.from("ticket_items").insert({
      ticket_id: ticketId,
      kind: "service",
      ref_id: "20000000-0000-0000-0000-000000000003", // Classic pedicure ($40)
      assigned_staff_id: ownerId,
      name_snapshot: "Classic pedicure",
      unit_price_cents: 4000,
      qty: 1,
      price_unconfirmed: false,
    });

    // 4) Park a pending card-payment row on the ticket — mimics device A
    //    having already tapped "Send to terminal" with the card leg.
    const { error: pendErr } = await supabase.from("payments").insert({
      ticket_id: ticketId,
      method: "card",
      kind: "payment",
      amount_cents: 4000,
      status: "pending",
      taken_by_staff_id: ownerId,
    });
    if (pendErr) throw new Error(`seed pending payment failed: ${pendErr.message}`);

    try {
      // 5) Device B opens the ticket. Per FR-022, any cart edit OR draft
      //    compose must refuse while a pending leg exists. We pick the
      //    cart-edit path (addServiceLine) because it surfaces
      //    `TicketAlreadyBeingChargedError` via the cart's error banner
      //    using copy "Ticket is already being charged on another device".
      // Second context loaded from the same worker's owner storageState —
      // the spec is exercising two concurrent requests, not two distinct
      // operators, so sharing the owner cookie is correct.
      const ctxB = await browser.newContext({ storageState: ownerStatePath });
      const pageB = await ctxB.newPage();
      await pageB.goto(`/checkout/${ticketId}`);
      await pageB.waitForURL(new RegExp(`/checkout/${ticketId}`), { timeout: 10_000 });

      // 6) Wait for the page to render (cart island ready).
      await expect(pageB.locator("[data-slot='checkout-shell']")).toBeVisible({
        timeout: 10_000,
      });

      // 7) Attempt to add another service line — the discardDraftLegs
      //    prelude in addServiceLine refuses with
      //    TicketAlreadyBeingChargedError. The seed line was assigned to
      //    Maya, so the tech-row collapses to "Change"; we don't need to
      //    re-pick a tech. Tapping a service tile uses the currently-
      //    selected tech.
      await pageB
        .locator(
          "[data-slot='service-tile'][data-service-id='20000000-0000-0000-0000-000000000001']"
        )
        .click();

      // 8) Cart-error banner appears with the spec's copy.
      await expect(pageB.locator("[data-slot='checkout-error-banner']")).toBeVisible({
        timeout: 10_000,
      });
      await expect(pageB.locator("[data-slot='checkout-error-banner']")).toContainText(
        "Ticket is already being charged on another device"
      );

      await ctxB.close();
    } finally {
      // 8) Cleanup the seeded rows so subsequent runs don't pile up.
      await supabase.from("payments").delete().eq("ticket_id", ticketId);
      await supabase.from("ticket_items").delete().eq("ticket_id", ticketId);
      await supabase.from("tickets").delete().eq("id", ticketId);
    }
  });
});
