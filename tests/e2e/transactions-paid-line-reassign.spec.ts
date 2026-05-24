// E2E for `reassignPaidLineTech` (feature 050) — US1 happy path.
//
// Mirrors quickstart.md §1: sign in as owner → open today's paid ticket →
// click "Change" on a service line → pick a different active tech → assert
// chip updates → reload drawer → assert persists → assert exactly one
// `ticket.line_tech_reassigned` audit row was written since the cursor →
// assert the payroll ledger row's per-tech ticket count moved.
//
// Runs in the parallel `main` Playwright project. Self-seeds its own paid
// ticket with this worker's UUID prefix (`72<wHex>-…`) and assigns the
// line to the worker's manager initially; the test reassigns it to the
// worker's owner. The audit-cursor + worker-staff filter keeps the
// "exactly one new audit row" assertion concurrency-safe (see
// `tests/e2e/_db.ts` § getAuditLogRowsSince).

import { expect, test } from "./_fixtures";
import type { StaffFixture } from "./_fixtures";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { clearPayoutById, getAuditLogRowsSince, newAuditCursor, seedPayoutForPeriod } from "./_db";
import { laParts, utcFromLaWall } from "./_la-time";
import { payPeriodForClosedAt } from "@/lib/payroll/finalized";

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

// A fixed past instant earlier today (salon-local), inside the current
// week + pay period and `<= now()`.
function todayInstant(): Date {
  const now = new Date();
  const t = laParts(now);
  const noon = utcFromLaWall(t.year, t.month, t.day, 12);
  return noon.getTime() <= now.getTime() ? noon : new Date(now.getTime() - 30 * 60_000);
}

// ─── Per-worker fixture id scheme — `72<wHex>…` keeps it distinct from the
//     transactions spec (`60…`/`61…`) and the payroll spec (`71…`). ─────────
function workerHex(w: number): string {
  return w.toString(16).padStart(2, "0");
}
function svcId(w: number): string {
  return `72000000-0000-0000-00${workerHex(w)}-0000000000c1`;
}
function ticketId(w: number): string {
  return `72000000-0000-0000-00${workerHex(w)}-0000000000e1`;
}
function itemId(w: number): string {
  return `72000000-0000-0000-00${workerHex(w)}-0000000000f1`;
}
function pmtId(w: number): string {
  return `72000000-0000-0000-00${workerHex(w)}-00000000a001`;
}

const ITEM_NAME = "Reassign fixture service";

