// E2E for Settings → Staff "Pay & deductions" section
// (specs/023-staff-payout-exemptions).
//
// Mirrors the Supabase-reachable / serial / per-test audit-cursor pattern
// from `tests/e2e/staff.spec.ts`. The cursor pattern from `_db.ts`
// (`newAuditCursor()` + `getAuditLogRowsSince()`) lets us run with
// `workers > 1` — global truncation would race across spec files that
// share the `audit_log` table.

import { createClient } from "@supabase/supabase-js";

import { getAuditLogRowsSince, newAuditCursor } from "./_db";
import { test, expect, signInAs } from "./_fixtures";

// ── Supply-types test helpers ─────────────────────────────────────────────
//
// US2 needs to seed/cleanup supply_types + services rows directly. The
// shared `_db.ts` helpers cover staff + audit_log; everything supply-related
// is local to this spec.

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "staff-payout-exemptions.spec.ts: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Wipe every supply_type + service row (other than the seeded set) so each
 * US2 test starts from a known catalog. Services first (FK on supply_type_id),
 * then supply_types. Filter on `created_at >= EPOCH` is a no-op — we delete
 * everything; the seeded migration repopulates whatever the original seed
 * defined when the test suite next runs `supabase db reset`.
 *
 * The seed (supabase/seed.sql) does NOT define supply_types or services, so a
 * full wipe is safe: nothing seeded is lost. If that changes, this helper
 * will need to exclude the seed ids.
 */
// Track only what this spec inserts so cleanup is surgical — wiping the
// entire catalog would race with `services-deductions.spec.ts` (and any
// other spec that touches supply_types) under parallel workers.
const SEEDED_SUPPLY_TYPE_IDS = new Set<string>();
const SEEDED_SERVICE_IDS = new Set<string>();

/** Insert a supply_type row and return its id. Tracked in
 *  `SEEDED_SUPPLY_TYPE_IDS` so the per-test cleanup can target only what
 *  this spec wrote.
 *
 *  Conflict-recovery: a previous crashed test run may have left a row with
 *  the same canonical name + archived=false. If insert hits the partial
 *  unique constraint we look the existing row up and reuse its id (which
 *  also registers it for cleanup). This keeps the spec self-healing across
 *  reruns without forcing a `supabase db reset` between runs. */
async function seedSupplyType(name: string, archived = false): Promise<string> {
  const c = adminClient();
  const { data, error } = await c
    .from("supply_types")
    .insert({ name, archived })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505" || error.message.includes("supply_types_name_active_uq")) {
      const canonical = name.trim().toLowerCase().replace(/\s+/g, " ");
      const { data: existing, error: selErr } = await c
        .from("supply_types")
        .select("id")
        .eq("name_canonical", canonical)
        .maybeSingle();
      if (selErr || !existing) {
        throw new Error(
          `seedSupplyType("${name}") collided + lookup failed: ${selErr?.message ?? "no row"}`
        );
      }
      const id = (existing as { id: string }).id;
      if (archived) {
        await c.from("supply_types").update({ archived: true }).eq("id", id);
      } else {
        await c.from("supply_types").update({ archived: false }).eq("id", id);
      }
      SEEDED_SUPPLY_TYPE_IDS.add(id);
      return id;
    }
    throw new Error(`seedSupplyType("${name}") failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(`seedSupplyType("${name}") returned no row`);
  }
  const id = (data as { id: string }).id;
  SEEDED_SUPPLY_TYPE_IDS.add(id);
  return id;
}

/**
 * Insert a service row that references the given supply_type. Used to give
 * the picker a non-zero `service_count` + a sample amount so the usage hint
 * renders the expected text.
 */
async function seedService(args: {
  name: string;
  supplyTypeId: string;
  amountCents: number;
  active?: boolean;
}): Promise<void> {
  const c = adminClient();
  const { data, error } = await c
    .from("services")
    .insert({
      name: args.name,
      category: "Other",
      duration_min: 30,
      price_cents: 5000,
      color_token: "--avatar-rose",
      taxable: true,
      active: args.active ?? true,
      supply_type_id: args.supplyTypeId,
      supply_amount_cents: args.amountCents,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedService("${args.name}") failed: ${error?.message ?? "no row"}`);
  }
  SEEDED_SERVICE_IDS.add((data as { id: string }).id);
}

