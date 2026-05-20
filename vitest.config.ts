import path from "node:path";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    setupFiles: ["tests/setup.ts"],
    // Split into projects so file-level parallelism and the test
    // environment are scoped per group instead of forced globally.
    // Issue #93: a global `fileParallelism: false` + global `jsdom` made
    // the 93-file suite take ~106s, ~90% of which was overhead — not test
    // execution. Each project inherits `plugins`, `resolve`, `globals`,
    // and `setupFiles` from this root config via `extends: true`.
    projects: [
      {
        // Pure-logic unit tests — the bulk of the suite. Plain `node`
        // environment (no jsdom) and file-level parallelism left on.
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/unit/square/**"],
        },
      },
      {
        // Component tests (`.test.tsx`) need a DOM, so jsdom — but only
        // these few files pay the jsdom setup cost, not all 93.
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.tsx"],
        },
      },
      {
        // Square integration tests talk to local Postgres and share the
        // singleton `square_oauth` row, so their seed/clear cycles race
        // under parallelism. `fileParallelism: false` is scoped to just
        // these files instead of penalizing the whole suite.
        extends: true,
        test: {
          name: "square",
          environment: "node",
          include: ["tests/unit/square/**/*.test.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
