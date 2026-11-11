"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { defineAction, zId, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/core";
import { addCapa, completeCapa, createNonconformity, recordQuality, updateNonconformity, type ChecklistItem } from "@/server/services/quality";

const recordSchema = z.object({ checklistId: zId, area: zStr(160), batchId: zOptStr(40), notes: zOptStr(2000) });
export const recordQualityAction = defineAction({ permission: "quality.operate", schema: recordSchema }, async (ctx, input, fd) => {
  const responses: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("r_") && typeof v === "string") responses[k.slice(2)] = v;
  const r = await withTenant(ctx, async (tx) => {
    let batchId: string | null = null;
    if (input.batchId) {
      const b = await tx.productionBatch.findFirst({ where: { OR: [{ id: input.batchId }, { code: input.batchId }] } });
      if (!b) throw new AppError("Batch not found", {}, "batchId");
      batchId = b.id;
    }
    return recordQuality(tx, ctx, { checklistId: input.checklistId, area: input.area, batchId, responses, notes: input.notes });
  });
  return {
    ok: true,
    message: r.record.result === "PASS" ? "Inspection {n} recorded: PASS" : "Inspection {n} recorded: FAIL — non-conformity {nc} opened",
    params: { n: r.record.number, nc: r.nonconformity?.number ?? "" },
    redirectTo: `/app/quality/records/${r.record.id}`,
  };
});

const checklistSchema = z.object({ name: zStr(160), type: z.enum(["HACCP", "SANITATION", "RECEIVING", "PRODUCTION", "TEMPERATURE", "GENERAL"]), description: zOptStr(1000), items: zStr(5000) });
export const createChecklistAction = defineAction({ permission: "quality.manage", schema: checklistSchema }, async (ctx, input) => {
  // one item per line: Label | bool|number|text | min | max | critical
  const items: ChecklistItem[] = input.items
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [label, kind = "bool", min, max, critical] = line.split("|").map((x) => x.trim());
      if (!label) throw new AppError("Line {n}: label is required", { n: i + 1 }, "items");
      if (!["bool", "number", "text"].includes(kind)) throw new AppError("Line {n}: type must be bool, number or text", { n: i + 1 }, "items");
      return {
        id: `i${i + 1}`,
        label,
        kind: kind as ChecklistItem["kind"],
        min: min ? Number(min) : undefined,
        max: max ? Number(max) : undefined,
        critical: /^(yes|true|ccp|critical|1)$/i.test(critical ?? ""),
      };
    });
  if (!items.length) throw new AppError("Add at least one checklist item", {}, "items");
  await withTenant(ctx, async (tx) => {
    const c = await tx.qualityChecklist.create({ data: { tenantId: ctx.tenantId, name: input.name, type: input.type, description: input.description, items: items as unknown as Prisma.InputJsonValue } });
    await audit(tx, ctx, { action: "checklist.create", entityType: "quality_checklist", entityId: c.id, summary: `${c.name} (${items.length} items)` });
  });
  return { ok: true, message: "Checklist created" };
});

const ncSchema = z.object({
  title: zStr(200),
  description: zStr(4000),
  severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
  source: z.enum(["QC_INSPECTION", "CUSTOMER_COMPLAINT", "AUDIT", "TEMPERATURE", "PRODUCTION", "SUPPLIER"]),
  batchCode: zOptStr(60),
  responsibleName: zOptStr(120),
  dueDate: z.string().optional(),
});
export const createNcAction = defineAction({ permission: "quality.operate", schema: ncSchema }, async (ctx, input) => {
  const nc = await withTenant(ctx, async (tx) => {
    let batchId: string | null = null;
    if (input.batchCode) {
      const b = await tx.productionBatch.findFirst({ where: { code: { equals: input.batchCode, mode: "insensitive" } } });
      if (!b) throw new AppError("Batch not found", {}, "batchCode");
      batchId = b.id;
    }
    return createNonconformity(tx, ctx, { ...input, batchId, dueDate: input.dueDate ? new Date(`${input.dueDate}T18:00:00Z`) : null });
  });
  return { ok: true, message: "Non-conformity {n} opened", params: { n: nc.number }, redirectTo: `/app/quality/nonconformities/${nc.id}` };
});

const ncUpdateSchema = z.object({ id: zId, status: z.enum(["OPEN", "INVESTIGATING", "ACTION", "CLOSED"]), rootCause: zOptStr(4000), responsibleName: zOptStr(120) });
export const updateNcAction = defineAction({ permission: "quality.manage", schema: ncUpdateSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => updateNonconformity(tx, ctx, input));
  return { ok: true, message: input.status === "CLOSED" ? "Non-conformity closed" : "Non-conformity updated" };
});

const capaSchema = z.object({ nonconformityId: zId, type: z.enum(["CORRECTIVE", "PREVENTIVE"]), description: zStr(1000), responsibleName: zOptStr(120), dueDate: z.string().optional() });
export const addCapaAction = defineAction({ permission: "quality.operate", schema: capaSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => addCapa(tx, ctx, { ...input, dueDate: input.dueDate ? new Date(`${input.dueDate}T18:00:00Z`) : null }));
  return { ok: true, message: "Action added" };
});

const idSchema = z.object({ id: zId });
export const completeCapaAction = defineAction({ permission: "quality.operate", schema: idSchema }, async (ctx, { id }) => {
  await withTenant(ctx, (tx) => completeCapa(tx, ctx, id));
  return { ok: true, message: "Action completed" };
});
