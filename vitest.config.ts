import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // Several tests under `tests/unit/square/` integrate against the local
    // Postgres via the service-role client and share the singleton
    // `square_oauth` row. Vitest's default per-file parallelism races
    // their seed/clear cycles and they clobber each other. Disabling
    // file-level parallelism serializes file execution while tests
    // within a single file still run on a worker.
    fileParallelism: false,
  },
});