/**
 * Drop everything this spec inserted (services first, then supply_types) and
 * reset every staff's supply_mode/supply_except back to default. Idempotent —
 * runs from beforeEach so each test starts at a clean baseline regardless of
 * what the prior test wrote.
 *
 * Reset of `staff.supply_except` is needed so a stale tick referencing a
 * supply_type from a previous test doesn't fire the FK-existence trigger
 * when that type is deleted in step 1.
 */
async function resetSupplyCatalog(): Promise<void> {
  const c = adminClient();

  // 1. Reset every staff's supply fields. Cheap; only the 3 seeded rows
  // exist plus anything the Add wizard tests created (which other beforeEach
  // hooks also clean up). Use a tautological filter on created_at since
  // PostgREST requires a WHERE clause.
  const EPOCH = "1970-01-01T00:00:00.000Z";
  const { error: staffErr } = await c
    .from("staff")
    .update({ supply_mode: "apply", supply_except: [] })
    .gte("created_at", EPOCH);
  if (staffErr) {
    throw new Error(`staff supply-fields reset failed: ${staffErr.message}`);
  }

  // 2. Delete only the services + supply_types this spec seeded.
  const serviceIds = Array.from(SEEDED_SERVICE_IDS);
  if (serviceIds.length > 0) {
    const { error: serviceErr } = await c.from("services").delete().in("id", serviceIds);
    if (serviceErr) {
      throw new Error(`services cleanup failed: ${serviceErr.message}`);
    }
    SEEDED_SERVICE_IDS.clear();
  }
  const typeIds = Array.from(SEEDED_SUPPLY_TYPE_IDS);
  if (typeIds.length > 0) {
    // Detach any non-spec services that may still reference these ids (defensive).
    await c
      .from("services")
      .update({ supply_type_id: null, supply_amount_cents: null })
      .in("supply_type_id", typeIds);
    const { error: typesErr } = await c.from("supply_types").delete().in("id", typeIds);
    if (typesErr) {
      throw new Error(`supply_types cleanup failed: ${typesErr.message}`);
    }
    SEEDED_SUPPLY_TYPE_IDS.clear();
  }
}

/** Force the staff's supply_mode + supply_except via the service-role client
 *  (skips the UI). Used by the archived-UX seed path so the test can start
 *  with an already-ticked archived type. */
async function setStaffSupply(args: {
  staffId: string;
  mode: "apply" | "partial" | "exempt";
  except: readonly string[];
}): Promise<void> {
  const c = adminClient();
  const { error } = await c
    .from("staff")
    .update({ supply_mode: args.mode, supply_except: [...args.except] })
    .eq("id", args.staffId);
  if (error) {
    throw new Error(`setStaffSupply failed: ${error.message}`);
  }
}

/** Archive an existing supply_type by setting `archived=true`. */
async function archiveSupplyType(id: string): Promise<void> {
  const c = adminClient();
  const { error } = await c.from("supply_types").update({ archived: true }).eq("id", id);
  if (error) {
    throw new Error(`archiveSupplyType failed: ${error.message}`);
  }
}

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

test.describe.configure({ mode: "serial" });

