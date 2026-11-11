"use server";

import { z } from "zod";
import { defineAction, zId, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addRecallAction, blockBatch, closeRecall, initiateRecall } from "@/server/services/traceability";
import { createNonconformity } from "@/server/services/quality";

const blockSchema = z.object({ id: zId, reason: zStr(300) });
export const blockBatchAction = defineAction({ permission: "traceability.recall", schema: blockSchema }, async (ctx, input) => {
  const r = await withTenant(ctx, (tx) => blockBatch(tx, ctx, input.id, input.reason));
  return { ok: true, message: "Batch blocked: {kg} kg in {lots} lot(s)", params: { kg: r.blockedKg.toFixed(1), lots: r.lots } };
});

const recallSchema = z.object({ batchId: zId, reason: zStr(1000) });
export const initiateRecallAction = defineAction({ permission: "traceability.recall", feature: "recall", schema: recallSchema }, async (ctx, input) => {
  const r = await withTenant(ctx, (tx) => initiateRecall(tx, ctx, input));
  return { ok: true, message: "Recall {n} initiated — all stock of the batch is blocked", params: { n: r.number } };
});

const recallActionSchema = z.object({ recallId: zId, actionType: z.enum(["NOTIFY_CUSTOMER", "RETRIEVE", "DESTROY", "AUTHORITY_NOTIFIED", "INVESTIGATION", "NOTE"]), description: zStr(1000) });
export const addRecallActionAction = defineAction({ permission: "traceability.recall", feature: "recall", schema: recallActionSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => addRecallAction(tx, ctx, input));
  return { ok: true, message: "Recall action recorded" };
});

const closeSchema = z.object({ recallId: zId, summary: zStr(1000) });
export const closeRecallAction = defineAction({ permission: "traceability.recall", feature: "recall", schema: closeSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => closeRecall(tx, ctx, input));
  return { ok: true, message: "Recall closed" };
});

const complaintSchema = z.object({ batchId: zId, customerId: z.string().optional(), title: zStr(200), description: zStr(2000), severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]) });
export const logComplaintAction = defineAction({ permission: "traceability.view", schema: complaintSchema }, async (ctx, input) => {
  if (!ctx.can("quality.operate") && !ctx.can("traceability.recall")) throw new AppError("You do not have permission to perform this action");
  const nc = await withTenant(ctx, (tx) => createNonconformity(tx, ctx, { ...input, customerId: input.customerId || null, source: "CUSTOMER_COMPLAINT" }));
  return { ok: true, message: "Complaint registered as {n}", params: { n: nc.number } };
});
