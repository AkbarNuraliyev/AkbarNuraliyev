"use server";

import { z } from "zod";
import { defineAction } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { audit } from "@/server/core";

export const markAllReadAction = defineAction({ allowReadOnly: true }, async (ctx) => {
  await withTenant(ctx, (tx) => tx.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } }));
  return { ok: true, message: "All notifications marked as read" };
});

export const resolveNotificationAction = defineAction(
  { schema: z.object({ id: z.string(), status: z.enum(["ACKNOWLEDGED", "RESOLVED"]) }) },
  async (ctx, input) => {
    await withTenant(ctx, async (tx) => {
      const n = await tx.notification.findUniqueOrThrow({ where: { id: input.id } });
      await tx.notification.update({ where: { id: n.id }, data: { status: input.status, readAt: n.readAt ?? new Date(), resolvedAt: input.status === "RESOLVED" ? new Date() : null } });
      await audit(tx, ctx, { action: `notification.${input.status.toLowerCase()}`, entityType: "notification", entityId: n.id, summary: n.title });
    });
    return { ok: true, message: input.status === "RESOLVED" ? "Alert resolved" : "Alert acknowledged" };
  },
);
