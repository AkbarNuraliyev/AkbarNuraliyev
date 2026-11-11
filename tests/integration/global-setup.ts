import { execSync } from "node:child_process";

/**
 * Applies migrations (incl. RLS policies) to the dedicated test database and
 * seeds plans. Non-destructive: every test creates its own uniquely named
 * tenants, so no reset between runs is required.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL || "postgresql://poultryos:poultryos@localhost:5432/poultryos_test?schema=public&connection_limit=5";
  if (!/test/.test(url)) throw new Error("Refusing to use a database whose URL does not contain 'test'");
  const env = { ...process.env, DATABASE_URL: url, SEED_SKIP_DEMO: "1", APP_ENCRYPTION_KEY: "test-only-key-0123456789abcdef0123456789abcdef" };
  execSync("npx prisma migrate deploy", { stdio: "pipe", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "pipe", env });
}