test.describe("US1: Card-fee exemption", () => {
  let supabaseUp = false;
  let auditCursor = "";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US1 payout-exemptions specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    auditCursor = newAuditCursor();
    await staffFixture.reset();
  });

  test("(a) toggling Card processing fee off saves, flips subtitle, shows toast + badge, writes audit row", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });

    // Open Sam's edit panel directly (the row is a <Link href="?selected=…">).
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);
    await expect(page.locator("[data-slot='staff-edit-panel']")).toBeVisible();

    // Pay & deductions section is mounted; toggle starts ON (fee applies).
    const section = page.locator("[data-slot='pay-deductions-section']");
    await expect(section).toBeVisible();

    const cardFeeRow = page.locator("[data-slot='pay-deductions-card-fee-row']");
    await expect(cardFeeRow).toContainText("Card processing fee");
    // Default (non-exempt) subtitle uses the formatDefaultCardFeeLabel() output
    // ($3) per Clarify Q5.
    await expect(cardFeeRow).toContainText("Standard $3 deducted on card-paid services.");

    const cardFeeSwitch = page.locator("[data-slot='pay-deductions-card-fee-switch']");
    await expect(cardFeeSwitch).toHaveAttribute("data-state", "checked");

    // Flip the toggle OFF — switches to exempt.
    await cardFeeSwitch.click();
    await expect(cardFeeSwitch).toHaveAttribute("data-state", "unchecked");
    await expect(cardFeeRow).toContainText("Exempt — card fee never deducted from payout.");

    // Save.
    await page.locator("[data-slot='edit-panel-save']").click();
    await page.waitForURL(/\/settings\/staff\?selected=.+&toast=changes_saved/, {
      timeout: 10_000,
    });

    // Toast bridge fires "Changes saved".
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("Changes saved");

    // Persisted exempt subtitle + badge.
    await expect(page.locator("[data-slot='pay-deductions-card-fee-row']")).toContainText(
      "Exempt — card fee never deducted from payout."
    );
    await expect(page.locator("[data-slot='staff-status-badge-card-fee-exempt']")).toBeVisible();
    await expect(page.locator("[data-slot='staff-status-badge-card-fee-exempt']")).toContainText(
      "Card-fee exempt"
    );

    // Audit-row assertion (Constitution IV). Exactly one staff.updated row
    // with the card_fee_exempt diff key.
    const rows = await getAuditLogRowsSince(auditCursor, "staff.updated");
    expect(rows).toHaveLength(1);
    const payload = (rows[0].payload ?? {}) as Record<string, unknown>;
    const changes = payload.changes as readonly string[];
    expect(changes).toContain("card_fee_exempt");
    expect(payload.before).toMatchObject({ card_fee_exempt: false });
    expect(payload.after).toMatchObject({ card_fee_exempt: true });
    expect(rows[0].entity_id).toBe(staffFixture.tech.id);
  });
});

