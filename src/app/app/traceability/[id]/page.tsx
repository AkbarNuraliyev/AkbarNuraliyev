import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink, Lock } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtDay, fmtKg, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { Alert, Card, CardHeader, DescriptionList, Kpi, LinkButton, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { traceBatch } from "@/server/services/traceability";
import { addRecallActionAction, blockBatchAction, closeRecallAction, initiateRecallAction, logComplaintAction } from "../actions";

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "traceability.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const tr = await traceBatch(tx, id);
    if (!tr) return null;
    const customers = await tx.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
    return { tr, customers };
  });
  if (!data) notFound();
  const { tr } = data;
  const b = tr.batch;
  const t = ctx.t;
  const full = ctx.has("full_traceability");
  const canRecall = ctx.can("traceability.recall");
  const openRecall = b.recalls.find((r) => r.status !== "CLOSED");
  const chain = [
    { label: "Farm", value: `${b.farm.code}`, sub: b.farm.name },
    { label: "Receiving", value: b.receipt.number, sub: fmtDateTime(b.receipt.receivedAt, ctx.tz) },
    { label: "Production", value: `${tr.shifts.length} ${t("shift(s)")}`, sub: tr.yield.inputKg ? `${t("yield")} ${fmtPct(tr.yield.yieldPct, 1)}` : t("not processed") },
    { label: "Packaging", value: `${tr.products.length} ${t("products")}`, sub: fmtKg(tr.yield.saleableKg, 0) },
    { label: "Warehouse", value: fmtKg(tr.inventoryKg, 1), sub: t("in stock now") },
    { label: "Shipment", value: full ? `${tr.shipments.length}` : "—", sub: t("shipments") },
    { label: "Customer", value: full ? `${tr.customers.length}` : "—", sub: `${tr.retailSales.length ? `${new Set(tr.retailSales.map((s) => s.location)).size} ${t("stores")}` : t("customers")}` },
  ];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Traceability"), href: "/app/traceability" }, { label: b.code }]}
        title={<span className="font-mono">{b.code}</span>}
        description={`${b.supplier.name} · ${b.farm.name} · ${fmtDateTime(b.createdAt, ctx.tz)}`}
        actions={
          <>
            <StatusBadge status={b.status} />
            {ctx.has("qr_public") && (
              <LinkButton href={`/t/${b.publicToken}`} target="_blank" size="sm"><ExternalLink className="h-4 w-4" /> {t("Customer QR page")}</LinkButton>
            )}
            {(ctx.can("quality.operate") || canRecall) && (
              <Modal trigger={t("Log complaint")} title="Register customer complaint" triggerSize="sm" size="lg">
                <ActionForm action={logComplaintAction} className="space-y-3">
                  <Hidden name="batchId" value={b.id} />
                  <SelectInput name="customerId" label="Customer" placeholder="—" options={data.customers.map((c) => ({ value: c.id, label: c.name }))} />
                  <TextInput name="title" label="Complaint" required />
                  <TextArea name="description" label="Details" required />
                  <SelectInput name="severity" label="Severity" defaultValue="MAJOR" translateOptions options={[{ value: "MINOR", label: "Minor" }, { value: "MAJOR", label: "Major" }, { value: "CRITICAL", label: "Critical" }]} />
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Register</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
            {canRecall && b.status !== "BLOCKED" && b.status !== "RECALLED" && (
              <ActionButton action={blockBatchAction} fields={{ id: b.id }} size="sm" reasonLabel="Reason for blocking (audit log)" confirm="Block all stock of this batch?" confirmText="All lots in every warehouse and store are blocked and unshipped order allocations are released.">
                Block batch
              </ActionButton>
            )}
            {canRecall && ctx.has("recall") && !openRecall && (
              <Modal trigger={t("Initiate recall")} title="Initiate product recall" triggerVariant="danger" triggerSize="sm">
                <ActionForm action={initiateRecallAction} className="space-y-3">
                  <Hidden name="batchId" value={b.id} />
                  <Alert tone="critical">{t("All remaining stock of this batch ({kg}) will be blocked immediately and unshipped allocations released. Customers who received the batch are listed on this page.", { kg: fmtKg(tr.inventoryKg, 1) })}</Alert>
                  <TextArea name="reason" label="Recall reason" required />
                  <FormError />
                  <div className="flex justify-end"><SubmitButton variant="danger">Initiate recall</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      {b.blockedReason && <Alert tone="critical" title={t(b.status === "RECALLED" ? "Batch recalled" : "Batch blocked")} className="mb-4">{b.blockedReason}</Alert>}

      <div className="card mb-4 overflow-x-auto p-4">
        <ol className="flex min-w-[860px] items-stretch gap-1">
          {chain.map((c, i) => (
            <li key={c.label} className="flex flex-1 items-center gap-1">
              <div className="flex-1 rounded-lg border border-line bg-slate-50/60 px-3 py-2.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{t(c.label)}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-ink">{c.value}</div>
                <div className="truncate text-[11.5px] text-ink-3">{c.sub}</div>
              </div>
              {i < chain.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-brand-600" />}
            </li>
          ))}
        </ol>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label={t("Live weight accepted")} value={fmtKg(b.liveWeightKg, 0)} sub={`${fmtNum(b.birds)} ${t("birds")}`} />
        <Kpi label={t("Processed")} value={fmtKg(tr.yield.inputKg, 0)} sub={`${fmtNum(b.processedBirds)} ${t("birds")}`} />
        <Kpi label={t("Saleable output")} value={fmtKg(tr.yield.saleableKg, 0)} sub={tr.yield.inputKg ? `${t("yield")} ${fmtPct(tr.yield.yieldPct, 2)}` : undefined} />
        <Kpi label={t("In stock now")} value={fmtKg(tr.inventoryKg, 1)} sub={t("{n} lots", { n: tr.inventory.length })} />
        <Kpi label={t("Customers")} value={full ? fmtNum(tr.customers.length) : "—"} sub={full ? fmtKg(tr.customers.reduce((s, c) => s + c.kg, 0), 0) : t("Upgrade for forward trace")} />
        <Kpi label={t("Retail sold")} value={full ? fmtKg(tr.retailSales.reduce((s, x) => s + x.kg, 0), 1) : "—"} />
      </div>

      {b.recalls.map((r) => (
        <Card key={r.id} className="mt-4 border-red-200">
          <CardHeader
            title={`${t("Recall")} ${r.number}`}
            description={`${fmtDateTime(r.initiatedAt, ctx.tz)} · ${r.reason}`}
            actions={
              <>
                <StatusBadge status={r.status} />
                {canRecall && r.status !== "CLOSED" && (
                  <>
                    <Modal trigger={t("Record action")} title="Record recall action" triggerSize="sm">
                      <ActionForm action={addRecallActionAction} className="space-y-3">
                        <Hidden name="recallId" value={r.id} />
                        <SelectInput name="actionType" label="Action" defaultValue="NOTIFY_CUSTOMER" translateOptions options={[{ value: "NOTIFY_CUSTOMER", label: "Customer notified" }, { value: "RETRIEVE", label: "Product retrieved" }, { value: "DESTROY", label: "Product destroyed" }, { value: "AUTHORITY_NOTIFIED", label: "Authority notified" }, { value: "INVESTIGATION", label: "Investigation step" }, { value: "NOTE", label: "Note" }]} />
                        <TextArea name="description" label="Description" required />
                        <FormError />
                        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
                      </ActionForm>
                    </Modal>
                    <Modal trigger={t("Close recall")} title="Close recall" triggerSize="sm" triggerVariant="primary">
                      <ActionForm action={closeRecallAction} className="space-y-3">
                        <Hidden name="recallId" value={r.id} />
                        <TextArea name="summary" label="Closing summary" required />
                        <FormError />
                        <div className="flex justify-end"><SubmitButton>Close recall</SubmitButton></div>
                      </ActionForm>
                    </Modal>
                  </>
                )}
              </>
            }
          />
          <ol className="space-y-2">
            {r.actions.map((a) => (
              <li key={a.id} className="flex gap-3 text-[13px]">
                <span className="w-36 shrink-0 text-ink-3">{fmtDateTime(a.createdAt, ctx.tz)}</span>
                <Pill tone={a.actionType === "CLOSED" ? "green" : "red"}>{t(a.actionType.replaceAll("_", " ").toLowerCase())}</Pill>
                <span className="text-ink-2">{a.description} {a.userName && <span className="text-ink-3">— {a.userName}</span>}</span>
              </li>
            ))}
          </ol>
        </Card>
      ))}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Source: farm & receiving")} actions={<Link href={`/app/receiving/${b.receiptId}`} className="link text-[13px]">{b.receipt.number}</Link>} />
          <DescriptionList
            items={[
              { label: t("Farm"), value: <Link className="link" href={`/app/procurement/farms/${b.farmId}`}>{`${b.farm.code} — ${b.farm.name}`}</Link> },
              { label: t("Region"), value: [b.farm.region, b.farm.district].filter(Boolean).join(", ") },
              { label: t("Supplier"), value: <Link className="link" href={`/app/procurement/suppliers/${b.supplierId}`}>{b.supplier.name}</Link> },
              { label: t("Received"), value: fmtDateTime(b.receipt.receivedAt, ctx.tz) },
              { label: t("Decision"), value: <StatusBadge status={b.receipt.status} /> },
              { label: t("Birds / live weight"), value: `${fmtNum(b.receipt.birdsAccepted)} / ${fmtKg(b.receipt.acceptedWeightKg, 0)}` },
              { label: t("Veterinary certificate"), value: b.receipt.vetCertificateNo },
              { label: t("Vehicle"), value: b.receipt.vehiclePlate },
            ]}
          />
          {tr.qc.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[13px] font-medium">{t("Quality records")}</div>
              <ul className="space-y-1.5 text-[13px]">
                {tr.qc.map((q) => (
                  <li key={q.id} className="flex items-center gap-2">
                    <StatusBadge status={q.result} /> {q.checklist.name} <span className="text-[12px] text-ink-3">{fmtDateTime(q.performedAt, ctx.tz)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title={t("Production shifts")} />
          <SimpleTable head={[t("Shift"), t("Line"), t("Date"), t("Birds"), t("Input kg")]}>
            {tr.shifts.map((s) => (
              <tr key={s.id}>
                <td className="td"><Link href={`/app/production/shifts/${s.shiftId}`} className="link">{s.shift.number}</Link></td>
                <td className="td">{s.shift.line.name}</td>
                <td className="td">{fmtDay(s.shift.shiftDate)} {s.shift.shiftType}</td>
                <td className="td tabular">{fmtNum(s.birdsProcessed)}</td>
                <td className="td tabular">{fmtKg(s.inputWeightKg, 1)}</td>
              </tr>
            ))}
          </SimpleTable>
          <div className="mt-3 text-[12.5px] text-ink-3">{t("Waste")}: {fmtKg(tr.yield.wasteKg, 1)}</div>
        </Card>
        <Card>
          <CardHeader title={t("Products manufactured from this batch")} />
          <SimpleTable head={[t("Product"), t("Type"), t("Weight")]}>
            {tr.products.sort((a, c) => c.kg - a.kg).map((p) => (
              <tr key={p.productId}>
                <td className="td">{p.name}<div className="text-[11.5px] text-ink-3">{p.sku}</div></td>
                <td className="td"><Pill tone={p.type === "BYPRODUCT" ? "violet" : "blue"}>{t(p.type === "BYPRODUCT" ? "By-product" : "Product")}</Pill></td>
                <td className="td tabular">{fmtKg(p.kg, 2)}</td>
              </tr>
            ))}
          </SimpleTable>
        </Card>
        <Card>
          <CardHeader title={t("Current inventory (incl. retail stores)")} />
          <SimpleTable head={[t("Product"), t("Location"), t("Expires"), t("Quantity"), t("Status")]}>
            {tr.inventory.map((l) => (
              <tr key={l.id}>
                <td className="td">{l.product.name}</td>
                <td className="td">{l.warehouse.retail ? <span className="text-violet-700">{l.warehouse.retail.name}</span> : l.warehouse.name}<div className="text-[11.5px] text-ink-3">{l.chamber?.name}</div></td>
                <td className="td whitespace-nowrap text-[12.5px]">{fmtDateTime(l.expiryDate, ctx.tz)}</td>
                <td className="td tabular">{fmtKg(l.quantityKg, 2)}</td>
                <td className="td"><StatusBadge status={l.status} /></td>
              </tr>
            ))}
            {tr.inventory.length === 0 && <tr><td className="td text-center text-ink-3" colSpan={5}>{t("No stock of this batch remains.")}</td></tr>}
          </SimpleTable>
        </Card>
      </div>

      {full ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("Customers who received the batch")} />
            <SimpleTable head={[t("Customer"), t("Orders"), t("Quantity"), t("Status"), t("Phone")]}>
              {tr.customers.map((c) => (
                <tr key={c.customerId}>
                  <td className="td"><Link href={`/app/sales/customers/${c.customerId}`} className="link">{c.name}</Link></td>
                  <td className="td text-[12.5px]">{c.orders.join(", ")}</td>
                  <td className="td tabular">{fmtKg(c.kg, 2)}</td>
                  <td className="td"><Pill tone={c.status === "SHIPPED" ? "green" : "amber"}>{t(c.status === "SHIPPED" ? "Shipped" : "Reserved")}</Pill></td>
                  <td className="td text-[12.5px]">{c.phone}</td>
                </tr>
              ))}
              {tr.customers.length === 0 && <tr><td className="td text-center text-ink-3" colSpan={5}>{t("Not shipped to customers.")}</td></tr>}
            </SimpleTable>
          </Card>
          <Card>
            <CardHeader title={t("Shipments")} />
            <SimpleTable head={[t("Shipment"), t("Vehicle / driver"), t("Departed"), t("Orders"), t("Status")]}>
              {tr.shipments.map((s) => (
                <tr key={s.id}>
                  <td className="td"><Link href={`/app/logistics/shipments/${s.id}`} className="link">{s.number}</Link></td>
                  <td className="td">{s.vehicle}<div className="text-[11.5px] text-ink-3">{s.driver}</div></td>
                  <td className="td whitespace-nowrap">{fmtDateTime(s.departedAt, ctx.tz)}</td>
                  <td className="td text-[12.5px]">{s.orders.join(", ")}</td>
                  <td className="td"><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <Card>
            <CardHeader title={t("Retail locations — sales from this batch")} />
            <SimpleTable head={[t("Store"), t("Product"), t("Sold kg"), t("Revenue")]}>
              {tr.retailSales.map((s, i) => (
                <tr key={i}>
                  <td className="td">{s.location}</td>
                  <td className="td">{s.product}</td>
                  <td className="td tabular">{fmtKg(s.kg, 2)}</td>
                  <td className="td tabular">{fmtMoney(s.total)}</td>
                </tr>
              ))}
            </SimpleTable>
          </Card>
          <Card>
            <CardHeader title={t("Returns & non-conformities")} />
            <ul className="space-y-2 text-[13px]">
              {tr.returns.map((r) => (
                <li key={r.id}>{r.number} · {fmtKg(r.quantityKg, 2)} · {r.customer?.name ?? t("Retail")} — {r.reason}</li>
              ))}
              {b.nonconformities.map((n) => (
                <li key={n.id}><Link href={`/app/quality/nonconformities/${n.id}`} className="link">{n.number}</Link> <StatusBadge status={n.severity} /> {n.title} <StatusBadge status={n.status} /></li>
              ))}
              {tr.returns.length + b.nonconformities.length === 0 && <li className="text-ink-3">{t("None recorded.")}</li>}
            </ul>
          </Card>
        </div>
      ) : (
        <Alert tone="info" className="mt-4" title={t("Forward traceability")}>
          <Lock className="mr-1 inline h-3.5 w-3.5" />
          {t("Customers, shipments and store sales for this batch are available on plans with full traceability.")}
        </Alert>
      )}

      <Card className="mt-4">
        <CardHeader title={t("Event timeline")} description={t("Every operation recorded against this batch")} />
        <ol className="relative space-y-3 border-l border-line pl-5">
          {b.events.map((e) => (
            <li key={e.id} className="relative text-[13px]">
              <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-navy-600 ring-1 ring-navy-200" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-ink-3">{fmtDateTime(e.occurredAt, ctx.tz)}</span>
                <Pill tone={e.eventType === "RECALLED" || e.eventType === "BLOCKED" ? "red" : e.eventType === "SHIPPED" || e.eventType === "DELIVERED" ? "green" : "gray"}>{t(e.eventType.replaceAll("_", " ").toLowerCase())}</Pill>
                {e.quantityKg !== null && <span className="tabular text-[12px] text-ink-3">{fmtKg(e.quantityKg, 1)}</span>}
              </div>
              <div className="mt-0.5 text-ink-2">{e.description}</div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