async function seedPaidTicket(fixture: StaffFixture): Promise<void> {
  const admin = adminClient();
  const w = fixture.workerIndex;
  const closedAt = todayInstant().toISOString();

  // Payroll rates on the trio so the payroll ledger row exists for the
  // reassignment-target verification (assigned to manager initially).
  for (const id of [fixture.owner.id, fixture.manager.id]) {
    const { error } = await admin
      .from("staff")
      .update({
        service_commission_pct: 0.9,
        tip_split_pct: 1.0,
        check_portion_cents: 0,
      })
      .eq("id", id);
    if (error) throw new Error(`reassign fixture rate update failed: ${error.message}`);
  }

  // Self-owned service so the line has a valid ref_id.
  const { error: svcErr } = await admin.from("services").upsert(
    [
      {
        id: svcId(w),
        name: `${ITEM_NAME} [w${w}]`,
        category: "Manicure",
        duration_min: 30,
        price_cents: 5000,
        color_token: "--avatar-rose",
        card_fee_mode: "default",
      },
    ],
    { onConflict: "id" }
  );
  if (svcErr) throw new Error(`reassign fixture services insert failed: ${svcErr.message}`);

  // One paid ticket, closed earlier today; assigned to MANAGER initially.
  const { error: tkErr } = await admin.from("tickets").upsert(
    [
      {
        id: ticketId(w),
        status: "paid",
        subtotal_cents: 5000,
        tax_cents: 0,
        total_cents: 5000,
        opened_by_staff_id: fixture.owner.id,
        closed_by_staff_id: fixture.owner.id,
        closed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (tkErr) throw new Error(`reassign fixture tickets insert failed: ${tkErr.message}`);

  const { error: itErr } = await admin.from("ticket_items").upsert(
    [
      {
        id: itemId(w),
        ticket_id: ticketId(w),
        kind: "service",
        ref_id: svcId(w),
        name_snapshot: `${ITEM_NAME} [w${w}]`,
        unit_price_cents: 5000,
        qty: 1,
        assigned_staff_id: fixture.manager.id,
        price_unconfirmed: false,
      },
    ],
    { onConflict: "id" }
  );
  if (itErr) throw new Error(`reassign fixture ticket_items insert failed: ${itErr.message}`);

  const { error: pmErr } = await admin.from("payments").upsert(
    [
      {
        id: pmtId(w),
        ticket_id: ticketId(w),
        method: "cash",
        kind: "payment",
        amount_cents: 5000,
        tip_cents: 0,
        status: "succeeded",
        taken_by_staff_id: fixture.owner.id,
        processed_at: closedAt,
      },
    ],
    { onConflict: "id" }
  );
  if (pmErr) throw new Error(`reassign fixture payments insert failed: ${pmErr.message}`);
}

async function clearPaidTicket(fixture: StaffFixture): Promise<void> {
  const admin = adminClient();
  const w = fixture.workerIndex;
  await admin.from("payments").delete().eq("ticket_id", ticketId(w));
  await admin.from("ticket_items").delete().eq("ticket_id", ticketId(w));
  await admin.from("tickets").delete().eq("id", ticketId(w));
  await admin.from("services").delete().eq("id", svcId(w));
}

let supabaseUp = false;

test.beforeAll(async () => {
  supabaseUp = await supabaseIsReachable();
  if (!supabaseUp) {
    test.skip(
      true,
      "Supabase not reachable at 127.0.0.1:54321 — skipping reassign specs (Docker unavailable)."
    );
  }
});

test.afterEach(async ({ staffFixture }) => {
  if (!supabaseUp) return;
  await clearPaidTicket(staffFixture);
  await staffFixture.reset();
});

// ─── Test helper — temporarily flip a fixture member's role for one test.
//
// The shared `_fixtures.ts` provisions an owner / manager / technician trio
// per worker; the suite has no front-desk fixture today. Rather than
// extending the fixture for one assertion, we mutate the worker's tech
// staff row's `role` column inline (the operator cookie holds `sid`, not
// the role — `requireStudioSession` re-reads `role` from `staff` on every
// request, so the next page render reflects the new value). `afterEach`'s
// `staffFixture.reset()` already restores the trio's canonical state.
async function setWorkerTechRole(
  fixture: StaffFixture,
  role: "technician" | "front_desk"
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.from("staff").update({ role }).eq("id", fixture.tech.id);
  if (error) throw new Error(`setWorkerTechRole(${role}) failed: ${error.message}`);
}

// ─── US2: technician + front-desk see no affordance and are rejected ─────────
//
// Spec coverage: FR-003, FR-012 (a), FR-014, SC-005, SC-007.
//
// What we assert:
//   1. A technician session that navigates to `/transactions` is bounced
//      to `/dashboard` by the page-level role guard at
//      `app/(studio)/transactions/page.tsx` lines 36–38. The chip is
//      therefore unreachable for non-privileged roles — "no affordance"
//      (SC-005, SC-007) holds at the route level, before the chip would
//      have a chance to render.
//   2. Same for a front-desk session (we flip the worker's tech to
//      role='front_desk' inline; see `setWorkerTechRole` above).
//   3. After both render-time attempts, the `audit_log` cursor (scoped to
//      this worker's trio) shows zero `ticket.line_tech_reassigned` rows.
//      No write was issued, no rejection-time audit row was written
//      (FR-012 (a)).
//
// Note on the direct-call assertion: Server Actions are dispatched via a
// `Next-Action` header whose value is a bundler-generated id; forging that
// header from a Playwright fixture is brittle and couples the test to
// internal RSC framing. We follow the precedent set by `services.spec.ts`
// lines 1323–1348 — the server gate is exhaustively covered by the unit
// tests in `tests/unit/transactions/reassign-paid-line-tech.test.ts` US2
// (which assert `PermissionDeniedError` for each non-privileged role +
// zero side effects). The e2e here covers the *integration* surface:
// the page redirect, the chip's absence at render time, and the audit-log
// invariant after the navigation attempts.

test.describe("US2: technician and front-desk see no affordance and are rejected on direct call", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.tech);
    },
  });

  test("technician is redirected away from /transactions and writes no audit row", async ({
    page,
    staffFixture,
  }) => {
    await seedPaidTicket(staffFixture);
    const cursor = newAuditCursor();

    await page.goto("/transactions");
    // Page-level role guard at `app/(studio)/transactions/page.tsx` ll.
    // 36–38: technicians are bounced to `/dashboard`. The chip is
    // unreachable; "no affordance" (SC-005, SC-007) holds at the route
    // level, defense-in-depth above the chip's own mode-1 render branch.
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 5_000 });
    expect(page.url()).toMatch(/\/dashboard(\?|$)/);

    // No Change trigger anywhere in the rendered DOM (the chip never
    // mounts because `/transactions` never renders).
    await expect(page.locator('[data-slot="receipt-line-tech-change"]')).toHaveCount(0);

    // FR-012 (a): zero audit rows since cursor for this worker's trio.
    const auditRows = await getAuditLogRowsSince(cursor, "ticket.line_tech_reassigned", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(auditRows).toEqual([]);
  });

  test("front-desk is redirected away from /transactions and writes no audit row", async ({
    page,
    staffFixture,
  }) => {
    await seedPaidTicket(staffFixture);
    // Flip the worker's tech to front_desk for the duration of this test.
    // The operator cookie holds `sid` (the staff id); the role is re-read
    // from `staff` on every request — no re-sign-in needed.
    await setWorkerTechRole(staffFixture, "front_desk");
    const cursor = newAuditCursor();

    await page.goto("/transactions");
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 5_000 });
    expect(page.url()).toMatch(/\/dashboard(\?|$)/);

    await expect(page.locator('[data-slot="receipt-line-tech-change"]')).toHaveCount(0);

    const auditRows = await getAuditLogRowsSince(cursor, "ticket.line_tech_reassigned", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(auditRows).toEqual([]);

    // `afterEach` -> staffFixture.reset() restores role='technician'.
  });
});

