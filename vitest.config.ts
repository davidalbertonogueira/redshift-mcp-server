import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./test/global-setup.ts",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share one long-lived Postgres container; keep them from racing.
    fileParallelism: false,
  },
});
