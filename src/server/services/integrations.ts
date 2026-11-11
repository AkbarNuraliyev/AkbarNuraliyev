import type { Tx } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "@/lib/crypto";
import { AppError, assert } from "@/lib/errors";
import { providerByKey } from "@/lib/integrations-catalog";
import { audit, nowOf, type ServiceCtx } from "../core";

/**
 * Integration adapters. Credentials are encrypted at rest (AES-256-GCM) and
 * never returned to the browser. A provider is only marked CONNECTED after a
 * real, successful connection test; otherwise it stays NOT_CONNECTED or
 * CONFIGURED (credentials saved, not verified).
 */
export async function saveIntegrationConfig(tx: Tx, ctx: ServiceCtx, providerKey: string, values: Record<string, string>) {
  const provider = providerByKey(providerKey);
  assert(provider, "Unknown integration");
  const integ = await tx.integration.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: providerKey } } });
  const prevSecrets: Record<string, string> = integ?.encryptedSecret ? JSON.parse(decryptSecret(integ.encryptedSecret)) : {};
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = { ...prevSecrets };
  for (const f of provider.fields) {
    const v = (values[f.key] ?? "").trim();
    if (f.type === "secret") {
      if (v) secrets[f.key] = v; // empty = keep existing
    } else {
      if (f.type === "url" && v && !/^https:\/\/[^\s]+$/i.test(v)) throw new AppError("{field} must be an https:// URL", { field: f.label }, f.key);
      config[f.key] = v;
    }
  }
  const hasAny = Object.values(config).some(Boolean) || Object.keys(secrets).length > 0;
  const data = {
    config: config as unknown as Prisma.InputJsonValue,
    encryptedSecret: Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets)) : null,
    status: hasAny ? ("CONFIGURED" as const) : ("NOT_CONNECTED" as const),
    enabled: false,
    lastError: null,
  };
  await tx.integration.upsert({
    where: { tenantId_provider: { tenantId: ctx.tenantId, provider: providerKey } },
    update: data,
    create: { tenantId: ctx.tenantId, provider: providerKey, ...data },
  });
  await audit(tx, ctx, { action: "integration.configure", entityType: "integration", summary: `${provider.name}: settings saved (${Object.keys(secrets).length} secret field(s), not shown)` });
}

export async function disconnectIntegration(tx: Tx, ctx: ServiceCtx, providerKey: string) {
  await tx.integration.update({
    where: { tenantId_provider: { tenantId: ctx.tenantId, provider: providerKey } },
    data: { status: "NOT_CONNECTED", enabled: false, config: {}, encryptedSecret: null, lastError: null },
  });
  await audit(tx, ctx, { action: "integration.disconnect", entityType: "integration", summary: providerKey });
}

async function testWialon(config: Record<string, string>, secrets: Record<string, string>) {
  const base = (config.baseUrl || "https://hst-api.wialon.com").replace(/\/$/, "");
  if (!secrets.token) throw new Error("API token is required");
  const url = `${base}/wialon/ajax.html?svc=token/login&params=${encodeURIComponent(JSON.stringify({ token: secrets.token }))}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const body = (await res.json().catch(() => ({}))) as { eid?: string; error?: number };
  if (!res.ok || !body.eid) throw new Error(body.error !== undefined ? `Wialon error code ${body.error}` : `HTTP ${res.status}`);
  return "Wialon session established";
}

async function test1C(config: Record<string, string>, secrets: Record<string, string>) {
  if (!config.baseUrl) throw new Error("HTTP service URL is required");
  const auth = Buffer.from(`${config.username ?? ""}:${secrets.password ?? ""}`).toString("base64");
  const res = await fetch(config.baseUrl, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return `1C HTTP service responded ${res.status}`;
}

export async function testIntegration(tx: Tx, ctx: ServiceCtx, providerKey: string) {
  const provider = providerByKey(providerKey);
  assert(provider, "Unknown integration");
  const integ = await tx.integration.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: providerKey } } });
  assert(integ, "Integration not configured");
  if (!provider.testable) throw new AppError("{name}: an automatic connection test is not available until the provider's partner API documentation and credentials are supplied. Status stays “Not connected”.", { name: provider.name });
  const config = (integ.config ?? {}) as Record<string, string>;
  const secrets: Record<string, string> = integ.encryptedSecret ? JSON.parse(decryptSecret(integ.encryptedSecret)) : {};
  let ok = false;
  let message: string;
  try {
    message = providerKey === "wialon" ? await testWialon(config, secrets) : await test1C(config, secrets);
    ok = true;
  } catch (e) {
    message = e instanceof Error ? e.message : "Connection failed";
  }
  await tx.integration.update({
    where: { id: integ.id },
    data: { status: ok ? "CONNECTED" : "ERROR", enabled: ok, lastTestedAt: nowOf(ctx), lastError: ok ? null : message.slice(0, 300) },
  });
  await audit(tx, ctx, { action: "integration.test", entityType: "integration", summary: `${provider.name}: ${ok ? "connected" : "failed"} — ${message}` });
  return { ok, message };
}

export const API_SCOPES = ["orders:read", "orders:write", "products:read", "inventory:read", "trace:read", "telemetry:write", "scales:write"] as const;

export async function createApiKey(tx: Tx, ctx: ServiceCtx, input: { name: string; scopes: string[] }) {
  const scopes = input.scopes.filter((s) => (API_SCOPES as readonly string[]).includes(s));
  assert(scopes.length > 0, "Select at least one scope", {}, "scopes");
  const raw = `pos_live_${randomToken(24)}`;
  const key = await tx.apiKey.create({ data: { tenantId: ctx.tenantId, name: input.name, prefix: raw.slice(0, 14), keyHash: sha256(raw), scopes, createdById: ctx.userId ?? null } });
  await audit(tx, ctx, { action: "api_key.create", entityType: "api_key", entityId: key.id, summary: `${input.name} (${scopes.join(", ")})` });
  return { key, raw };
}
