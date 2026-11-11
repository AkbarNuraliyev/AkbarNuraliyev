import { NextResponse, type NextRequest } from "next/server";
import { withSystem, withTenant } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { parseSettings } from "@/lib/settings";
import type { Tx } from "@/lib/prisma";
import type { ServiceCtx } from "./core";
import { dispatchPendingWebhooks } from "./services/webhooks";

export interface ApiCtx extends ServiceCtx {
  keyId: string;
  scopes: string[];
}

export function apiError(status: number, message: string) {
  return NextResponse.json({ error: { status, message } }, { status });
}

/** Resolves an API key (system lookup by hash), checks tenant status, plan feature and scope. */
export async function apiAuth(req: NextRequest, scope: string): Promise<ApiCtx | NextResponse> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(pos_live_[\w-]+)$/);
  if (!m) return apiError(401, "Missing or malformed API key (Authorization: Bearer pos_live_…)");
  const found = await withSystem(async (tx) => {
    const key = await tx.apiKey.findUnique({ where: { keyHash: sha256(m[1]) } });
    if (!key || key.revokedAt) return null;
    const tenant = await tx.tenant.findUnique({ where: { id: key.tenantId }, include: { subscription: { include: { plan: true } }, featureOverrides: true } });
    if (!tenant) return null;
    await tx.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return { key, tenant };
  });
  if (!found) return apiError(401, "Invalid or revoked API key");
  const { key, tenant } = found;
  if (tenant.status !== "ACTIVE") return apiError(403, "Organization suspended");
  const features = new Set(tenant.subscription?.plan.features ?? []);
  for (const o of tenant.featureOverrides) (o.enabled ? features.add(o.feature) : features.delete(o.feature));
  if (!features.has("api")) return apiError(403, "API access is not included in the current plan");
  if (!key.scopes.includes(scope)) return apiError(403, `API key lacks scope ${scope}`);
  return { tenantId: tenant.id, tz: tenant.timezone, settings: parseSettings(tenant.settings), userId: null, userName: `API key ${key.name}`, userEmail: `api:${key.prefix}`, keyId: key.id, scopes: key.scopes };
}

/** Runs a handler in the tenant's RLS context; maps business errors to 422. */
export async function apiRun<T>(ctx: ApiCtx, fn: (tx: Tx) => Promise<T>, status = 200) {
  try {
    const data = await withTenant(ctx, fn);
    void dispatchPendingWebhooks(ctx.tenantId).catch(() => undefined);
    return NextResponse.json({ data }, { status });
  } catch (e) {
    if (e instanceof AppError) {
      let msg = e.message;
      for (const [k, v] of Object.entries(e.params)) msg = msg.split(`{${k}}`).join(String(v));
      return apiError(422, msg);
    }
    console.error("[api]", e);
    return apiError(500, "Internal error");
  }
}