// ─── US1: owner reassigns ────────────────────────────────────────────────────

test.describe("US1: owner reassigns", () => {
  test.use({
    storageState: async ({ authState }, provide) => {
      await provide(authState.owner);
    },
  });

  test("owner reassigns a paid service line and the chip + audit log + payroll ledger reflect the move", async ({
    page,
    staffFixture,
  }) => {
    await seedPaidTicket(staffFixture);
    const txId = ticketId(staffFixture.workerIndex);

    const cursor = newAuditCursor();

    // 1. Open Transactions → click the seeded row → drawer opens.
    await page.goto("/transactions");

    const row = page.locator(`tr[data-tx-id="${txId}"]`);
    await expect(row).toBeVisible();
    await row.click();

    const drawer = page.locator(`[data-slot="receipt-drawer"][data-tx-id="${txId}"]`);
    await expect(drawer).toBeVisible();

    // 2. The line carries the manager's chip + a Change trigger (owner viewer,
    //    open pay period).
    const lineChip = drawer.locator('[data-slot="receipt-line-tech-chip"]').first();
    await expect(lineChip).toBeVisible();
    await expect(lineChip).toHaveAttribute("data-staff-id", staffFixture.manager.id);

    const changeTrigger = drawer.locator('[data-slot="receipt-line-tech-change"]').first();
    await expect(changeTrigger).toBeVisible();

    // 3. Open the Popover → owner item is listed → click it.
    await changeTrigger.click();
    const popoverItem = page
      .locator(
        `[data-slot="receipt-line-tech-popover-item"][data-staff-id="${staffFixture.owner.id}"]`
      )
      .first();
    await expect(popoverItem).toBeVisible();
    await popoverItem.click();

    // 4. The chip updates to the owner within a few hundred ms.
    await expect(lineChip).toHaveAttribute("data-staff-id", staffFixture.owner.id, {
      timeout: 5_000,
    });

    // 5. Close + reopen the drawer; the chip still points at the owner
    //    (persistence — server-authoritative).
    await page.locator('[data-slot="receipt-drawer-close"]').click();
    await expect(drawer).toHaveCount(0);

    await row.click();
    const reopened = page.locator(`[data-slot="receipt-drawer"][data-tx-id="${txId}"]`);
    await expect(reopened).toBeVisible();
    const reopenedChip = reopened.locator('[data-slot="receipt-line-tech-chip"]').first();
    await expect(reopenedChip).toHaveAttribute("data-staff-id", staffFixture.owner.id);

    // 6. Exactly one new audit row since the cursor, scoped to this worker's
    //    trio (concurrency-safe). Payload matches FR-011.
    const auditRows = await getAuditLogRowsSince(cursor, "ticket.line_tech_reassigned", [
      staffFixture.owner.id,
      staffFixture.manager.id,
      staffFixture.tech.id,
    ]);
    expect(auditRows).toHaveLength(1);
    const audit = auditRows[0];
    expect(audit.acting_as_staff_id).toBe(staffFixture.owner.id);
    expect(audit.entity_id).toBe(itemId(staffFixture.workerIndex));
    expect(audit.payload).toMatchObject({
      ticket_id: txId,
      previous_staff_id: staffFixture.manager.id,
      new_staff_id: staffFixture.owner.id,
    });

    // 7. Payroll page — the owner ledger row now shows 1 ticket; the manager
    //    row shows 0.
    await page.goto("/payroll");
    const ownerRow = page.locator(
      `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.owner.id}"]`
    );
    const managerRow = page.locator(
      `tr[data-slot="ledger-row"][data-tech-id="${staffFixture.manager.id}"]`
    );
    await expect(ownerRow).toBeVisible();
    await expect(managerRow).toBeVisible();
    // Column index 1 is the "Tickets" cell (Employee=0, Tickets=1).
    const ownerTickets = await ownerRow.locator("td").nth(1).innerText();
    const managerTickets = await managerRow.locator("td").nth(1).innerText();
    expect(ownerTickets.trim()).toBe("1");
    // Manager has no ticket now → either "—" (no_work) or "0". The
    // page's StatePill / cellText uses `formatCount(0)` or em-dash for
    // zero. Accept either.
    expect(managerTickets.trim()).toMatch(/^(—|0)$/);
  });
});

