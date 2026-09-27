import type { Config } from "vitest/config";

export default {
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Suites share one empanadel_test DB (truncate+seed per test) — no parallel files.
    fileParallelism: false,
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
    },
  },
} satisfies Config;
