import type { Tx } from "@/lib/prisma";
import { Prisma, type NcSource, type Severity, type NcStatus } from "@prisma/client";
import { AppError, assert } from "@/lib/errors";
import { audit, nextNumber, notify, nowOf, traceEvent, type ServiceCtx } from "../core";

export interface ChecklistItem {
  id: string;
  label: string;
  kind: "bool" | "number" | "text";
  min?: number;
  max?: number;
  critical?: boolean;
}

export function evaluateResponses(items: ChecklistItem[], responses: Record<string, string | undefined>) {
  const results: { id: string; label: string; value: string | number | boolean | null; ok: boolean; critical: boolean }[] = [];
  for (const item of items) {
    const raw = responses[item.id];
    let value: string | number | boolean | null = null;
    let ok = true;
    if (item.kind === "bool") {
      value = raw === "yes" || raw === "on" || raw === "true";
      if (raw === undefined) throw new AppError("Answer all checklist items ({item})", { item: item.label }, `r_${item.id}`);
      ok = value === true;
    } else if (item.kind === "number") {
      if (raw === undefined || raw === "") throw new AppError("Enter a value for {item}", { item: item.label }, `r_${item.id}`);
      const n = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n)) throw new AppError("Enter a valid number for {item}", { item: item.label }, `r_${item.id}`);
      value = n;
      ok = (item.min === undefined || n >= item.min) && (item.max === undefined || n <= item.max);
    } else {
      value = raw ?? null;
    }
    results.push({ id: item.id, label: item.label, value, ok, critical: !!item.critical });
  }
  const failed = results.filter((r) => !r.ok);
  return { results, failed, result: failed.some((f) => f.critical) || failed.length >= 2 ? ("FAIL" as const) : ("PASS" as const) };
}

export async function recordQuality(
  tx: Tx,
  ctx: ServiceCtx,
  input: {
    checklistId: string;
    area: string;
    entityType?: string | null;
    entityId?: string | null;
    batchId?: string | null;
    responses: Record<string, string | undefined>;
    notes?: string | null;
    performedAt?: Date;
  },
) {
  const cl = await tx.qualityChecklist.findUnique({ where: { id: input.checklistId } });
  assert(cl && cl.isActive, "Checklist not found", {}, "checklistId");
  const items = cl.items as unknown as ChecklistItem[];
  const ev = evaluateResponses(items, input.responses);
  if (input.batchId) {
    const b = await tx.productionBatch.findUnique({ where: { id: input.batchId } });
    assert(b, "Batch not found", {}, "batchId");
  }
  const number = await nextNumber(tx, ctx, "QC");
  const rec = await tx.qualityRecord.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      checklistId: cl.id,
      area: input.area,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      batchId: input.batchId ?? null,
      responses: ev.results as unknown as Prisma.InputJsonValue,
      result: ev.result,
      notes: input.notes ?? null,
      performedById: ctx.userId ?? null,
      performedByName: ctx.userName ?? null,
      performedAt: input.performedAt ?? nowOf(ctx),
      createdAt: nowOf(ctx),
    },
  });
  if (input.batchId) {
    await traceEvent(tx, ctx, {
      batchId: input.batchId,
      eventType: "QC",
      description: `${cl.name}: ${ev.result}${ev.failed.length ? " — failed: " + ev.failed.map((f) => f.label).join("; ") : ""}`,
      entityType: "quality_record",
      entityId: rec.id,
    });
  }
  let nc = null;
  if (ev.result === "FAIL") {
    nc = await createNonconformity(tx, ctx, {
      title: `${cl.name} failed (${input.area})`,
      description: ev.failed.map((f) => `${f.label}: ${String(f.value)}`).join("\n"),
      severity: ev.failed.some((f) => f.critical) ? "MAJOR" : "MINOR",
      source: "QC_INSPECTION",
      batchId: input.batchId ?? null,
      qualityRecordId: rec.id,
    });
  }
  await audit(tx, ctx, { action: "quality.record", entityType: "quality_record", entityId: rec.id, summary: `${number} ${cl.name}: ${ev.result}` });
  return { record: rec, nonconformity: nc, evaluation: ev };
}

