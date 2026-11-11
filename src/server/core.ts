import type { Tx } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { TenantSettings } from "@/lib/settings";
import { localDateKey } from "@/lib/tz";

/** Context passed to every domain service. Built from the session (or by the seeder). */
export interface ServiceCtx {
  tenantId: string;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  tz: string;
  settings: TenantSettings;
  /** Overridable clock — used by the demo simulation; defaults to wall time. */
  now?: Date;
}

export const nowOf = (ctx: ServiceCtx) => ctx.now ?? new Date();

/** Atomic per-tenant counter. */
export async function nextSequence(tx: Tx, tenantId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO sequences (id, "tenantId", key, value)
    VALUES (gen_random_uuid()::text, ${tenantId}, ${key}, 1)
    ON CONFLICT ("tenantId", key) DO UPDATE SET value = sequences.value + 1
    RETURNING value`;
  return Number(rows[0].value);
}

/** Human-readable document numbers, e.g. SO-2026-00042. */
export async function nextNumber(tx: Tx, ctx: ServiceCtx, prefix: string, width = 5): Promise<string> {
  const year = localDateKey(nowOf(ctx), ctx.tz).slice(0, 4);
  const n = await nextSequence(tx, ctx.tenantId, `${prefix}:${year}`);
  return `${prefix}-${year}-${String(n).padStart(width, "0")}`;
}

export const BATCH_TOKENS = ["{PREFIX}", "{YYYY}", "{YY}", "{MM}", "{DD}", "{YYYYMMDD}", "{FARM}", "{SUPPLIER}", "{FACILITY}", "{SEQ}", "{SEQ4}", "{SEQ6}"];

export function validateBatchFormat(format: string): string | null {
  if (!/\{SEQ\d?\}/.test(format)) return "Batch format must contain a sequence token ({SEQ}, {SEQ4} or {SEQ6})";
  const unknown = format.match(/\{[A-Z0-9]+\}/g)?.filter((t) => !BATCH_TOKENS.includes(t));
  if (unknown?.length) return `Unknown token(s): ${unknown.join(", ")}`;
  if (format.length > 60) return "Batch format is too long";
  return null;
}

export function renderBatchCode(
  format: string,
  v: { prefix: string; dateKey: string; farm: string; supplier: string; facility: string; seq: number },
): string {
  const [y, m, d] = v.dateKey.split("-");
  return format
    .replaceAll("{PREFIX}", v.prefix)
    .replaceAll("{YYYYMMDD}", `${y}${m}${d}`)
    .replaceAll("{YYYY}", y)
    .replaceAll("{YY}", y.slice(2))
    .replaceAll("{MM}", m)
    .replaceAll("{DD}", d)
    .replaceAll("{FARM}", v.farm)
    .replaceAll("{SUPPLIER}", v.supplier)
    .replaceAll("{FACILITY}", v.facility)
    .replaceAll("{SEQ6}", String(v.seq).padStart(6, "0"))
    .replaceAll("{SEQ4}", String(v.seq).padStart(4, "0"))
    .replaceAll("{SEQ}", String(v.seq));
}

export async function audit(
  tx: Tx,
  ctx: ServiceCtx,
  entry: { action: string; entityType: string; entityId?: string | null; summary?: string; changes?: unknown },
) {
  await tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      userEmail: ctx.userEmail ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes: entry.changes === undefined ? Prisma.JsonNull : (entry.changes as Prisma.InputJsonValue),
      createdAt: nowOf(ctx),
    },
  });
}

export async function traceEvent(
  tx: Tx,
  ctx: ServiceCtx,
  e: {
    batchId: string;
    eventType: string;
    description: string;
    quantityKg?: number | null;
    location?: string | null;
    entityType?: string;
    entityId?: string;
    at?: Date;
  },
) {
  await tx.batchTraceability.create({
    data: {
      tenantId: ctx.tenantId,
      batchId: e.batchId,
      eventType: e.eventType,
      description: e.description,
      quantityKg: e.quantityKg ?? null,
      location: e.location ?? null,
      entityType: e.entityType,
      entityId: e.entityId,
      userId: ctx.userId ?? null,
      occurredAt: e.at ?? nowOf(ctx),
    },
  });
}

export async function notify(
  tx: Tx,
  ctx: ServiceCtx,
  n: {
    type: string;
    severity?: "INFO" | "WARNING" | "CRITICAL";
    title: string;
    message: string;
    link?: string;
    entityType?: string;
    entityId?: string;
    dedupeKey?: string;
  },
): Promise<boolean> {
  if (n.dedupeKey) {
    const exists = await tx.notification.findUnique({
      where: { tenantId_dedupeKey: { tenantId: ctx.tenantId, dedupeKey: n.dedupeKey } },
      select: { id: true },
    });
    if (exists) return false;
  }
  await tx.notification.create({
    data: {
      tenantId: ctx.tenantId,
      type: n.type,
      severity: n.severity ?? "INFO",
      title: n.title,
      message: n.message,
      link: n.link,
      entityType: n.entityType,
      entityId: n.entityId,
      dedupeKey: n.dedupeKey,
      createdAt: nowOf(ctx),
    },
  });
  return true;
}

/** Shallow diff of two plain objects for audit logs. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k] instanceof Date ? (before[k] as Date).toISOString() : before[k];
    const b = after[k] instanceof Date ? (after[k] as Date).toISOString() : after[k];
    if (String(a ?? "") !== String(b ?? "")) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}
