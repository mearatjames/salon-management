// PIN hashing + verification helpers backed by bcryptjs (pure-JS bcrypt).
//
// Cost factor 11 is the sole brute-force cost per FR-011 — there is no
// rate limit, lockout, or per-PIN cooldown above and beyond the latency
// bcrypt introduces. Cost 11 produces ~150 ms hashes on counter-class
// hardware, satisfying the SC-001 budget.

import bcrypt from "bcryptjs";

const BCRYPT_COST = 11;

export async function hashPin(plain: string): Promise<string> {
  return await bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPin(plain: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(plain, hash);
}