test.describe("US2: Supply deductions mode + per-type picker", () => {
  let supabaseUp = false;

  // Per-test seeded catalog. Reset + repopulated in beforeEach so each test
  // gets a deterministic 3-type catalog plus referencing services.
  let chromeId = "";
  let gelXId = "";
  let catEyeId = "";

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US2 payout-exemptions specs (Docker unavailable)."
      );
      return;
    }
  });

  // T068 — final cleanup so the leaked supply_types ("Chrome powder" etc.)
  // don't collide with `supply-types-catalog.spec.ts`'s `seedSupplyType` calls
  // when the full suite runs alphabetically (`staff-…` runs before `supply-…`).
  // The per-test beforeEach reset clears the previous test's rows; this hook
  // sweeps the LAST test's rows on the way out.
  test.afterAll(async () => {
    if (!supabaseUp) return;
    await resetSupplyCatalog();
    // Note: the fixture's trio is reset automatically by the next
    // beforeEach (next file's first test) — no manual reset needed here,
    // and worker-scoped fixtures aren't accessible in afterAll.
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
    await resetSupplyCatalog();

    // Seed the canonical 3-type catalog the spec's independent-test scenario
    // describes (alphabetized: Cat-eye gel, Chrome powder, GelX tips & gel).
    catEyeId = await seedSupplyType("Cat-eye gel");
    chromeId = await seedSupplyType("Chrome powder");
    gelXId = await seedSupplyType("GelX tips & gel");

    // Give each type at least one active referencing service so the picker
    // usage hints render the `${N} services · typically $${X} per ticket`
    // copy. Two services for Chrome powder so the mode-of-amounts is the
    // common one ($5).
    await seedService({ name: "Cat-eye design", supplyTypeId: catEyeId, amountCents: 700 });
    await seedService({ name: "Chrome powder add-on", supplyTypeId: chromeId, amountCents: 500 });
    await seedService({ name: "Chrome powder full set", supplyTypeId: chromeId, amountCents: 500 });
    await seedService({ name: "GelX classic", supplyTypeId: gelXId, amountCents: 1500 });
  });

  test("(b) selecting Some reveals the per-type picker with usage hints, alphabetized", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    // Click "Some" in the segmented toggle.
    await page
      .locator("[data-slot='pay-deductions-supply-mode-toggle'] [data-value='partial']")
      .click();

    const picker = page.locator("[data-slot='pay-deductions-picker']");
    await expect(picker).toBeVisible();

    // Rows render alphabetically by name; each carries a data-name attribute
    // so the test can confirm order without relying on text traversal.
    const rows = picker.locator("[data-slot='pay-deductions-picker-row']");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-name", "Cat-eye gel");
    await expect(rows.nth(1)).toHaveAttribute("data-name", "Chrome powder");
    await expect(rows.nth(2)).toHaveAttribute("data-name", "GelX tips & gel");

    // Usage hints per the spec's format. Cat-eye has 1 service @ $7;
    // Chrome powder has 2 services @ $5 (mode); GelX has 1 service @ $15.
    // The component pluralizes correctly: "1 service" (singular) vs "2 services".
    await expect(rows.nth(0)).toContainText("1 service · typically $7.00 per ticket");
    await expect(rows.nth(1)).toContainText("2 services · typically $5.00 per ticket");
    await expect(rows.nth(2)).toContainText("1 service · typically $15.00 per ticket");
  });

  test("(e) draft preservation: Some -> Apply all -> Some restores prior ticks (Clarify Q4)", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    // Enter Some mode and tick Chrome powder + GelX.
    await page
      .locator("[data-slot='pay-deductions-supply-mode-toggle'] [data-value='partial']")
      .click();
    await page
      .locator("[data-slot='pay-deductions-picker-row'][data-name='Chrome powder']")
      .locator("[data-slot='pay-deductions-picker-checkbox']")
      .click();
    await page
      .locator("[data-slot='pay-deductions-picker-row'][data-name='GelX tips & gel']")
      .locator("[data-slot='pay-deductions-picker-checkbox']")
      .click();

    // Switch to Apply all (picker hides; ticks live only in client draft).
    await page
      .locator("[data-slot='pay-deductions-supply-mode-toggle'] [data-value='apply']")
      .click();
    await expect(page.locator("[data-slot='pay-deductions-picker']")).toHaveCount(0);

    // Switch back to Some — ticks restored without a save round-trip.
    await page
      .locator("[data-slot='pay-deductions-supply-mode-toggle'] [data-value='partial']")
      .click();
    await expect(
      page
        .locator("[data-slot='pay-deductions-picker-row'][data-name='Chrome powder']")
        .locator("[data-slot='pay-deductions-picker-checkbox']")
    ).toHaveAttribute("data-state", "checked");
    await expect(
      page
        .locator("[data-slot='pay-deductions-picker-row'][data-name='GelX tips & gel']")
        .locator("[data-slot='pay-deductions-picker-checkbox']")
    ).toHaveAttribute("data-state", "checked");
    await expect(
      page
        .locator("[data-slot='pay-deductions-picker-row'][data-name='Cat-eye gel']")
        .locator("[data-slot='pay-deductions-picker-checkbox']")
    ).toHaveAttribute("data-state", "unchecked");
  });

  test("(f) archived UX: a still-exempted but archived type renders with the Archived pill and is tickable (Clarify Q3)", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    // Pre-seed Sam in partial mode with Chrome powder ticked, then archive it.
    await setStaffSupply({ staffId: staffFixture.tech.id, mode: "partial", except: [chromeId] });
    await archiveSupplyType(chromeId);

    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    const picker = page.locator("[data-slot='pay-deductions-picker']");
    await expect(picker).toBeVisible();

    const chromeRow = picker.locator(
      "[data-slot='pay-deductions-picker-row'][data-name='Chrome powder']"
    );
    await expect(chromeRow).toBeVisible();
    // Archived pill visible alongside the name.
    await expect(chromeRow.locator("[data-slot='staff-archived-pill']")).toBeVisible();
    await expect(chromeRow.locator("[data-slot='staff-archived-pill']")).toContainText("Archived");
    // Checkbox is still tickable + currently ticked.
    const cb = chromeRow.locator("[data-slot='pay-deductions-picker-checkbox']");
    await expect(cb).toHaveAttribute("data-state", "checked");
    await expect(cb).not.toBeDisabled();
  });

  test("(h) empty catalog: selecting Some shows the empty-state copy with a /services link", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    // Wipe everything for this test — empty-state path requires zero active
    // supply_types globally. Single-worker mode (playwright.config.ts:55)
    // means no other spec is touching supply_types in parallel, so the
    // global wipe is race-free. The next test's beforeEach re-seeds via
    // resetSupplyCatalog + the per-test seed block.
    const c = adminClient();
    const EPOCH = "1970-01-01T00:00:00.000Z";
    // Detach any services pointing at supply_types before dropping the types.
    await c
      .from("services")
      .update({ supply_type_id: null, supply_amount_cents: null })
      .gte("created_at", EPOCH);
    await c.from("services").delete().gte("created_at", EPOCH);
    await c.from("supply_types").delete().gte("created_at", EPOCH);
    SEEDED_SERVICE_IDS.clear();
    SEEDED_SUPPLY_TYPE_IDS.clear();

    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);
    await page
      .locator("[data-slot='pay-deductions-supply-mode-toggle'] [data-value='partial']")
      .click();

    const empty = page.locator("[data-slot='pay-deductions-picker-empty']");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(
      "No supply types defined yet. Add some on the Services page first."
    );
    // The "Services page" text is wrapped in a Link href="/services".
    await expect(empty.locator("a[href='/services']")).toBeVisible();
  });
});

