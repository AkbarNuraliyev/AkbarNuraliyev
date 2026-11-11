import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Printer } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtDay, fmtKg, fmtMoney, num } from "@/lib/format";
import { localDateKey } from "@/lib/tz";
import { Alert, Card, CardHeader, DescriptionList, LinkButton, PageHeader, Pill, cx } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { statusLabel } from "@/lib/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { ORDER_FLOW, CANCELLABLE } from "@/server/services/orders";
import {
  allocateOrderAction, cancelOrderAction, completePickingAction, confirmDeliveryAction, confirmOrderAction, dispatchOrderAction, recordPaymentAction, startPickingAction,
} from "../actions";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "orders.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: {
        customer: { include: { priceList: true } },
        items: { include: { product: true, allocations: { include: { inventory: { include: { batch: true, warehouse: true, chamber: true } } }, orderBy: { createdAt: "asc" } } } },
        history: { orderBy: { createdAt: "asc" } },
        stops: { include: { shipment: { include: { vehicle: true, driver: true } } } },
        invoice: { include: { payments: { orderBy: { paidAt: "asc" } } } },
      },
    });
    if (!order) return null;
    const users = await tx.membership.findMany({ where: { userId: { in: order.history.map((h) => h.userId).filter(Boolean) as string[] } }, include: { user: { select: { id: true, name: true } } } });
    return { order, users };
  });
  if (!data) notFound();
  const { order } = data;
  const t = ctx.t;
  const can = ctx.can("orders.operate");
  const userName = (uid: string | null) => data.users.find((u) => u.userId === uid)?.user.name ?? (uid ? "—" : t("System / customer"));
  const ordered = order.items.reduce((s, i) => s + i.quantityKg, 0);
  const allocated = order.items.reduce((s, i) => s + i.allocatedKg, 0);
  const shortage = Math.max(0, ordered - allocated);
  const flowIndex = ORDER_FLOW.indexOf(order.status === "PARTIALLY_DELIVERED" ? "DELIVERED" : order.status);
  const activeStop = order.stops.find((s) => s.shipment.status !== "CANCELLED");
  const today = localDateKey(new Date(), ctx.tz);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("B2B Orders"), href: "/app/orders" }, { label: order.number }]}
        title={`${t("Order")} ${order.number}`}
        description={
          <>
            <Link href={`/app/sales/customers/${order.customerId}`} className="link">{order.customer.name}</Link> · {t("Delivery")} {fmtDay(order.requestedDeliveryDate)} · {t(statusLabel(order.source))}
            {order.externalRef ? ` · ${t("Ref")} ${order.externalRef}` : ""}
          </>
        }
        actions={
          <>
            <StatusBadge status={order.status} />
            <LinkButton href={`/print/order/${order.id}?doc=picklist`} target="_blank" size="sm"><Printer className="h-4 w-4" /> {t("Pick list")}</LinkButton>
            {order.invoice && <LinkButton href={`/print/order/${order.id}?doc=invoice`} target="_blank" size="sm"><Printer className="h-4 w-4" /> {t("Invoice")}</LinkButton>}
            {["IN_DELIVERY", "DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status) && <LinkButton href={`/print/order/${order.id}?doc=delivery`} target="_blank" size="sm"><Printer className="h-4 w-4" /> {t("Delivery note")}</LinkButton>}
          </>
        }
      />

      {order.status !== "CANCELLED" ? (
        <div className="card mb-4 overflow-x-auto p-4">
          <ol className="flex min-w-[720px] items-center">
            {ORDER_FLOW.map((s, i) => (
              <li key={s} className="flex flex-1 items-center">
                <div className="flex flex-col items-center gap-1 text-center">
                  <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold", i < flowIndex ? "bg-brand-600 text-white" : i === flowIndex ? "bg-navy-900 text-white" : "bg-slate-100 text-ink-3")}>
                    {i < flowIndex ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={cx("text-[11.5px] leading-tight", i === flowIndex ? "font-semibold text-ink" : "text-ink-3")}>{t(statusLabel(s === "DELIVERED" && order.status === "PARTIALLY_DELIVERED" ? "PARTIALLY_DELIVERED" : s))}</span>
                </div>
                {i < ORDER_FLOW.length - 1 && <div className={cx("mx-1 h-0.5 flex-1", i < flowIndex ? "bg-brand-500" : "bg-slate-200")} />}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <Alert tone="critical" title={t("Order cancelled")} className="mb-4">{order.cancelReason}</Alert>
      )}

      {can && (
        <div className="mb-4 flex flex-wrap gap-2">
          {order.status === "NEW" && <ActionButton action={confirmOrderAction} fields={{ id: order.id }} variant="primary" size="md">Confirm order</ActionButton>}
          {(order.status === "CONFIRMED" || (order.status === "ALLOCATED" && shortage > 0.001)) && (
            <ActionButton action={allocateOrderAction} fields={{ id: order.id }} variant="primary" size="md">{order.status === "CONFIRMED" ? "Allocate stock (FEFO)" : "Re-allocate shortage (FEFO)"}</ActionButton>
          )}
          {order.status === "ALLOCATED" && allocated > 0 && <ActionButton action={startPickingAction} fields={{ id: order.id }} variant={shortage > 0.001 ? "secondary" : "primary"} size="md">Start picking</ActionButton>}
          {order.status === "READY_FOR_DISPATCH" && !activeStop && (
            <ActionButton action={dispatchOrderAction} fields={{ id: order.id }} size="md" confirm="Dispatch without a planned shipment?" confirmText="Use for customer pickup or own transport. Stock is deducted now. For tracked deliveries, create a shipment in Logistics." confirmVariant="primary">
              Dispatch (pickup / own transport)
            </ActionButton>
          )}
          {order.status === "READY_FOR_DISPATCH" && ctx.can("logistics.operate") && ctx.has("logistics") && !activeStop && <LinkButton href={`/app/logistics/new?order=${order.id}`}>{t("Plan shipment")}</LinkButton>}
          {CANCELLABLE.includes(order.status) && ctx.can("orders.manage") && (
            <ActionButton action={cancelOrderAction} fields={{ id: order.id }} variant="ghost" size="md" reasonLabel="Cancellation reason" confirm="Cancel this order?" confirmText="All stock reservations are released.">
              Cancel order
            </ActionButton>
          )}
        </div>
      )}
      {order.status === "ALLOCATED" && shortage > 0.001 && (
        <Alert tone="warning" className="mb-4" title={t("Waiting for production")}>
          {t("{kg} kg could not be allocated from valid stock. Re-run allocation after new production, or start picking to ship what is available (the order will be partially delivered).", { kg: shortage.toFixed(1) })}
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Order lines")} description={order.customer.priceList ? `${t("Price list")}: ${order.customer.priceList.name}` : t("Base prices")} />
            <SimpleTable head={[t("Product"), t("Ordered"), t("Price"), t("Line total"), t("Allocated"), t("Picked"), t("Delivered")]}>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td className="td"><Link href={`/app/products/${i.productId}`} className="hover:underline">{i.product.name}</Link><div className="text-[11.5px] text-ink-3">{i.product.sku}</div></td>
                  <td className="td tabular">{fmtKg(i.quantityKg, 2)}</td>
                  <td className="td tabular">{fmtMoney(i.unitPrice)}</td>
                  <td className="td tabular">{fmtMoney(i.lineTotal)}</td>
                  <td className={cx("td tabular", i.allocatedKg + 0.001 < i.quantityKg && order.status === "ALLOCATED" && "text-amber-700")}>{fmtKg(i.allocatedKg, 2)}</td>
                  <td className="td tabular">{i.pickedKg ? fmtKg(i.pickedKg, 2) : "—"}</td>
                  <td className="td tabular">{order.deliveredAt ? fmtKg(i.deliveredKg, 2) : "—"}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-medium">
                <td className="td">{t("Total")}</td>
                <td className="td tabular">{fmtKg(ordered, 1)}</td>
                <td className="td" />
                <td className="td tabular">{fmtMoney(order.subtotal)}</td>
                <td className="td tabular">{fmtKg(allocated, 1)}</td>
                <td className="td" colSpan={2}>{order.deliveredAt && <span>{t("Invoiced")}: {fmtMoney(order.total)}</span>}</td>
              </tr>
            </SimpleTable>
          </Card>

          {order.status === "PICKING" && can && (
            <Card>
              <CardHeader title={t("Complete picking")} description={t("Enter actual picked weights (variable-weight products). Unpicked reservations are released.")} />
              <ActionForm action={completePickingAction} className="space-y-3">
                <Hidden name="id" value={order.id} />
                <SimpleTable head={[t("Product"), t("Batch (FEFO)"), t("Location"), t("Expires"), t("Reserved"), t("Picked kg")]}>
                  {order.items.flatMap((i) =>
                    i.allocations
                      .filter((a) => a.status === "RESERVED")
                      .map((a) => (
                        <tr key={a.id}>
                          <td className="td">{i.product.name}</td>
                          <td className="td font-mono text-[12px]">{a.inventory.batch.code}</td>
                          <td className="td">{a.inventory.warehouse.name}<div className="text-[11.5px] text-ink-3">{a.inventory.chamber?.name}</div></td>
                          <td className="td whitespace-nowrap">{fmtDateTime(a.inventory.expiryDate, ctx.tz)}</td>
                          <td className="td tabular">{a.quantityKg.toFixed(3)}</td>
                          <td className="td"><input name={`p_${a.id}`} type="number" step="any" min={0} defaultValue={a.quantityKg} className="input h-8 w-28 py-1 text-right" /></td>
                        </tr>
                      )),
                  )}
                </SimpleTable>
                <FormError />
                <div className="flex justify-end"><SubmitButton>Complete picking</SubmitButton></div>
              </ActionForm>
            </Card>
          )}

          {order.status === "IN_DELIVERY" && can && !activeStop && (
            <Card>
              <CardHeader title={t("Confirm delivery")} description={t("Record delivered quantities. OTIF is calculated automatically and the invoice is issued for the delivered weight.")} />
              <ActionForm action={confirmDeliveryAction} className="space-y-3">
                <Hidden name="id" value={order.id} />
                <SimpleTable head={[t("Product"), t("Ordered"), t("Shipped"), t("Delivered kg")]}>
                  {order.items.map((i) => {
                    const shipped = i.allocations.filter((a) => a.status === "SHIPPED").reduce((s, a) => s + a.quantityKg, 0);
                    return (
                      <tr key={i.id}>
                        <td className="td">{i.product.name}</td>
                        <td className="td tabular">{i.quantityKg.toFixed(2)}</td>
                        <td className="td tabular">{shipped.toFixed(3)}</td>
                        <td className="td"><input name={`d_${i.id}`} type="number" step="any" min={0} max={shipped} defaultValue={shipped.toFixed(3)} className="input h-8 w-28 py-1 text-right" /></td>
                      </tr>
                    );
                  })}
                </SimpleTable>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextInput name="receivedBy" label="Received by (name)" required />
                  <TextInput name="note" label="Note" />
                </div>
                <FormError />
                <div className="flex justify-end"><SubmitButton>Confirm delivery</SubmitButton></div>
              </ActionForm>
            </Card>
          )}

          <Card>
            <CardHeader title={t("Batch allocations (FEFO)")} description={t("Lots reserved and shipped for this order — earliest expiry first.")} />
            <SimpleTable head={[t("Product"), t("Batch"), t("Location"), t("Produced"), t("Expires"), t("Quantity"), t("Status")]}>
              {order.items.flatMap((i) =>
                i.allocations
                  .filter((a) => a.status !== "RELEASED")
                  .map((a) => (
                    <tr key={a.id}>
                      <td className="td">{i.product.name}</td>
                      <td className="td"><Link href={`/app/traceability/${a.batchId}`} className="font-mono text-[12px] text-navy-700 hover:underline">{a.inventory.batch.code}</Link></td>
                      <td className="td">{a.inventory.warehouse.name}</td>
                      <td className="td whitespace-nowrap text-[12.5px]">{fmtDateTime(a.inventory.productionDate, ctx.tz)}</td>
                      <td className="td whitespace-nowrap text-[12.5px]">{fmtDateTime(a.inventory.expiryDate, ctx.tz)}</td>
                      <td className="td tabular">{fmtKg(a.quantityKg, 3)}</td>
                      <td className="td"><Pill tone={a.status === "SHIPPED" ? "green" : a.status === "PICKED" ? "blue" : "amber"}>{t(statusLabel(a.status))}</Pill></td>
                    </tr>
                  )),
              )}
            </SimpleTable>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title={t("Details")} />
            <DescriptionList
              cols={1}
              items={[
                { label: t("Customer"), value: <Link href={`/app/sales/customers/${order.customerId}`} className="link">{order.customer.name}</Link> },
                { label: t("Delivery address"), value: order.deliveryAddress },
                { label: t("Ordered at"), value: fmtDateTime(order.orderDate, ctx.tz) },
                { label: t("Requested delivery"), value: fmtDay(order.requestedDeliveryDate) },
                { label: t("Delivered at"), value: order.deliveredAt ? fmtDateTime(order.deliveredAt, ctx.tz) : "—" },
                { label: "OTIF", value: order.deliveredAt ? <span className="flex gap-1.5"><Pill tone={order.onTime ? "green" : "red"}>{t(order.onTime ? "On time" : "Late")}</Pill><Pill tone={order.inFull ? "green" : "amber"}>{t(order.inFull ? "In full" : "Not in full")}</Pill></span> : "—" },
                { label: t("Notes"), value: order.notes },
              ]}
            />
          </Card>
          {activeStop && (
            <Card>
              <CardHeader title={t("Shipment")} />
              <Link href={`/app/logistics/shipments/${activeStop.shipmentId}`} className="link">{activeStop.shipment.number}</Link>
              <div className="mt-1 text-[13px] text-ink-2">{activeStop.shipment.vehicle.plate} · {activeStop.shipment.driver.name}</div>
              <div className="mt-2 flex gap-2"><StatusBadge status={activeStop.shipment.status} /><StatusBadge status={activeStop.status} /></div>
              {activeStop.receivedBy && <div className="mt-2 text-[12.5px] text-ink-3">{t("Received by")} {activeStop.receivedBy} · {fmtDateTime(activeStop.deliveredAt, ctx.tz)}</div>}
            </Card>
          )}
          {order.invoice && (
            <Card>
              <CardHeader title={`${t("Invoice")} ${order.invoice.number}`} actions={<StatusBadge status={order.invoice.status} />} />
              <DescriptionList
                cols={1}
                items={[
                  { label: t("Amount"), value: fmtMoney(order.invoice.amount) },
                  { label: t("Paid"), value: fmtMoney(order.invoice.paidAmount) },
                  { label: t("Due date"), value: fmtDate(order.invoice.dueAt, ctx.tz) },
                ]}
              />
              {order.invoice.payments.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12.5px] text-ink-2">
                  {order.invoice.payments.map((p) => <li key={p.id}>{fmtDate(p.paidAt, ctx.tz)} · {fmtMoney(p.amount)} · {p.method.replace("_", " ").toLowerCase()} {p.reference}</li>)}
                </ul>
              )}
              {ctx.can("sales.operate") && order.invoice.status !== "PAID" && order.invoice.status !== "VOID" && (
                <div className="mt-3">
                  <Modal trigger={t("Record payment")} title="Record payment" triggerSize="sm">
                    <ActionForm action={recordPaymentAction} className="space-y-3">
                      <Hidden name="invoiceId" value={order.invoice.id} />
                      <NumberInput name="amount" label="Amount" required defaultValue={num(order.invoice.amount) - num(order.invoice.paidAmount)} suffix="UZS" />
                      <TextInput name="paidAt" label="Payment date" type="date" required defaultValue={today} />
                      <SelectInput name="method" label="Method" defaultValue="BANK_TRANSFER" translateOptions options={[{ value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "CASH", label: "Cash" }, { value: "CARD", label: "Card" }, { value: "OFFSET", label: "Offset" }]} />
                      <TextInput name="reference" label="Payment reference" />
                      <FormError />
                      <div className="flex justify-end"><SubmitButton>Save payment</SubmitButton></div>
                    </ActionForm>
                  </Modal>
                </div>
              )}
              <p className="mt-3 text-[11.5px] text-ink-3">{t("Internal invoice document. Electronic invoicing (Didox / Faktura.uz) is not connected.")}</p>
            </Card>
          )}
          <Card>
            <CardHeader title={t("Status history")} />
            <ol className="space-y-3">
              {order.history.map((h) => (
                <li key={h.id} className="relative pl-4 text-[13px]">
                  <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-navy-600" />
                  <div className="font-medium">{t(statusLabel(h.toStatus))}</div>
                  <div className="text-[12px] text-ink-3">{fmtDateTime(h.createdAt, ctx.tz)} · {userName(h.userId)}</div>
                  {h.note && <div className="text-[12px] text-ink-2">{h.note}</div>}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