// ─── US3: finalized period locks the surface ─────────────────────────────────
//
// Spec coverage: FR-002, FR-004, FR-012 (c), SC-004.
//
// Seed a `payroll_payouts` row for the current pay period (the one
// containing the seeded paid ticket's `closed_at`) scoped to this worker's
// owner. That flips `isPayPeriodFinalized` to `true` for the period — the
// `<ReceiptLineTechChip>` then renders in mode 3 for every role: a leading
// Lock icon, a Tooltip with the FR-004 copy, and NO "Change" trigger.
//
// What we assert:
//   (a) Owner session → opens the drawer → zero `data-slot="receipt-
//       line-tech-change"` nodes; N chips with `data-locked="true"` (one
//       per service line — the seed has 1 line so N=1); hover the chip →
//       the Radix Tooltip portal renders with the EXACT FR-004 copy.
//   (b) Manager session → same assertions.
//   (c) The audit-log cursor for this worker's trio shows zero
//       `ticket.line_tech_reassigned` rows — no write happened.
//
// Direct-call assertion deferred to the unit suite — mirrors Phase 4's
// approach (`services.spec.ts:1323–1348` precedent): forging the bundler-
// generated `Next-Action` header from Playwright is brittle. The
// `PayPeriodFinalizedError` + zero-side-effects case in
// `tests/unit/transactions/reassign-paid-line-tech.test.ts` US3 covers
// the server gate exhaustively. The e2e here covers the integration
// surface — UI absence + tooltip copy + audit-log invariant.
//
// Cleanup in `afterEach` deletes the seeded payout by id so a rerun starts
// clean. The shared `pay_periods` row is intentionally left in place
// (other specs lazily depend on it).

