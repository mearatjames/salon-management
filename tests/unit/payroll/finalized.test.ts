// Unit tests for `lib/payroll/finalized.ts` — the helpers the Transactions
// page uses to decide whether a paid ticket's pay period has been "finalized"
// (closed status OR ≥ 1 payroll_payouts row referencing it). When finalized,
// the reassign-paid-line-tech surface locks for every role (feature 050,
// User Story 3 / FR-002).
//
// Constitution Principle IV (test-first for critical paths): these tests are
// authored BEFORE the helper exists and MUST fail with "module not found" on
// first run, then pass once T004 lands `lib/payroll/finalized.ts`.

import { describe, expect, it } from "vitest";

import { payPeriodForClosedAt, isPayPeriodFinalized } from "@/lib/payroll/finalized";

const TZ = "America/Los_Angeles";

// ─── Supabase mock builder ───────────────────────────────────────────────────
//
// The helper makes at most two reads:
//   1. `from('pay_periods').select('id, status').eq('starts_on', x).maybeSingle()`
//   2. (only if row exists AND status !== 'closed')
//      `from('payroll_payouts').select('id').eq('pay_period_id', y).limit(1)`
//
// `buildSupabase` lets each test wire the two responses by table name.

type MaybeSingleResult<T> = { data: T | null; error: null };
type SelectResult<T> = { data: T[] | null; error: null };

type PayPeriodRow = { id: string; status: string };
type PayoutRow = { id: string };

function buildSupabase(opts: {
  payPeriod?: PayPeriodRow | null;
  payouts?: readonly PayoutRow[];
  onPayPeriodQuery?: (startsOn: string) => void;
  onPayoutQuery?: (payPeriodId: string) => void;
}) {
  return {
    from(table: string) {
      if (table === "pay_periods") {
        return {
          select() {
            return {
              eq(_col: string, value: string) {
                opts.onPayPeriodQuery?.(value);
                return {
                  async maybeSingle(): Promise<MaybeSingleResult<PayPeriodRow>> {
                    return { data: opts.payPeriod ?? null, error: null };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "payroll_payouts") {
        return {
          select() {
            return {
              eq(_col: string, value: string) {
                opts.onPayoutQuery?.(value);
                return {
                  async limit(_n: number): Promise<SelectResult<PayoutRow>> {
                    return { data: [...(opts.payouts ?? [])], error: null };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ─── payPeriodForClosedAt — pure wrapper ─────────────────────────────────────

describe("payPeriodForClosedAt", () => {
  it("wraps resolvePayPeriod with offset=0 — current half-month for a closed_at instant", () => {
    // closed_at = 2026-05-20 20:00 UTC → salon-local May 20 (2nd half of May).
    const ref = payPeriodForClosedAt(TZ, "2026-05-20T20:00:00.000Z");
    expect(ref.startsOn).toBe("2026-05-16");
    expect(ref.endsOn).toBe("2026-05-31");
    expect(ref.payDate).toBe("2026-06-02");
    expect(ref.offset).toBe(0);
    expect(ref.id).toBeNull();
  });

  it("accepts a Date object as well as an ISO string", () => {
    const ref = payPeriodForClosedAt(TZ, new Date("2026-05-12T20:00:00.000Z"));
    expect(ref.startsOn).toBe("2026-05-01");
    expect(ref.endsOn).toBe("2026-05-15");
  });
});

// ─── isPayPeriodFinalized — four branches ────────────────────────────────────

describe("isPayPeriodFinalized — four branches", () => {
  const REF = payPeriodForClosedAt(TZ, "2026-05-20T20:00:00.000Z");

  it("(a) no pay_periods row → false (and never queries payroll_payouts)", async () => {
    let payoutQueried = false;
    const supabase = buildSupabase({
      payPeriod: null,
      onPayoutQuery: () => {
        payoutQueried = true;
      },
    });
    const result = await isPayPeriodFinalized(supabase, REF);
    expect(result).toBe(false);
    expect(payoutQueried).toBe(false);
  });

  it("(b) row with status='closed' → true (and never queries payroll_payouts)", async () => {
    let payoutQueried = false;
    const supabase = buildSupabase({
      payPeriod: { id: "pp-1", status: "closed" },
      onPayoutQuery: () => {
        payoutQueried = true;
      },
    });
    const result = await isPayPeriodFinalized(supabase, REF);
    expect(result).toBe(true);
    expect(payoutQueried).toBe(false);
  });

  it("(c) row + ≥ 1 payroll_payouts referencing its id → true", async () => {
    let payoutQueriedFor: string | null = null;
    const supabase = buildSupabase({
      payPeriod: { id: "pp-2", status: "open" },
      payouts: [{ id: "payout-1" }],
      onPayoutQuery: (id) => {
        payoutQueriedFor = id;
      },
    });
    const result = await isPayPeriodFinalized(supabase, REF);
    expect(result).toBe(true);
    expect(payoutQueriedFor).toBe("pp-2");
  });

  it("(d) row with status='open' AND no payouts → false", async () => {
    let payoutQueriedFor: string | null = null;
    const supabase = buildSupabase({
      payPeriod: { id: "pp-3", status: "open" },
      payouts: [],
      onPayoutQuery: (id) => {
        payoutQueriedFor = id;
      },
    });
    const result = await isPayPeriodFinalized(supabase, REF);
    expect(result).toBe(false);
    expect(payoutQueriedFor).toBe("pp-3");
  });
});
