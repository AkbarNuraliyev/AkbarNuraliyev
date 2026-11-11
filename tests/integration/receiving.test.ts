import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db";
import { localDateKey } from "@/lib/tz";
import { computeReceipt, createReceipt } from "@/server/services/receiving";
import { renderBatchCode, validateBatchFormat } from "@/server/core";
import { makeTenant, receiptInput, type TestTenant } from "./helpers";

let T: TestTenant;
beforeAll(async () => {
  T = await makeTenant("Receiving Co");
});

describe("receipt calculations", () => {
  it("derives net, average, accepted and rejected weights", () => {
    const c = computeReceipt({ ...receiptInput(T), birdsReceived: 2000, birdsDeadOnArrival: 6, birdsRejected: 14, grossWeightKg: 6200, tareWeightKg: 1200, decision: "PARTIAL", rejectionReason: "bruising" });
    expect(c.netWeightKg).toBe(5000);
    expect(c.avgBirdWeightKg).toBe(2.5);
    expect(c.birdsAccepted).toBe(1980);
    expect(c.rejectedWeightKg).toBe(50); // 2.5 kg × 20 birds
    expect(c.acceptedWeightKg).toBe(4950);
    expect(Object.keys(c.errors)).toHaveLength(0);
  });

  it("flags impossible entries", () => {
    expect(computeReceipt({ ...receiptInput(T), birdsDeadOnArrival: 600, birdsRejected: 500 }).errors.birdsRejected).toBeDefined();
    expect(computeReceipt({ ...receiptInput(T), tareWeightKg: 4000 }).errors.tareWeightKg).toBeDefined();
    expect(computeReceipt({ ...receiptInput(T), grossWeightKg: 11000 }).errors.grossWeightKg).toMatch(/implausible/); // 10 kg per bird
    expect(computeReceipt({ ...receiptInput(T), decision: "REJECTED" }).errors.rejectionReason).toBeDefined();
  });
});

describe("batch ID generation", () => {
  it("renders the configurable format", () => {
    expect(renderBatchCode("{PREFIX}-{YYYYMMDD}-{FARM}-{SEQ4}", { prefix: "SAFI", dateKey: "2026-11-11", farm: "FARM001", supplier: "S", facility: "P", seq: 1 })).toBe("SAFI-20261111-FARM001-0001");
    expect(renderBatchCode("{FACILITY}/{YY}{MM}/{SEQ6}", { prefix: "X", dateKey: "2026-03-05", farm: "F", supplier: "S", facility: "PL1", seq: 42 })).toBe("PL1/2603/000042");
    expect(validateBatchFormat("{PREFIX}-{FARM}")).toMatch(/sequence/);
    expect(validateBatchFormat("{PREFIX}-{BOGUS}-{SEQ}")).toMatch(/Unknown token/);
    expect(validateBatchFormat("{PREFIX}-{YYYYMMDD}-{SEQ4}")).toBeNull();
  });

  it("creates a receipt, a unique sequential batch, trace event and audit log", async () => {
    const at = new Date(Date.now() - 2 * 3600000);
    const day = localDateKey(at, "Asia/Tashkent").replaceAll("-", "");
    const r1 = await withTenant(T.ctx, (tx) => createReceipt(tx, T.ctx, receiptInput(T, { receivedAt: at }), { batchFormat: T.batchFormat, batchPrefix: T.batchPrefix }));
    const r2 = await withTenant(T.ctx, (tx) => createReceipt(tx, T.ctx, receiptInput(T, { receivedAt: at }), { batchFormat: T.batchFormat, batchPrefix: T.batchPrefix }));
    expect(r1.batch.code).toBe(`TEST-${day}-FARM001-0001`);
    expect(r2.batch.code).toBe(`TEST-${day}-FARM001-0002`);
    expect(r1.batch.status).toBe("RECEIVED");
    expect(r1.batch.liveWeightKg).toBe(2500);
    expect(r1.batch.publicToken).toMatch(/^[A-Z0-9]{12}$/);
    const events = await withTenant(T.ctx, (tx) => tx.batchTraceability.findMany({ where: { batchId: r1.batch.id } }));
    expect(events.map((e) => e.eventType)).toContain("RECEIVED");
    const audits = await withTenant(T.ctx, (tx) => tx.auditLog.findMany({ where: { entityId: r1.receipt.id } }));
    expect(audits[0].action).toBe("receipt.create");
    expect(r1.receipt.createdById).toBe(T.ownerId);
  });

  it("a rejected delivery creates a REJECTED batch with zero accepted weight and a critical alert", async () => {
    const r = await withTenant(T.ctx, (tx) =>
      createReceipt(tx, T.ctx, receiptInput(T, { decision: "REJECTED", rejectionReason: "No veterinary certificate" }), { batchFormat: T.batchFormat, batchPrefix: T.batchPrefix }),
    );
    expect(r.batch.status).toBe("REJECTED");
    expect(r.receipt.acceptedWeightKg).toBe(0);
    expect(r.receipt.birdsAccepted).toBe(0);
    const n = await withTenant(T.ctx, (tx) => tx.notification.findFirst({ where: { entityId: r.receipt.id } }));
    expect(n?.severity).toBe("CRITICAL");
  });

  it("rejects a farm that belongs to another supplier and future timestamps", async () => {
    const other = await withTenant(T.ctx, async (tx) => tx.supplier.create({ data: { tenantId: T.tenantId, code: "SUP2", name: "Other" } }));
    await expect(withTenant(T.ctx, (tx) => createReceipt(tx, T.ctx, receiptInput(T, { supplierId: other.id }), { batchFormat: T.batchFormat, batchPrefix: T.batchPrefix }))).rejects.toThrow(/does not belong/);
    await expect(
      withTenant(T.ctx, (tx) => createReceipt(tx, T.ctx, receiptInput(T, { receivedAt: new Date(Date.now() + 86400000) }), { batchFormat: T.batchFormat, batchPrefix: T.batchPrefix })),
    ).rejects.toThrow(/future/);
  });
});
