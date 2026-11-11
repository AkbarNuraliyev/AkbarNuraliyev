import type { Tx } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { decryptSecret, hmacSha256 } from "@/lib/crypto";
import { nowOf, type ServiceCtx } from "../core";

export const WEBHOOK_EVENTS = [
  "batch.received",
  "order.created",
  "order.status_changed",
  "shipment.departed",
  "shipment.delivered",
  "temperature.excursion",
  "recall.initiated",
] as const;

/** Queues a webhook delivery inside the current transaction (sent after commit by the dispatcher). */
export async function emitWebhook(tx: Tx, ctx: ServiceCtx, event: string, data: Record<string, unknown>) {
  const hooks = await tx.webhook.findMany({ where: { isActive: true, events: { has: event } }, select: { id: true } });
  if (!hooks.length) return;
  const payload = { event, occurredAt: nowOf(ctx).toISOString(), data } as unknown as Prisma.InputJsonValue;
  await tx.webhookDelivery.createMany({
    data: hooks.map((h) => ({ tenantId: ctx.tenantId, webhookId: h.id, event, payload, status: "PENDING" })),
  });
}

/** Sends pending deliveries for a tenant. Safe to call repeatedly. */
export async function dispatchPendingWebhooks(tenantId: string) {
  const pending = await withTenant({ tenantId }, (tx) =>
    tx.webhookDelivery.findMany({
      where: { status: "PENDING" },
      include: { webhook: true },
      take: 50,
      orderBy: { createdAt: "asc" },
    }),
  );
  for (const d of pending) {
    const body = JSON.stringify(d.payload);
    let status = "FAILED";
    let code: number | null = null;
    let error: string | null = null;
    try {
      const secret = decryptSecret(d.webhook.encryptedSecret);
      const res = await fetch(d.webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-poultryos-event": d.event,
          "x-poultryos-delivery": d.id,
          "x-poultryos-signature": `sha256=${hmacSha256(secret, body)}`,
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      code = res.status;
      status = res.ok ? "SENT" : "FAILED";
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : "Request failed";
    }
    await withTenant({ tenantId }, (tx) =>
      tx.webhookDelivery.update({ where: { id: d.id }, data: { status, responseCode: code, error } }),
    );
  }
  return pending.length;
}
