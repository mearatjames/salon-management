// @vitest-environment node

// Unit test for `validateAndResolveDraft` (T005 / feature
// 043-checkout-ephemeral-draft).
//
// `validateAndResolveDraft` is the server-side re-validation +
// resolution step run on every draft-path payment action BEFORE
// `pos_create_ticket_from_draft`. The draft is a PROPOSAL, not authority
// (Constitution Principle II) — this helper re-derives `name_snapshot`
// from the catalog and re-checks every operator-authority field.
//
// Cases (contracts/checkout-draft.md § Server-side validation):
//   - empty draft (no service line)            → TicketEmptyError
//   - service line with priceUnconfirmed=true   → TicketHasUnpricedItemsError
//   - service line with an unknown serviceId    → DraftCorruptError
//   - service line on an ARCHIVED service       → ACCEPTED (no active filter)
//   - service line with a non-positive price    → InvalidPriceError
//   - assignedStaffId resolving to inactive     → StaffNotActiveError
//   - percent discount folded into the total    → resolved amount is correct
//   - resolved total <= 0 (over-discount)       → TicketEmptyError
//
// The Supabase client is mocked end-to-end (services + staff reads) so
// the test never touches the network. Constitution Principle IV — this
// test is written FIRST and MUST FAIL until the helper is implemented.

import { describe, expect, it } from "vitest";

import {
  validateAndResolveDraft,
  DraftCorruptError,
  type CheckoutDraft,
} from "@/app/(studio)/checkout/_cart-draft";
import {
  InvalidPriceError,
  StaffNotActiveError,
  TicketEmptyError,
  TicketHasUnpricedItemsError,
} from "@/app/(studio)/checkout/_errors";

const STAFF_ACTIVE = "10000000-0000-0000-0000-000000000001";
const STAFF_INACTIVE = "10000000-0000-0000-0000-000000000099";
const STAFF_REMOVED = "10000000-0000-0000-0000-0000000000aa";
const SVC_ACTIVE = "20000000-0000-0000-0000-000000000001";
const SVC_ARCHIVED = "20000000-0000-0000-0000-000000000002";
const SVC_UNKNOWN = "20000000-0000-0000-0000-0000000000ff";

type ServiceRow = { id: string; name: string };
type StaffRow = { id: string; active: boolean; removed_at: string | null };

const ALL_SERVICES: ServiceRow[] = [
  { id: SVC_ACTIVE, name: "Classic Manicure" },
  // Archived in the catalog, but `validateAndResolveDraft` reads with NO
  // `active` filter so the row still resolves.
  { id: SVC_ARCHIVED, name: "Gel Polish (archived)" },
];

const ALL_STAFF: StaffRow[] = [
  { id: STAFF_ACTIVE, active: true, removed_at: null },
  { id: STAFF_INACTIVE, active: false, removed_at: null },
  { id: STAFF_REMOVED, active: true, removed_at: "2026-01-01T00:00:00Z" },
];

/**
 * A Supabase mock satisfying the helper's two reads:
 *   - services.select("id, name").in("id", ids)
 *   - staff.select("id, active, removed_at").in("id", ids)
 * Each `.in(col, ids)` is a thenable resolving to the matching rows.
 */
