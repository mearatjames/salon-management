// Constitution Principle II + the JSDoc in lib/square/client.ts forbid
// importing the Square SDK factory from any client component (`*.client.tsx`).
// The SDK pulls in Node-only modules and embedding it in the browser bundle
// would also leak access tokens at runtime. This test enforces the rule
// statically by scanning every `*.client.tsx` for imports from `lib/square/*`.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git"]);

async function findClientFiles(root: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await findClientFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".client.tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

const IMPORT_PATTERNS = [
  /from\s+["']@\/lib\/square\//,
  /from\s+["']lib\/square\//,
  /from\s+["'](\.\.\/)+lib\/square\//,
];

// Per-module assertions: each Square SDK wrapper that pulls in
// `node:crypto` / the Node-only Square SDK factory MUST be unreachable
// from any client component. The blanket scan above already enforces this
// for every `lib/square/*` file; this per-module list is the canonical
// allow-list of server-only wrappers — extend when a new server-only
// Square wrapper module is added.
const SERVER_ONLY_SQUARE_MODULES = [
  // Feature 015 — Terminal API (createCheckout, getCheckout, cancelCheckout)
  "lib/square/terminal.ts",
  // Feature 051 — Orders API (createOrder, mapTicketItemsToOrderLineItems)
  "lib/square/orders.ts",
];

function importPatternsFor(modulePath: string): RegExp[] {
  // Strip the trailing `.ts` so `from "@/lib/square/terminal"` (without
  // the extension, the canonical form in this repo) matches alongside
  // any future `.../terminal.ts` form.
  const bare = modulePath.replace(/\.ts$/, "");
  const escapedBare = bare.replace(/[/.]/g, "\\$&");
  const escapedFull = modulePath.replace(/[/.]/g, "\\$&");
  return [
    new RegExp(`from\\s+["']@/${escapedBare}["']`),
    new RegExp(`from\\s+["']@/${escapedFull}["']`),
  ];
}

describe("Square SDK import graph", () => {
  it("no *.client.tsx file imports from lib/square/*", async () => {
    const clientFiles = await findClientFiles(REPO_ROOT);
    const offenders: Array<{ file: string; line: string }> = [];

    for (const file of clientFiles) {
      const content = await readFile(file, "utf-8");
      for (const line of content.split("\n")) {
        if (IMPORT_PATTERNS.some((re) => re.test(line))) {
          offenders.push({ file: path.relative(REPO_ROOT, file), line: line.trim() });
        }
      }
    }

    expect(offenders, `lib/square/* must not be imported from client components`).toEqual([]);
  });

  it.each(SERVER_ONLY_SQUARE_MODULES)(
    "%s is server-only — no *.client.tsx imports it",
    async (modulePath) => {
      const clientFiles = await findClientFiles(REPO_ROOT);
      const patterns = importPatternsFor(modulePath);
      const offenders: Array<{ file: string; line: string }> = [];

      for (const file of clientFiles) {
        const content = await readFile(file, "utf-8");
        for (const line of content.split("\n")) {
          if (patterns.some((re) => re.test(line))) {
            offenders.push({ file: path.relative(REPO_ROOT, file), line: line.trim() });
          }
        }
      }

      expect(offenders, `${modulePath} must not be imported from client components`).toEqual([]);
    }
  );
});
