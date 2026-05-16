// Unit test for `lib/onboarding/anon-counter.ts`.
//
// SKIPPED: requires direct Postgres access not currently in the unit-test
// infra (the sequence + RPC are DB objects, and PostgREST does not expose
// `nextval()` directly so the helper goes through the `next_anon_counter`
// security-definer RPC defined in migration 0004). Adding `node-postgres`
// to devDependencies just for this single assertion is out of scope for
// the foundational phase.
//
// Coverage is provided transitively by US4 e2e (T063): the Remove sheet
// flow exercises `getNextAnonPlaceholder()` end-to-end; removing two
// users back-to-back asserts the display names increment monotonically
// (Former staff #N then Former staff #N+1), proving the sequence is wired
// correctly through the RPC.
//
// We still keep this file in the suite so the path appears in test
// listings and a future contributor sees the deliberate gap.

import { describe, it } from "vitest";

describe.skip("getNextAnonPlaceholder — covered transitively by US4 e2e", () => {
  it("returns monotonically incrementing 'Former staff #N' placeholders", () => {
    // intentionally empty — see file header
  });
});
