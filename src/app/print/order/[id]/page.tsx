import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { withTenant } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { fmtDate, fmtDateTime, fmtDay, fmtKg, fmtMoney, num } from "@/lib/format";
import { PrintButton } from "@/components/app/print-button";

/** Printable order documents: pick list, delivery note and (internal) invoice. Accessible to staff and to the ordering customer. */
export default async function PrintOrder({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc = "invoice" } = await searchParams;
  const s = await getSession();
  if (!s?.tenant || !s.membership) redirect("/login");
  const { t } = await getI18n();
  const isPortal = s.membership.isPortal;
  if (!isPortal && !s.permissions.has("orders.view")) redirect("/app/forbidden");
  const tz = s.tenant.timezone;
  const order = await withTenant({ tenantId: s.tenant.id }, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: s.tenant!.id } });
    const o = await tx.order.findUnique({
      where: { id },
      include: { customer: true, invoice: true, items: { include: { product: true, allocations: { where: { status: { not: "RELEASED" } }, include: { inventory: { include: { batch: true, warehouse: true, chamber: true } } } } } } },
    });
    return o ? { ...o, tenant } : null;
  });
  if (!order || (isPortal && order.customerId !== s.membership.customerId)) notFound();
  if (isPortal && doc === "picklist") notFound();
  const title = doc === "picklist" ? t("Pick list") : doc === "delivery" ? t("Delivery note") : t("Invoice");
  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <style>{`@page { size: A4; margin: 14mm }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center gap-3">
        <PrintButton />
        {doc === "invoice" && <span className="text-[12.5px] text-ink-3">{t("Internal invoice document. Electronic invoicing (Didox / Faktura.uz) is not connected.")}</span>}
      </div>
      <div className="mx-auto max-w-[210mm] bg-white p-10 text-[12px] text-black shadow print:p-0 print:shadow-none">
        <div className="flex justify-between gap-6 border-b border-slate-300 pb-4">
          <div>
            <div className="text-lg font-bold">{order.tenant.legalName ?? order.tenant.name}</div>
            <div className="text-slate-600">{order.tenant.address}</div>
            {order.tenant.taxId && <div className="text-slate-600">{t("TIN")}: {order.tenant.taxId}</div>}
          </div>
          <div className="text-right">
            <div className="text-xl font-bold">{title}</div>
            <div>{doc === "invoice" && order.invoice ? order.invoice.number : order.number}</div>
            <div className="text-slate-600">{fmtDate(doc === "invoice" && order.invoice ? order.invoice.issuedAt : new Date(), tz)}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] uppercase text-slate-500">{t("Customer")}</div>
            <div className="font-semibold">{order.customer.name}</div>
            <div>{order.customer.address}</div>
            {order.customer.taxId && <div>{t("TIN")}: {order.customer.taxId}</div>}
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-500">{t("Order")}</div>
            <div>{order.number} · {t("Delivery")} {fmtDay(order.requestedDeliveryDate)}</div>
            <div>{t("Delivery address")}: {order.deliveryAddress}</div>
            {order.externalRef && <div>{t("Ref")}: {order.externalRef}</div>}
            {doc === "invoice" && order.invoice && <div>{t("Due date")}: {fmtDate(order.invoice.dueAt, tz)}</div>}
          </div>
        </div>
        <table className="mt-6 w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-400 text-left">
              <th className="py-1.5">{t("Product")}</th>
              {doc === "picklist" && <th>{t("Batch / location (FEFO)")}</th>}
              {doc !== "picklist" && <th>{t("Batches")}</th>}
              <th className="text-right">{doc === "picklist" ? t("To pick, kg") : doc === "delivery" ? t("Shipped, kg") : t("Delivered, kg")}</th>
              {doc === "invoice" && <th className="text-right">{t("Price")}</th>}
              {doc === "invoice" && <th className="text-right">{t("Amount")}</th>}
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => {
              const qty = doc === "invoice" ? i.deliveredKg : doc === "delivery" ? i.allocations.filter((a) => a.status === "SHIPPED").reduce((x, a) => x + a.quantityKg, 0) : i.allocations.reduce((x, a) => x + a.quantityKg, 0);
              return (
                <tr key={i.id} className="border-b border-slate-200 align-top">
                  <td className="py-1.5">{i.product.name}<div className="text-[10px] text-slate-500">{i.product.sku} · {t("ordered")} {fmtKg(i.quantityKg, 2)}</div></td>
                  <td className="py-1.5 font-mono text-[10.5px]">
                    {i.allocations.map((a) => (
                      <div key={a.id}>
                        {a.inventory.batch.code} {doc === "picklist" && <>· {a.inventory.warehouse.name}{a.inventory.chamber ? ` / ${a.inventory.chamber.name}` : ""} · {t("exp.")} {fmtDateTime(a.inventory.expiryDate, tz)} · {a.quantityKg.toFixed(3)}</>}
                      </div>
                    ))}
                  </td>
                  <td className="py-1.5 text-right">{qty.toFixed(3)}</td>
                  {doc === "invoice" && <td className="py-1.5 text-right">{fmtMoney(i.unitPrice)}</td>}
                  {doc === "invoice" && <td className="py-1.5 text-right">{fmtMoney(num(i.unitPrice) * i.deliveredKg)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {doc === "invoice" && (
          <div className="mt-4 text-right text-base font-bold">{t("Total")}: {fmtMoney(order.invoice?.amount ?? order.total)}</div>
        )}
        <div className="mt-12 grid grid-cols-2 gap-10 text-[11px]">
          <div className="border-t border-slate-400 pt-1">{doc === "picklist" ? t("Picked by") : t("Issued by")}</div>
          <div className="border-t border-slate-400 pt-1">{doc === "picklist" ? t("Checked by") : t("Received by")}</div>
        </div>
      </div>
    </div>
  );
}
