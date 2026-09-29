import type { Config } from "vitest/config";

export default {
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Suites share one empanadel_test DB (truncate+seed per test) — no parallel files.
    // (fileParallelism is v3+; on v2, singleFork serializes files in one worker.)
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      NODE_ENV: "test",
    },
  },
} satisfies Config;