test.describe("US3: Summary sentence + live status badges", () => {
  let supabaseUp = false;

  test.beforeAll(async () => {
    supabaseUp = await supabaseIsReachable();
    if (!supabaseUp) {
      test.skip(
        true,
        "Supabase not reachable at 127.0.0.1:54321 — skipping US3 payout-exemptions specs (Docker unavailable)."
      );
      return;
    }
  });

  test.beforeEach(async ({ staffFixture }) => {
    if (!supabaseUp) return;
    await staffFixture.reset();
  });

  test("(i) live badge update: Card-fee exempt badge appears immediately on toggle; reload clears it (FR-016)", async ({
    page,
    staffFixture,
  }) => {
    await signInAs(page, staffFixture, staffFixture.owner, { nextPath: "/settings/staff" });
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);

    const cardFeeSwitch = page.locator("[data-slot='pay-deductions-card-fee-switch']");
    await expect(cardFeeSwitch).toHaveAttribute("data-state", "checked");

    // No badge yet (draft matches persisted, both non-exempt).
    await expect(page.locator("[data-slot='staff-status-badge-card-fee-exempt']")).toHaveCount(0);

    // Toggle OFF without saving — badge should appear immediately off draft state.
    await cardFeeSwitch.click();
    await expect(cardFeeSwitch).toHaveAttribute("data-state", "unchecked");
    await expect(page.locator("[data-slot='staff-status-badge-card-fee-exempt']")).toBeVisible();

    // Reload — draft discarded (no save happened); badge disappears.
    await page.goto(`/settings/staff?selected=${staffFixture.tech.id}`);
    await expect(page.locator("[data-slot='pay-deductions-card-fee-switch']")).toHaveAttribute(
      "data-state",
      "checked"
    );
    await expect(page.locator("[data-slot='staff-status-badge-card-fee-exempt']")).toHaveCount(0);
  });
});
