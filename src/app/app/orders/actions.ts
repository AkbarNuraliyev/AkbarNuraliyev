"use server";

import { z } from "zod";
import Papa from "papaparse";
import { defineAction, zDate, zId, zJson, zOptStr, zStr } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { allocateOrder, cancelOrder, completePicking, confirmDelivery, confirmOrder, createOrder, dispatchOrder, recordInvoicePayment, startPicking } from "@/server/services/orders";
import { audit } from "@/server/core";

const itemsSchema = z.array(z.object({ productId: z.string().min(1), quantityKg: z.number().positive("Quantities must be greater than zero") })).min(1, "Add at least one product to the order");
const createSchema = z.object({
  customerId: zId,
  requestedDeliveryDate: zDate,
  deliveryAddress: zOptStr(300),
  notes: zOptStr(1000),
  externalRef: zOptStr(60),
  items: zJson(itemsSchema),
});

export const createOrderAction = defineAction({ permission: "orders.operate", schema: createSchema }, async (ctx, input) => {
  const order = await withTenant(ctx, (tx) => createOrder(tx, ctx, { ...input, source: "MANUAL" }));
  return { ok: true, message: "Order {n} created", params: { n: order.number }, redirectTo: `/app/orders/${order.id}` };
});

const idSchema = z.object({ id: zId });

export const confirmOrderAction = defineAction({ permission: "orders.operate", schema: idSchema }, async (ctx, { id }) => {
  await withTenant(ctx, (tx) => confirmOrder(tx, ctx, id));
  return { ok: true, message: "Order confirmed" };
});

export const allocateOrderAction = defineAction({ permission: "orders.operate", schema: idSchema }, async (ctx, { id }) => {
  const r = await withTenant(ctx, (tx) => allocateOrder(tx, ctx, id));
  return r.shortageKg > 0
    ? { ok: true, message: "Allocated by FEFO. Shortage {kg} kg remains — re-run allocation after production.", params: { kg: r.shortageKg.toFixed(1) } }
    : { ok: true, message: "Fully allocated by FEFO (earliest expiry first)" };
});

export const startPickingAction = defineAction({ permission: "orders.operate", schema: idSchema }, async (ctx, { id }) => {
  await withTenant(ctx, (tx) => startPicking(tx, ctx, id));
  return { ok: true, message: "Picking started" };
});

export const completePickingAction = defineAction({ permission: "orders.operate", schema: idSchema }, async (ctx, { id }, fd) => {
  const picked: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("p_") || typeof v !== "string" || v === "") continue;
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) throw new AppError("Picked quantities must be zero or positive numbers");
    picked[k.slice(2)] = n;
  }
  await withTenant(ctx, (tx) => completePicking(tx, ctx, id, picked));
  return { ok: true, message: "Picking completed — order is ready for dispatch" };
});

export const dispatchOrderAction = defineAction({ permission: "orders.operate", schema: idSchema }, async (ctx, { id }) => {
  await withTenant(ctx, (tx) => dispatchOrder(tx, ctx, id));
  return { ok: true, message: "Order dispatched — stock deducted" };
});

const deliverySchema = z.object({ id: zId, receivedBy: zStr(120), note: zOptStr(500) });
export const confirmDeliveryAction = defineAction({ permission: "orders.operate", schema: deliverySchema }, async (ctx, input, fd) => {
  const delivered: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("d_") || typeof v !== "string" || v === "") continue;
    delivered[k.slice(2)] = Number(v.replace(",", "."));
  }
  const r = await withTenant(ctx, (tx) => confirmDelivery(tx, ctx, input.id, { delivered, receivedBy: input.receivedBy, note: input.note }));
  return { ok: true, message: "Delivery confirmed ({status}). Invoice {inv} issued.", params: { status: r.status === "DELIVERED" ? "in full" : "partial", inv: r.invoiceNumber } };
});

const cancelSchema = z.object({ id: zId, reason: zStr(300) });
export const cancelOrderAction = defineAction({ permission: "orders.manage", schema: cancelSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => cancelOrder(tx, ctx, input.id, input.reason));
  return { ok: true, message: "Order cancelled — reservations released" };
});

