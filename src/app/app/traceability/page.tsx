import Link from "@/components/ui/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtNum } from "@/lib/format";
import { addDaysKey, zonedMidnight } from "@/lib/tz";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable, spGet, type SP } from "@/components/ui/table";
import { searchBatches } from "@/server/services/traceability";

export default async function TraceSearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "traceability.view" });
  const sp = await searchParams;
  const q = spGet(sp, "q");
  const product = spGet(sp, "product");
  const farm = spGet(sp, "farm");
  const supplier = spGet(sp, "supplier");
  const date = spGet(sp, "date");
  const searched = !!(q || product || farm || supplier || date);
  const data = await withTenant(ctx, async (tx) => {
    const [results, products, farms, suppliers, recalls] = await Promise.all([
      searchBatches(tx, {
        text: q,
        productId: product,
        farmId: farm,
        supplierId: supplier,
        from: date ? zonedMidnight(date, ctx.tz) : undefined,
        to: date ? zonedMidnight(addDaysKey(date, 1), ctx.tz) : undefined,
      }),
      tx.product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.farm.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
      tx.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.recall.findMany({ include: { batch: true }, orderBy: { initiatedAt: "desc" }, take: 10 }),
    ]);
    return { results, products, farms, suppliers, recalls };
  });
  const t = ctx.t;
  // exact code match → jump straight to the trace
  const exact = q && data.results.length === 1 ? data.results[0] : null;
  return (
    <>
      <PageHeader title={t("Batch traceability")} description={t("Farm → Receiving → Production → Packaging → Warehouse → Shipment → Customer. Search by batch, farm, supplier, product, production date or QR / label code.")} />
      <Card className="mb-4">
        <form className="grid gap-3 md:grid-cols-6" action="/app/traceability">
          <input name="q" defaultValue={q} className="input md:col-span-2" placeholder={t("Batch ID, QR code, label serial, receipt…")} autoFocus />
          <select name="product" defaultValue={product ?? ""} className="input">
            <option value="">{t("Product")}: {t("All")}</option>
            {data.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select name="farm" defaultValue={farm ?? ""} className="input">
            <option value="">{t("Farm")}: {t("All")}</option>
            {data.farms.map((f) => <option key={f.id} value={f.id}>{f.code} {f.name}</option>)}
          </select>
          <select name="supplier" defaultValue={supplier ?? ""} className="input">
            <option value="">{t("Supplier")}: {t("All")}</option>
            {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="flex gap-2">
            <input type="date" name="date" defaultValue={date} className="input" aria-label={t("Production date")} />
            <button className="h-9 shrink-0 rounded-md bg-navy-900 px-4 text-sm font-semibold text-white">{t("Search")}</button>
          </div>
        </form>
      </Card>
      {exact && (
        <Card className="mb-4 border-brand-200 bg-brand-50/40">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{t("Exact match")}: <b className="font-mono">{exact.code}</b></span>
            <Link href={`/app/traceability/${exact.id}`} className="link">{t("Open full trace")} →</Link>
          </div>
        </Card>
      )}
      {searched ? (
        data.results.length === 0 ? (
          <EmptyState title={t("No batches found")} description={t("Try another code or remove filters.")} />
        ) : (
          <SimpleTable head={[t("Batch ID"), t("Received"), t("Farm"), t("Supplier"), t("Birds"), t("Live kg"), t("Status")]}>
            {data.results.map((b) => (
              <tr key={b.id}>
                <td className="td"><Link href={`/app/traceability/${b.id}`} className="font-mono text-[12.5px] font-medium text-navy-700 hover:underline">{b.code}</Link></td>
                <td className="td whitespace-nowrap">{fmtDateTime(b.createdAt, ctx.tz)}</td>
                <td className="td">{b.farm.code} · {b.farm.name}</td>
                <td className="td">{b.supplier.name}</td>
                <td className="td tabular">{fmtNum(b.birds)}</td>
                <td className="td tabular">{fmtKg(b.liveWeightKg, 0)}</td>
                <td className="td"><StatusBadge status={b.status} /></td>
              </tr>
            ))}
          </SimpleTable>
        )
      ) : (
        <Card>
          <CardHeader title={t("Recalls")} description={t("Most recent product recalls")} />
          {data.recalls.length === 0 ? (
            <p className="text-[13px] text-ink-3">{t("No recalls recorded.")}</p>
          ) : (
            <SimpleTable head={[t("Recall"), t("Batch"), t("Initiated"), t("Reason"), t("Blocked kg"), t("Status")]}>
              {data.recalls.map((r) => (
                <tr key={r.id}>
                  <td className="td font-medium">{r.number}</td>
                  <td className="td"><Link href={`/app/traceability/${r.batchId}`} className="font-mono text-[12px] text-navy-700 hover:underline">{r.batch.code}</Link></td>
                  <td className="td whitespace-nowrap">{fmtDateTime(r.initiatedAt, ctx.tz)}</td>
                  <td className="td max-w-md text-[12.5px]">{r.reason}</td>
                  <td className="td tabular">{fmtKg(r.blockedKg, 1)}</td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </Card>
      )}
    </>
  );
}