function makeMockClient() {
  return {
    from(table: string) {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              let rows: unknown[] = [];
              if (table === "services") {
                rows = ALL_SERVICES.filter((s) => ids.includes(s.id));
              } else if (table === "staff") {
                rows = ALL_STAFF.filter((s) => ids.includes(s.id));
              }
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof validateAndResolveDraft>[1];
}

function serviceLine(
  overrides: Partial<{
    serviceId: string;
    unitPriceCents: number;
    priceUnconfirmed: boolean;
    assignedStaffId: string;
  }> = {}
) {
  return {
    kind: "service" as const,
    clientLineId: crypto.randomUUID(),
    serviceId: overrides.serviceId ?? SVC_ACTIVE,
    unitPriceCents: overrides.unitPriceCents ?? 4500,
    priceUnconfirmed: overrides.priceUnconfirmed ?? false,
    assignedStaffId: overrides.assignedStaffId ?? STAFF_ACTIVE,
  };
}

describe("validateAndResolveDraft", () => {
  it("throws TicketEmptyError for a draft with no service line", async () => {
    const draft: CheckoutDraft = { lines: [] };
    await expect(validateAndResolveDraft(draft, makeMockClient())).rejects.toBeInstanceOf(
      TicketEmptyError
    );
  });

  it("throws TicketHasUnpricedItemsError when a service line has priceUnconfirmed=true", async () => {
    const draft: CheckoutDraft = {
      lines: [serviceLine({ priceUnconfirmed: true })],
    };
    await expect(validateAndResolveDraft(draft, makeMockClient())).rejects.toBeInstanceOf(
      TicketHasUnpricedItemsError
    );
  });

  it("throws DraftCorruptError when a service line references an unknown serviceId", async () => {
    const draft: CheckoutDraft = {
      lines: [serviceLine({ serviceId: SVC_UNKNOWN })],
    };
    await expect(validateAndResolveDraft(draft, makeMockClient())).rejects.toBeInstanceOf(
      DraftCorruptError
    );
  });

  it("accepts a service line on an ARCHIVED service (no active filter on the catalog read)", async () => {
    const draft: CheckoutDraft = {
      lines: [serviceLine({ serviceId: SVC_ARCHIVED, unitPriceCents: 3500 })],
    };
    const resolved = await validateAndResolveDraft(draft, makeMockClient());
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      kind: "service",
      ref_id: SVC_ARCHIVED,
      // name_snapshot is re-derived from the catalog, never the client.
      name_snapshot: "Gel Polish (archived)",
      unit_price_cents: 3500,
      assigned_staff_id: STAFF_ACTIVE,
      price_unconfirmed: false,
    });
  });

  it("throws InvalidPriceError when a service line's unitPriceCents is non-positive", async () => {
    const zero: CheckoutDraft = { lines: [serviceLine({ unitPriceCents: 0 })] };
    await expect(validateAndResolveDraft(zero, makeMockClient())).rejects.toBeInstanceOf(
      InvalidPriceError
    );

    const negative: CheckoutDraft = {
      lines: [serviceLine({ unitPriceCents: -100 })],
    };
    await expect(validateAndResolveDraft(negative, makeMockClient())).rejects.toBeInstanceOf(
      InvalidPriceError
    );
  });

  it("throws StaffNotActiveError when assignedStaffId is inactive", async () => {
    const inactive: CheckoutDraft = {
      lines: [serviceLine({ assignedStaffId: STAFF_INACTIVE })],
    };
    await expect(validateAndResolveDraft(inactive, makeMockClient())).rejects.toBeInstanceOf(
      StaffNotActiveError
    );

    const removed: CheckoutDraft = {
      lines: [serviceLine({ assignedStaffId: STAFF_REMOVED })],
    };
    await expect(validateAndResolveDraft(removed, makeMockClient())).rejects.toBeInstanceOf(
      StaffNotActiveError
    );
  });

  it("folds a percent discount against the service subtotal (FR-007)", async () => {
    // $50 service + 10% discount → resolved discount amount = -500, the
    // RPC's persisted total = 4500.
    const draft: CheckoutDraft = {
      lines: [
        serviceLine({ unitPriceCents: 5000 }),
        {
          kind: "discount",
          clientLineId: crypto.randomUUID(),
          shape: "percent",
          value: 10,
          note: "loyalty",
        },
      ],
    };
    const resolved = await validateAndResolveDraft(draft, makeMockClient());
    expect(resolved).toHaveLength(2);

    const discount = resolved.find((r) => r.kind === "discount");
    expect(discount).toMatchObject({
      kind: "discount",
      unit_price_cents: -500,
      discount_pct: 10,
      note: "loyalty",
    });
  });

  it("throws TicketEmptyError when the resolved total is non-positive (over-discount)", async () => {
    // $50 service + a flat $60 discount → resolved total floors to 0.
    const draft: CheckoutDraft = {
      lines: [
        serviceLine({ unitPriceCents: 5000 }),
        {
          kind: "discount",
          clientLineId: crypto.randomUUID(),
          shape: "flat",
          value: 6000,
          note: null,
        },
      ],
    };
    await expect(validateAndResolveDraft(draft, makeMockClient())).rejects.toBeInstanceOf(
      TicketEmptyError
    );
  });
});
