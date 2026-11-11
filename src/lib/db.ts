import { prisma, type Tx } from "./prisma";

/**
 * Tenant isolation is enforced by PostgreSQL row-level security.
 * Every query against tenant data runs inside a transaction where the
 * transaction-local setting `app.tenant_id` is set. Rows of any other tenant
 * are invisible and cannot be written, even if application code forgets a
 * `where: { tenantId }` filter.
 */
export interface TenantScope {
  tenantId: string;
}

const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 } as const;

export async function withTenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!scope.tenantId) throw new Error("withTenant: tenantId is required");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true)`;
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Platform/system context: bypasses tenant RLS. Only used by authentication,
 * the Super Admin console, the public QR trace page (narrow selects), the
 * API-key resolver and seeding. Never call this from tenant module code.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
    return fn(tx);
  }, TX_OPTIONS);
}
