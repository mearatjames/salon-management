import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Honor the `_`-prefix convention for intentionally unused names. Applies
  // to function args, destructured bindings, and caught errors. Mirrors
  // tsc's `noUnusedParameters` / `noUnusedLocals` exception for `_`.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          vars: "all",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
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
    // .claude/worktrees/<branch> per CLAUDE.md) — not part of this
    // branch's source tree.
    ".claude/worktrees/**",
  ]),
  // Must be last: disables ESLint rules that conflict with Prettier.
  prettier,
]);

export default eslintConfig;