test.describe("US3: finalized period locks the surface", () => {
  // Each test seeds its own payout (and stores the id for teardown).
  let seededPayoutIds: string[] = [];

  async function seedFinalizingPayout(fixture: StaffFixture): Promise<void> {
    // The seeded ticket's closed_at sits in the same period this resolves —
    // `seedPaidTicket` uses `todayInstant()` so both land in the same
    // half-month window.
    const TZ = "America/Los_Angeles";
    const closedAt = todayInstant();
    const period = payPeriodForClosedAt(TZ, closedAt);
    const { payoutId } = await seedPayoutForPeriod({
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      payDate: period.payDate,
      staffId: fixture.owner.id,
      recordedByStaffId: fixture.owner.id,
    });
    seededPayoutIds.push(payoutId);
  }

  test.afterEach(async () => {
    if (!supabaseUp) return;
    for (const id of seededPayoutIds) {
      await clearPayoutById(id);
    }
    seededPayoutIds = [];
  });

  test.describe("as owner", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.owner);
      },
    });

    test("owner sees Lock + tooltip, no Change trigger, no audit row", async ({
      page,
      staffFixture,
    }) => {
      await seedPaidTicket(staffFixture);
      await seedFinalizingPayout(staffFixture);
      const txId = ticketId(staffFixture.workerIndex);
      const cursor = newAuditCursor();

      await page.goto("/transactions");
      const row = page.locator(`tr[data-tx-id="${txId}"]`);
      await expect(row).toBeVisible();
      await row.click();

      const drawer = page.locator(`[data-slot="receipt-drawer"][data-tx-id="${txId}"]`);
      await expect(drawer).toBeVisible();

      // (a) zero Change triggers anywhere in the drawer.
      await expect(drawer.locator('[data-slot="receipt-line-tech-change"]')).toHaveCount(0);

      // (a) N Lock-bearing chips — N=1 for the seeded ticket (one service line).
      const lockedChips = drawer.locator(
        '[data-slot="receipt-line-tech-chip"][data-locked="true"]'
      );
      await expect(lockedChips).toHaveCount(1);

      // Hover the chip → Radix Tooltip portal renders with EXACT FR-004 copy.
      await lockedChips.first().hover();
      // The Radix Tooltip portal mounts a `data-slot="tooltip-content"` div
      // with the FR-004 copy. Filter by `hasText` so a stale tooltip portal
      // from a different surface (table-row tooltip, etc.) can't satisfy
      // the locator with the wrong text.
      const tooltip = page
        .locator('[data-slot="tooltip-content"]', {
          hasText: "Payouts for this pay period have been finalized.",
        })
        .first();
      await expect(tooltip).toBeVisible({ timeout: 5_000 });
      // Strict char assertion against the user-visible copy. The Radix
      // TooltipContent renders the children twice — once visibly, once
      // wrapped in `VisuallyHiddenPrimitive.Root` with `role="tooltip"`
      // for screen readers (node_modules/@radix-ui/react-tooltip/dist/
      // index.mjs:350 — both are children of the same
      // `data-slot="tooltip-content"` div). We sum visible text-node
      // content only, excluding the visually-hidden mirror.
      const visibleText = await tooltip.evaluate((el) => {
        let out = "";
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            out += child.textContent ?? "";
          } else if (
            child.nodeType === Node.ELEMENT_NODE &&
            (child as Element).getAttribute("role") !== "tooltip"
          ) {
            // Element children that aren't the VisuallyHidden mirror —
            // e.g. the TooltipPrimitive.Arrow svg/span (no text). Their
            // textContent contributes nothing to the visible copy.
            out += (child as Element).textContent ?? "";
          }
        }
        return out.trim();
      });
      expect(visibleText).toBe("Payouts for this pay period have been finalized.");

      // (c) zero audit rows since cursor, scoped to this worker's trio.
      const auditRows = await getAuditLogRowsSince(cursor, "ticket.line_tech_reassigned", [
        staffFixture.owner.id,
        staffFixture.manager.id,
        staffFixture.tech.id,
      ]);
      expect(auditRows).toEqual([]);
    });
  });

  test.describe("as manager", () => {
    test.use({
      storageState: async ({ authState }, provide) => {
        await provide(authState.manager);
      },
    });

    test("manager sees Lock + tooltip, no Change trigger, no audit row", async ({
      page,
      staffFixture,
    }) => {
      await seedPaidTicket(staffFixture);
      await seedFinalizingPayout(staffFixture);
      const txId = ticketId(staffFixture.workerIndex);
      const cursor = newAuditCursor();

      await page.goto("/transactions");
      const row = page.locator(`tr[data-tx-id="${txId}"]`);
      await expect(row).toBeVisible();
      await row.click();

      const drawer = page.locator(`[data-slot="receipt-drawer"][data-tx-id="${txId}"]`);
      await expect(drawer).toBeVisible();

      // (b) zero Change triggers — manager is privileged but the period is
      //     finalized, so canEdit must be false.
      await expect(drawer.locator('[data-slot="receipt-line-tech-change"]')).toHaveCount(0);

      const lockedChips = drawer.locator(
        '[data-slot="receipt-line-tech-chip"][data-locked="true"]'
      );
      await expect(lockedChips).toHaveCount(1);

      await lockedChips.first().hover();
      const tooltip = page
        .locator('[data-slot="tooltip-content"]', {
          hasText: "Payouts for this pay period have been finalized.",
        })
        .first();
      await expect(tooltip).toBeVisible({ timeout: 5_000 });
      // See owner test for why we sum visible text-nodes only.
      const visibleText = await tooltip.evaluate((el) => {
        let out = "";
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            out += child.textContent ?? "";
          } else if (
            child.nodeType === Node.ELEMENT_NODE &&
            (child as Element).getAttribute("role") !== "tooltip"
          ) {
            out += (child as Element).textContent ?? "";
          }
        }
        return out.trim();
      });
      expect(visibleText).toBe("Payouts for this pay period have been finalized.");

      // (c) zero audit rows.
      const auditRows = await getAuditLogRowsSince(cursor, "ticket.line_tech_reassigned", [
        staffFixture.owner.id,
        staffFixture.manager.id,
        staffFixture.tech.id,
      ]);
      expect(auditRows).toEqual([]);
    });
  });
});