export async function createNonconformity(
  tx: Tx,
  ctx: ServiceCtx,
  input: {
    title: string;
    description: string;
    severity: Severity;
    source: NcSource;
    batchId?: string | null;
    customerId?: string | null;
    qualityRecordId?: string | null;
    responsibleName?: string | null;
    dueDate?: Date | null;
  },
) {
  const number = await nextNumber(tx, ctx, "NC");
  const nc = await tx.nonconformity.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      title: input.title,
      description: input.description,
      severity: input.severity,
      source: input.source,
      batchId: input.batchId ?? null,
      customerId: input.customerId ?? null,
      qualityRecordId: input.qualityRecordId ?? null,
      responsibleName: input.responsibleName ?? null,
      dueDate: input.dueDate ?? null,
      createdById: ctx.userId ?? null,
      createdAt: nowOf(ctx),
    },
  });
  if (input.batchId) {
    await traceEvent(tx, ctx, { batchId: input.batchId, eventType: "NONCONFORMITY", description: `${number}: ${input.title}`, entityType: "nonconformity", entityId: nc.id });
  }
  await notify(tx, ctx, {
    type: "NONCONFORMITY",
    severity: input.severity === "MINOR" ? "WARNING" : "CRITICAL",
    title: "Non-conformity {number}: {title}",
    message: "{text}",
    params: { number, title: input.title, text: input.description.slice(0, 300) },
    link: `/app/quality/nonconformities/${nc.id}`,
    entityType: "nonconformity",
    entityId: nc.id,
  });
  await audit(tx, ctx, { action: "nc.create", entityType: "nonconformity", entityId: nc.id, summary: `${number} [${input.severity}] ${input.title}` });
  return nc;
}

export async function updateNonconformity(
  tx: Tx,
  ctx: ServiceCtx,
  input: { id: string; status: NcStatus; rootCause?: string | null; responsibleName?: string | null; dueDate?: Date | null },
) {
  const nc = await tx.nonconformity.findUnique({ where: { id: input.id }, include: { actions: true } });
  assert(nc, "Non-conformity not found");
  if (nc.status === "CLOSED") throw new AppError("This non-conformity is closed");
  if (input.status === "CLOSED") {
    if (!(input.rootCause ?? nc.rootCause)) throw new AppError("Record the root cause before closing", {}, "rootCause");
    if (!nc.actions.some((a) => a.type === "CORRECTIVE")) throw new AppError("Add at least one corrective action before closing");
    if (nc.actions.some((a) => a.status !== "DONE")) throw new AppError("All corrective and preventive actions must be completed before closing");
  }
  await tx.nonconformity.update({
    where: { id: nc.id },
    data: {
      status: input.status,
      rootCause: input.rootCause ?? nc.rootCause,
      responsibleName: input.responsibleName ?? nc.responsibleName,
      dueDate: input.dueDate ?? nc.dueDate,
      ...(input.status === "CLOSED" ? { closedAt: nowOf(ctx), closedById: ctx.userId ?? null } : {}),
    },
  });
  await audit(tx, ctx, { action: "nc.update", entityType: "nonconformity", entityId: nc.id, summary: `${nc.number}: ${nc.status} → ${input.status}`, changes: { status: { from: nc.status, to: input.status } } });
}

export async function addCapa(tx: Tx, ctx: ServiceCtx, input: { nonconformityId: string; type: "CORRECTIVE" | "PREVENTIVE"; description: string; responsibleName?: string | null; dueDate?: Date | null }) {
  const nc = await tx.nonconformity.findUnique({ where: { id: input.nonconformityId } });
  assert(nc, "Non-conformity not found");
  if (nc.status === "CLOSED") throw new AppError("This non-conformity is closed");
  await tx.capaAction.create({
    data: { tenantId: ctx.tenantId, nonconformityId: nc.id, type: input.type, description: input.description, responsibleName: input.responsibleName ?? null, dueDate: input.dueDate ?? null, createdAt: nowOf(ctx) },
  });
  if (nc.status === "OPEN" || nc.status === "INVESTIGATING") await tx.nonconformity.update({ where: { id: nc.id }, data: { status: "ACTION" } });
  await audit(tx, ctx, { action: "capa.create", entityType: "nonconformity", entityId: nc.id, summary: `${input.type}: ${input.description}` });
}

export async function completeCapa(tx: Tx, ctx: ServiceCtx, capaId: string) {
  const a = await tx.capaAction.findUnique({ where: { id: capaId } });
  assert(a, "Action not found");
  if (a.status === "DONE") return;
  await tx.capaAction.update({ where: { id: a.id }, data: { status: "DONE", completedAt: nowOf(ctx) } });
  await audit(tx, ctx, { action: "capa.complete", entityType: "nonconformity", entityId: a.nonconformityId, summary: a.description });
}
