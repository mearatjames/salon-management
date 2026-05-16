import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored design-system handoff (Claude Design export) — not our source.
    "design-system/**",
    // Test artifacts and reports.
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    // Local git worktrees (sibling feature branches checked out under
    // .worktrees/<branch>) — not part of this branch's source tree.
    ".worktrees/**",
  ]),
  // Must be last: disables ESLint rules that conflict with Prettier.
  prettier,
]);

export default eslintConfig;
