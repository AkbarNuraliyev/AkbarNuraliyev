import type { Tx } from "@/lib/prisma";
import { fmtKg, round } from "@/lib/format";
import { addDays, addHours, localDateKey } from "@/lib/tz";
import { notify, nowOf, type ServiceCtx } from "../core";
import { EPS } from "./inventory";

/**
 * Periodic operational checks (expiry, expired stock, low stock, overdue invoices,
 * driver licences). Triggered lazily from the dashboard (max every 10 minutes)
 * and by the /api/cron/checks endpoint.
 */
export async function runChecks(tx: Tx, ctx: ServiceCtx) {
  const now = nowOf(ctx);
  const day = localDateKey(now, ctx.tz);
  let created = 0;

  const soon = await tx.inventory.aggregate({
    where: { quantityKg: { gt: EPS }, status: { not: "BLOCKED" }, expiryDate: { gt: now, lte: addHours(now, 24) } },
    _sum: { quantityKg: true },
    _count: true,
  });
  if (soon._count > 0) {
    if (
      await notify(tx, ctx, {
        type: "EXPIRY",
        severity: "WARNING",
        title: `${soon._count} lot(s) expire within 24 hours`,
        message: `${fmtKg(soon._sum.quantityKg ?? 0)} must be sold or allocated today (FEFO).`,
        link: "/app/inventory?expiring=24",
        dedupeKey: `expiry24:${day}`,
      })
    )
      created++;
  }

  const expired = await tx.inventory.aggregate({
    where: { quantityKg: { gt: EPS }, expiryDate: { lte: now } },
    _sum: { quantityKg: true },
    _count: true,
  });
  if (expired._count > 0) {
    if (
      await notify(tx, ctx, {
        type: "EXPIRED",
        severity: "CRITICAL",
        title: `${expired._count} expired lot(s) still in stock`,
        message: `${fmtKg(expired._sum.quantityKg ?? 0)} has passed its expiry date and must be written off.`,
        link: "/app/inventory?expiring=expired",
        dedupeKey: `expired:${day}`,
      })
    )
      created++;
  }

  const products = await tx.product.findMany({ where: { isActive: true, minStockKg: { gt: 0 } }, select: { id: true, name: true, minStockKg: true } });
  if (products.length) {
    const stock = await tx.inventory.groupBy({
      by: ["productId"],
      where: { quantityKg: { gt: EPS }, status: "AVAILABLE", expiryDate: { gt: now }, warehouse: { type: { not: "RETAIL" } } },
      _sum: { quantityKg: true, reservedKg: true },
    });
    for (const p of products) {
      const s = stock.find((x) => x.productId === p.id);
      const free = (s?._sum.quantityKg ?? 0) - (s?._sum.reservedKg ?? 0);
      if (free < (p.minStockKg ?? 0)) {
        if (
          await notify(tx, ctx, {
            type: "LOW_STOCK",
            severity: "WARNING",
            title: `Low stock: ${p.name}`,
            message: `Free stock ${fmtKg(free)} is below the minimum of ${fmtKg(p.minStockKg)}.`,
            link: `/app/inventory?product=${p.id}`,
            entityType: "product",
            entityId: p.id,
            dedupeKey: `low:${p.id}:${day}`,
          })
        )
          created++;
      }
    }
  }

  const overdue = await tx.salesInvoice.findMany({
    where: { status: { in: ["UNPAID", "PARTIAL"] }, dueAt: { lt: now } },
    include: { customer: true },
    take: 50,
  });
  for (const inv of overdue) {
    if (
      await notify(tx, ctx, {
        type: "OVERDUE_INVOICE",
        severity: "WARNING",
        title: `Overdue invoice ${inv.number} — ${inv.customer.name}`,
        message: `Outstanding ${round(Number(inv.amount) - Number(inv.paidAmount), 0)} UZS, due ${inv.dueAt.toISOString().slice(0, 10)}.`,
        link: `/app/sales/receivables`,
        entityType: "sales_invoice",
        entityId: inv.id,
        dedupeKey: `overdue:${inv.id}`,
      })
    )
      created++;
  }

  const drivers = await tx.driver.findMany({ where: { isActive: true, licenseExpiry: { lte: addDays(now, 30) } } });
  for (const d of drivers) {
    if (
      await notify(tx, ctx, {
        type: "LICENCE_EXPIRY",
        severity: "INFO",
        title: `Driver licence expiring: ${d.name}`,
        message: `Licence ${d.licenseNumber ?? ""} expires ${d.licenseExpiry?.toISOString().slice(0, 10)}.`,
        link: "/app/logistics/drivers",
        dedupeKey: `licence:${d.id}:${d.licenseExpiry?.toISOString().slice(0, 10)}`,
      })
    )
      created++;
  }
  await tx.tenant.update({ where: { id: ctx.tenantId }, data: { lastChecksAt: now } });
  return created;
}
