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
});