const paymentSchema = z.object({ invoiceId: zId, amount: z.coerce.number().positive("Amount must be greater than zero"), paidAt: zDate, method: z.enum(["BANK_TRANSFER", "CASH", "CARD", "OFFSET"]), reference: zOptStr(80) });
export const recordPaymentAction = defineAction({ permission: "sales.operate", schema: paymentSchema }, async (ctx, input) => {
  await withTenant(ctx, (tx) => recordInvoicePayment(tx, ctx, { ...input, paidAt: new Date(`${input.paidAt}T12:00:00Z`) }));
  return { ok: true, message: "Payment recorded" };
});

/** Spreadsheet import: CSV or XLSX with columns customer_code, delivery_date, sku, quantity_kg [, external_ref, notes]. */
export const importOrdersAction = defineAction({ permission: "orders.operate", schema: z.object({}) }, async (ctx, _input, fd) => {
  const file = fd.get("file") as File | null;
  if (!file || file.size === 0) throw new AppError("Select a CSV or Excel file", {}, "file");
  if (file.size > 2 * 1024 * 1024) throw new AppError("File is too large (max 2 MB)", {}, "file");
  const buf = Buffer.from(await file.arrayBuffer());
  let rows: Record<string, string>[] = [];
  if (buf.subarray(0, 2).toString("latin1") === "PK") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const header: string[] = [];
    ws.getRow(1).eachCell((c, i) => (header[i] = String(c.value ?? "").trim().toLowerCase()));
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const r: Record<string, string> = {};
      row.eachCell((c, i) => {
        const v = c.value instanceof Date ? c.value.toISOString().slice(0, 10) : String((c.value as { result?: unknown })?.result ?? c.value ?? "");
        if (header[i]) r[header[i]] = v.trim();
      });
      if (Object.keys(r).length) rows.push(r);
    });
  } else {
    const parsed = Papa.parse<Record<string, string>>(buf.toString("utf8").replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
    rows = parsed.data;
  }
  if (!rows.length) throw new AppError("The file contains no rows");
  if (rows.length > 2000) throw new AppError("Too many rows (max 2000)");
  const result = await withTenant(ctx, async (tx) => {
    const [customers, products] = await Promise.all([tx.customer.findMany({ select: { id: true, code: true } }), tx.product.findMany({ select: { id: true, sku: true } })]);
    const cMap = new Map(customers.map((c) => [c.code.toUpperCase(), c.id]));
    const pMap = new Map(products.map((p) => [p.sku.toUpperCase(), p.id]));
    const groups = new Map<string, { customerId: string; date: string; ref: string | null; notes: string | null; items: Map<string, number> }>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const cid = cMap.get((r.customer_code ?? "").toUpperCase());
      const pid = pMap.get((r.sku ?? "").toUpperCase());
      const date = (r.delivery_date ?? "").trim();
      const qty = Number(String(r.quantity_kg ?? "").replace(",", "."));
      if (!cid) throw new AppError("Row {line}: unknown customer code '{v}'", { line, v: r.customer_code ?? "" });
      if (!pid) throw new AppError("Row {line}: unknown SKU '{v}'", { line, v: r.sku ?? "" });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("Row {line}: delivery_date must be YYYY-MM-DD", { line });
      if (!Number.isFinite(qty) || qty <= 0) throw new AppError("Row {line}: quantity_kg must be a positive number", { line });
      const key = `${cid}|${date}|${r.external_ref ?? ""}`;
      const g = groups.get(key) ?? { customerId: cid, date, ref: r.external_ref || null, notes: r.notes || null, items: new Map() };
      g.items.set(pid, (g.items.get(pid) ?? 0) + qty);
      groups.set(key, g);
    });
    const numbers: string[] = [];
    for (const g of groups.values()) {
      const o = await createOrder(tx, ctx, {
        customerId: g.customerId,
        requestedDeliveryDate: g.date,
        externalRef: g.ref,
        notes: g.notes,
        source: "IMPORT",
        items: [...g.items.entries()].map(([productId, quantityKg]) => ({ productId, quantityKg })),
      });
      numbers.push(o.number);
    }
    await audit(tx, ctx, { action: "order.import", entityType: "order", summary: `${file.name}: ${rows.length} rows → ${numbers.length} orders` });
    return numbers;
  });
  return { ok: true, message: "Imported {n} order(s) from {rows} rows", params: { n: result.length, rows: rows.length }, redirectTo: "/app/orders?source=IMPORT" };
});
