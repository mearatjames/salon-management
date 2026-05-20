#!/usr/bin/env node
// Wrapper for `npm run test:e2e:changed` — runs the union of:
//   (A) specs Playwright considers changed (transitive import graph) via
//       `playwright test --only-changed=<base> --list --reporter=json`
//   (B) specs pulled in by `tests/e2e/_affected-map.mjs` for files
//       changed vs <base> (covers production code paths specs don't
//       directly import — checkout components, API routes, lib/pos, etc.)
//
// Falls back to a full e2e run when test helpers or playwright config
// change (broad blast radius). Prints a clear no-op message when nothing
// is affected.
//
// Base ref: $E2E_BASE (default `origin/main`).
//
// See CLAUDE.md § "Scoping intermediate phase gates" for usage.

import { execFileSync, spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { AFFECTED_MAP } from "../tests/e2e/_affected-map.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.E2E_BASE || "origin/main";

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

// 1. Bail loudly if BASE doesn't exist — common on fresh clones that
//    haven't fetched yet. Surfaces the problem before Playwright errors.
try {
  execFileSync("git", ["rev-parse", "--verify", BASE], { cwd: ROOT, stdio: "ignore" });
} catch {
  console.error(
    `E2E_BASE='${BASE}' does not exist. Run \`git fetch origin main\` first ` +
      `(or set E2E_BASE to a valid ref).`
  );
  process.exit(1);
}

// 2. Set A: Playwright's --only-changed transitive import graph.
function playwrightChangedSpecs() {
  let json;
  try {
    json = execFileSync(
      "npx",
      ["playwright", "test", `--only-changed=${BASE}`, "--list", "--reporter=json"],
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
  } catch (err) {
    const stderr = err.stderr?.toString?.() || err.message;
    console.error(`Playwright \`--list\` failed:\n${stderr}`);
    process.exit(1);
  }
  if (!json) return [];
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const files = new Set();
  function walk(suite) {
    if (suite.file) files.add(suite.file);
    suite.specs?.forEach((s) => s.file && files.add(s.file));
    suite.suites?.forEach(walk);
  }
  parsed.suites?.forEach(walk);
  return Array.from(files);
}

// 3. Set B: affected-map.
function gitChangedFiles() {
  // `git diff --name-only <base>` (no `...`) compares the working tree
  // against <base> — covers both committed-since-fork and uncommitted
  // changes in one shot.
  const tracked = git("diff", "--name-only", BASE).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  return Array.from(new Set([...tracked, ...untracked]));
}

function globToRegex(glob) {
  // `**` matches any depth (including `/`); `*` matches within a path
  // segment. Other regex metachars are escaped literally.
  let regex = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      regex += ".*";
      i += 1;
    } else if (ch === "*") {
      regex += "[^/]*";
    } else if (/[.+^$|()[\]{}\\?]/.test(ch)) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  return new RegExp(`^${regex}$`);
}

function affectedMapSpecs(changed) {
  const specs = new Set();
  for (const [pathGlob, specGlobs] of Object.entries(AFFECTED_MAP)) {
    const re = globToRegex(pathGlob);
    if (!changed.some((f) => re.test(f))) continue;
    for (const sg of specGlobs) {
      for (const match of globSync(sg, { cwd: ROOT })) {
        specs.add(match);
      }
    }
  }
  return Array.from(specs);
}

// 4. Broad-blast fallback: changes to e2e helpers imported by specs, or
//    to playwright config, invalidate the whole import-graph assumption
//    — run everything. The affected-map (`.mjs`) is intentionally
//    excluded — it's only imported by this wrapper, not by specs, so
//    editing it re-runs with the new map but doesn't force a full suite.
function changedFilesForceFullSuite(changed) {
  return changed.some((f) => /^tests\/e2e\/_[^/]+\.ts$/.test(f) || f === "playwright.config.ts");
}

const changed = gitChangedFiles();

if (changedFilesForceFullSuite(changed)) {
  console.log(
    `Detected change to e2e helpers / playwright config — running full e2e suite ` +
      `(import-graph assumptions invalidated).`
  );
  const full = spawnSync("npx", ["playwright", "test"], { stdio: "inherit", cwd: ROOT });
  process.exit(full.status ?? 1);
}

const setA = playwrightChangedSpecs().map((p) => relative(ROOT, p));
const setB = affectedMapSpecs(changed);
const union = Array.from(new Set([...setA, ...setB])).sort();

if (union.length === 0) {
  console.log(
    `No e2e specs affected vs ${BASE} ` +
      `(no changed spec import graphs, no affected-map hits). Skipping.`
  );
  console.log(`Run \`npm run test:e2e\` for the full suite.`);
  process.exit(0);
}

console.log(`Running ${union.length} e2e spec(s) affected vs ${BASE}:`);
union.forEach((s) => console.log(`  · ${s}`));
console.log("");

// `--no-deps`: skip the baseline-services → baseline-dashboard → main
// project chain (playwright.config.ts). A scoped changed-run shouldn't
// drag the full ~1.5-min baseline phase onto every intermediate gate —
// the final `npm run test:e2e` runs the chain in full. The full-suite
// fallback above intentionally omits `--no-deps` so it keeps the chain.
const result = spawnSync("npx", ["playwright", "test", "--no-deps", ...union], {
  stdio: "inherit",
  cwd: ROOT,
});
process.exit(result.status ?? 1);
