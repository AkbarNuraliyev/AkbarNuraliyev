import type { Tx } from "@/lib/prisma";
import { AppError, assert } from "@/lib/errors";
import { num, round } from "@/lib/format";
import { audit, nextSequence, nowOf, traceEvent, type ServiceCtx } from "../core";

/** EAN-13 check digit. */
export function ean13CheckDigit(first12: string): number {
  const digits = first12.split("").map(Number);
  const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

/**
 * In-store variable-measure EAN-13: "22" + 5-digit PLU + 5-digit weight in grams + check digit.
 * Max encodable weight 99.999 kg.
 */
export function variableWeightBarcode(plu: string, weightKg: number): string {
  const p = plu.replace(/\D/g, "").padStart(5, "0").slice(-5);
  const grams = Math.round(weightKg * 1000);
  if (grams <= 0 || grams > 99999) throw new AppError("Weight must be between 0.001 and 99.999 kg for a variable-weight barcode");
  const first12 = `22${p}${String(grams).padStart(5, "0")}`;
  return first12 + ean13CheckDigit(first12);
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export async function createLabels(
  tx: Tx,
  ctx: ServiceCtx,
  input: { inventoryId: string; templateId?: string | null; weights: number[]; copies?: number },
) {
  const lot = await tx.inventory.findUnique({ where: { id: input.inventoryId }, include: { product: true, batch: true } });
  assert(lot, "Inventory lot not found", {}, "inventoryId");
  if (lot.status === "BLOCKED") throw new AppError("Labels cannot be printed for blocked stock");
  assert(input.weights.length > 0 && input.weights.length <= 500, "Enter between 1 and 500 pack weights", {}, "weights");
  const total = input.weights.reduce((a, b) => a + b, 0);
  if (total > lot.quantityKg + 0.01) throw new AppError("Total labelled weight ({kg} kg) exceeds the lot quantity ({lot} kg)", { kg: round(total, 3), lot: round(lot.quantityKg, 3) }, "weights");
  const product = lot.product;
  if (!product.isVariableWeight && product.netWeightKg) {
    for (const w of input.weights) if (Math.abs(w - product.netWeightKg) > 0.0005) throw new AppError("This product has a fixed net weight of {kg} kg", { kg: product.netWeightKg }, "weights");
  }
  const labels = [];
  for (const w of input.weights) {
    assert(w > 0, "Pack weights must be greater than zero", {}, "weights");
    const seq = await nextSequence(tx, ctx.tenantId, "label");
    const serial = `L${String(seq).padStart(8, "0")}`;
    const barcode = product.isVariableWeight ? variableWeightBarcode(product.pluCode ?? product.sku, w) : product.barcode ?? variableWeightBarcode(product.pluCode ?? product.sku, w);
    const price = num(product.price);
    labels.push(
      await tx.label.create({
        data: {
          tenantId: ctx.tenantId,
          serial,
          templateId: input.templateId ?? null,
          productId: product.id,
          batchId: lot.batchId,
          inventoryId: lot.id,
          netWeightKg: round(w, 3),
          unitPrice: price,
          totalPrice: round(price * w, 2),
          productionDate: lot.productionDate,
          expiryDate: lot.expiryDate,
          barcode,
          copies: input.copies ?? 1,
          printedAt: nowOf(ctx),
          printedById: ctx.userId ?? null,
        },
      }),
    );
  }
  await traceEvent(tx, ctx, {
    batchId: lot.batchId,
    eventType: "LABELLED",
    description: `${labels.length} label(s) generated for ${product.name} (${round(total, 3)} kg)`,
    quantityKg: total,
    entityType: "inventory",
    entityId: lot.id,
  });
  await audit(tx, ctx, { action: "labels.create", entityType: "inventory", entityId: lot.id, summary: `${labels.length} label(s) ${labels[0].serial}…` });
  return labels;
}
