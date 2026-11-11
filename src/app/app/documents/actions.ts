"use server";

import { z } from "zod";
import { defineAction, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/core";
import { storeUpload } from "@/server/storage";

/** Entity types that accept attachments, with the permission required to attach. */
const ENTITY_PERMS: Record<string, string> = {
  supplier: "procurement.manage",
  raw_material_receipt: "receiving.operate",
  product: "products.manage",
  quality_record: "quality.operate",
  nonconformity: "quality.operate",
  tenant: "settings.manage",
  order: "orders.operate",
  shipment: "logistics.operate",
  recall: "traceability.recall",
};

export const uploadDocumentAction = defineAction(
  {
    schema: z.object({
      entityType: z.string(),
      entityId: z.string(),
      type: z.enum(["CONTRACT", "CERTIFICATE", "PHOTO", "INVOICE", "DELIVERY_NOTE", "REPORT", "IMAGE", "OTHER"]),
      title: zStr(160),
      isPublic: z.string().optional(),
    }),
  },
  async (ctx, input, fd) => {
    const perm = ENTITY_PERMS[input.entityType];
    if (!perm || !ctx.can(perm)) throw new AppError("You do not have permission to perform this action");
    const file = fd.get("file") as File | null;
    const stored = await storeUpload(ctx.tenantId, file as File);
    await withTenant(ctx, async (tx) => {
      const doc = await tx.document.create({
        data: {
          tenantId: ctx.tenantId,
          type: input.type,
          title: input.title,
          ...stored,
          entityType: input.entityType,
          entityId: input.entityId,
          isPublic: input.isPublic === "on" && input.type === "CERTIFICATE",
          uploadedById: ctx.userId,
        },
      });
      if (input.type === "IMAGE" && input.entityType === "product") {
        await tx.product.update({ where: { id: input.entityId }, data: { imageDocumentId: doc.id } });
      }
      await audit(tx, ctx, { action: "document.upload", entityType: input.entityType, entityId: input.entityId, summary: `${input.type}: ${input.title} (${stored.fileName})` });
    });
    return { ok: true, message: "File uploaded" };
  },
);

export const deleteDocumentAction = defineAction({ schema: z.object({ id: z.string() }) }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: input.id } });
    if (!doc) throw new AppError("Document not found");
    const perm = ENTITY_PERMS[doc.entityType ?? ""];
    if (!perm || !ctx.can(perm)) throw new AppError("You do not have permission to perform this action");
    await tx.document.delete({ where: { id: doc.id } });
    await tx.product.updateMany({ where: { imageDocumentId: doc.id }, data: { imageDocumentId: null } });
    await audit(tx, ctx, { action: "document.delete", entityType: doc.entityType ?? "document", entityId: doc.entityId, summary: doc.title });
  });
  return { ok: true, message: "Document deleted" };
});
