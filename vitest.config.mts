import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside React Server Components; tests run in Node.
      "server-only": fileURLToPath(new URL("./src/server/testing/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./src/server/testing/global-setup.ts"],
    // Tests never touch the seeded demo database or the dev Redis keys.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://aspiredge:aspiredge@localhost:5434/aspiredge_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6380/15",
    },
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
