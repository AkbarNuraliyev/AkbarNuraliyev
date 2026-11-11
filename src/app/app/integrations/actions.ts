"use server";

import { z } from "zod";
import { defineAction, zId, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { audit } from "@/server/core";
import { createApiKey, disconnectIntegration, saveIntegrationConfig, testIntegration } from "@/server/services/integrations";
import { WEBHOOK_EVENTS, dispatchPendingWebhooks } from "@/server/services/webhooks";

const providerSchema = z.object({ provider: zStr(30) });

export const saveIntegrationAction = defineAction({ permission: "integrations.manage", schema: providerSchema }, async (ctx, input, fd) => {
  const values: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("f_") && typeof v === "string") values[k.slice(2)] = v;
  await withTenant(ctx, (tx) => saveIntegrationConfig(tx, ctx, input.provider, values));
  return { ok: true, message: "Settings saved. Status: configured (not yet verified)." };
});

export const testIntegrationAction = defineAction({ permission: "integrations.manage", schema: providerSchema }, async (ctx, input) => {
  const r = await withTenant(ctx, (tx) => testIntegration(tx, ctx, input.provider));
  if (!r.ok) throw new AppError("Connection test failed: {msg}", { msg: r.message });
  return { ok: true, message: "Connected: {msg}", params: { msg: r.message } };
});

export const disconnectIntegrationAction = defineAction({ permission: "integrations.manage", schema: providerSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => disconnectIntegration(tx, ctx, input.provider));
  return { ok: true, message: "Integration disconnected and credentials deleted" };
});

const keySchema = z.object({ name: zStr(80) });
export const createApiKeyAction = defineAction({ permission: "integrations.manage", feature: "api", schema: keySchema }, async (ctx, input, fd) => {
  const scopes = fd.getAll("scopes").map(String);
  const { raw } = await withTenant(ctx, (tx) => createApiKey(tx, ctx, { name: input.name, scopes }));
  return { ok: true, message: "API key created. Copy it now — it is shown only once.", data: { link: raw } };
});

const idSchema = z.object({ id: zId });
export const revokeApiKeyAction = defineAction({ permission: "integrations.manage", feature: "api", schema: idSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const k = await tx.apiKey.update({ where: { id: input.id }, data: { revokedAt: new Date() } });
    await audit(tx, ctx, { action: "api_key.revoke", entityType: "api_key", entityId: k.id, summary: k.name });
  });
  return { ok: true, message: "API key revoked" };
});

const hookSchema = z.object({ url: z.string().trim().url("Enter a valid URL").refine((u) => u.startsWith("https://"), "Webhook URL must use https://") });
export const createWebhookAction = defineAction({ permission: "integrations.manage", feature: "webhooks", schema: hookSchema }, async (ctx, input, fd) => {
  const events = fd.getAll("events").map(String).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw new AppError("Select at least one event", {}, "events");
  const secret = `whsec_${randomToken(24)}`;
  await withTenant(ctx, async (tx) => {
    const h = await tx.webhook.create({ data: { tenantId: ctx.tenantId, url: input.url, events, encryptedSecret: encryptSecret(secret) } });
    await audit(tx, ctx, { action: "webhook.create", entityType: "webhook", entityId: h.id, summary: `${input.url} (${events.join(", ")})` });
  });
  return { ok: true, message: "Webhook created. Copy the signing secret now — it is shown only once.", data: { link: secret } };
});

export const deleteWebhookAction = defineAction({ permission: "integrations.manage", feature: "webhooks", schema: idSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const h = await tx.webhook.delete({ where: { id: input.id } });
    await audit(tx, ctx, { action: "webhook.delete", entityType: "webhook", entityId: h.id, summary: h.url });
  });
  return { ok: true, message: "Webhook deleted" };
});

export const testWebhookAction = defineAction({ permission: "integrations.manage", feature: "webhooks", schema: idSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    await tx.webhookDelivery.create({ data: { tenantId: ctx.tenantId, webhookId: input.id, event: "ping", payload: { event: "ping", occurredAt: new Date().toISOString(), data: { message: "PoultryOS webhook test" } }, status: "PENDING" } });
  });
  await dispatchPendingWebhooks(ctx.tenantId);
  const last = await withTenant(ctx, (tx) => tx.webhookDelivery.findFirst({ where: { webhookId: input.id, event: "ping" }, orderBy: { createdAt: "desc" } }));
  if (last?.status !== "SENT") throw new AppError("Test delivery failed: {err}", { err: last?.error ?? "unknown error" });
  return { ok: true, message: "Test delivery succeeded (HTTP {code})", params: { code: last.responseCode ?? 200 } };
});
