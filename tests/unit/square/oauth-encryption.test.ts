// tests/unit/square/oauth-encryption.test.ts
//
// Exercises the pgcrypto + GUC plumbing that protects Square OAuth tokens at
// rest (research R3 / R4). Talks to local Postgres directly via `pg` because
// the GUC + encrypt + decrypt round-trip requires all three statements to
// run in a single transaction — Supabase-js's HTTP-per-call model is unable
// to keep transaction state across `.rpc()` invocations.
//
// Three properties verified:
//   (a) setOauthKeyGuc() followed by pgp_sym_encrypt + decrypt_square_token
//       round-trips the original plaintext.
//   (b) decrypt_square_token without setting the GUC first raises Postgres
//       error code 42704 (`unrecognized configuration parameter`).
//   (c) A different GUC value yields a decryption that fails.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// Local Supabase DB URL is fixed for `supabase start` defaults. The repo
// runs the same DB on this port across every developer machine.
const DB_URL =
  process.env.SUPABASE_LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// `Boolean(DB_URL)` is always true (DB_URL has a default fallback), so we
// need a real reachability probe — otherwise `beforeAll` tries to open a
// pg.Client connection that ECONNREFUSEs in CI's unit-test phase (the
// Supabase stack is booted later, just before the e2e step). Mirror the
// pattern used by `cancel-vs-succeed-race.test.ts` etc.
async function isPgReachable(): Promise<boolean> {
  const probe = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 1500 });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const describeIfDb = (await isPgReachable()) ? describe : describe.skip;

describeIfDb("Square OAuth encryption (pgcrypto + GUC)", () => {
  let client: Client;
  // The key is read out of vault once and cached on the test runner.
  let oauthKey: string;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL });
    await client.connect();
    const res = await client.query<{ decrypted_secret: string }>(
      `select decrypted_secret from vault.decrypted_secrets where name = $1`,
      ["square_oauth_key"]
    );
    if (res.rowCount !== 1) {
      throw new Error(
        "vault secret 'square_oauth_key' not found — run T007 (supabase studio SQL) first"
      );
    }
    oauthKey = res.rows[0].decrypted_secret;
  });

  afterAll(async () => {
    await client.end();
  });

  it("(a) GUC + pgp_sym_encrypt + decrypt_square_token round-trips plaintext", async () => {
    const plaintext = "EAAAEUaXmpleAccessTokenForTestOnly";

    await client.query("begin");
    try {
      // setOauthKeyGuc analog: set the GUC transaction-locally.
      await client.query(`select set_config('app.square_oauth_key', $1, true)`, [oauthKey]);

      const enc = await client.query<{ ciphertext: Buffer }>(
        `select pgp_sym_encrypt($1, current_setting('app.square_oauth_key')) as ciphertext`,
        [plaintext]
      );
      const ciphertext = enc.rows[0].ciphertext;
      expect(Buffer.isBuffer(ciphertext)).toBe(true);
      expect(ciphertext.length).toBeGreaterThan(0);

      const dec = await client.query<{ result: string }>(
        `select public.decrypt_square_token($1) as result`,
        [ciphertext]
      );
      expect(dec.rows[0].result).toBe(plaintext);
    } finally {
      await client.query("rollback");
    }
  });

  it("(b) decrypt_square_token without GUC raises (42704 on virgin session, 39000 if GUC name already known)", async () => {
    // Encrypt in one transaction, then attempt to decrypt without setting
    // the GUC. The realised Postgres behavior depends on whether the GUC
    // name has been touched in this session: a session that has never seen
    // `app.square_oauth_key` raises 42704 (`unrecognized configuration
    // parameter`); a session where it was set transaction-locally and then
    // rolled back retains the GUC name but with an empty value, causing
    // pgcrypto to raise 39000 (`Wrong key or corrupt data`). Either failure
    // mode satisfies the contract: decrypt fails without a valid GUC.
    // We use a fresh, dedicated connection here so the 42704 path is the
    // observed one — proving the GUC truly is required.
    const enc = await client.query<{ ciphertext: Buffer }>(
      `select pgp_sym_encrypt($1, $2) as ciphertext`,
      ["some-secret", oauthKey]
    );
    const ciphertext = enc.rows[0].ciphertext;

    const fresh = new Client({ connectionString: DB_URL });
    await fresh.connect();
    try {
      let captured: { code?: string; message?: string } | null = null;
      try {
        await fresh.query(`select public.decrypt_square_token($1)`, [ciphertext]);
      } catch (err) {
        captured = err as { code?: string; message?: string };
      }
      expect(captured).not.toBeNull();
      // 42704 is the canonical contract; accept 39000 too if the connection
      // pool ever surfaces a pre-touched session.
      expect(["42704", "39000"]).toContain(captured?.code);
    } finally {
      await fresh.end();
    }
  });

  it("(c) decryption with a different GUC value fails", async () => {
    await client.query("begin");
    let ciphertext: Buffer;
    try {
      await client.query(`select set_config('app.square_oauth_key', $1, true)`, [oauthKey]);
      const enc = await client.query<{ ciphertext: Buffer }>(
        `select pgp_sym_encrypt($1, current_setting('app.square_oauth_key')) as ciphertext`,
        ["payload-for-wrong-key-test"]
      );
      ciphertext = enc.rows[0].ciphertext;
    } finally {
      await client.query("rollback");
    }

    await client.query("begin");
    try {
      // Set a DIFFERENT key, then attempt to decrypt. pgcrypto raises
      // "Wrong key or corrupt data" (errcode 39000 — `external_routine_invocation_exception`).
      await client.query(`select set_config('app.square_oauth_key', $1, true)`, [
        "some-totally-different-key-value-zzz",
      ]);
      let threw = false;
      try {
        await client.query(`select public.decrypt_square_token($1)`, [ciphertext]);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      await client.query("rollback");
    }
  });
});
