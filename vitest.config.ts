import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DB = process.env.TEST_DATABASE_URL || "postgresql://poultryos:poultryos@localhost:5432/poultryos_test?schema=public&connection_limit=5";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/integration/server-only-stub.ts") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 180000,
    fileParallelism: false,
    globalSetup: ["tests/integration/global-setup.ts"],
    env: { DATABASE_URL: TEST_DB, APP_ENCRYPTION_KEY: "test-only-key-0123456789abcdef0123456789abcdef", NODE_ENV: "test" },
  },
});
