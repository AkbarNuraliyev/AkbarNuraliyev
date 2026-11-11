import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtTime, fmtMoney, num } from "@/lib/format";
import { barcodeSvg, publicTraceUrl, qrSvg } from "@/server/codes";
import { PrintButton } from "@/components/app/print-button";

export default async function PrintLabels({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const ctx = await requireApp({ permission: "products.view" });
  const { ids } = await searchParams;
  const list = (ids ?? "").split(",").filter(Boolean).slice(0, 500);
  const labels = await withTenant(ctx, (tx) => tx.label.findMany({ where: { id: { in: list } }, include: { product: true, batch: true, template: true }, orderBy: { serial: "asc" } }));
  const tpl = labels[0]?.template;
  const w = tpl?.widthMm ?? 58;
  const h = tpl?.heightMm ?? 40;
  const compact = (tpl?.layout ?? "COMPACT") === "COMPACT";
  const rendered = await Promise.all(
    labels.map(async (l) => ({
      l,
      qr: tpl?.showQr === false ? null : await qrSvg(publicTraceUrl(l.batch.publicToken), 120),
      bc: tpl?.showBarcode === false ? null : await barcodeSvg(l.barcode, "ean13", compact ? 7 : 10),
    })),
  );
  const pages = rendered.flatMap((r) => Array.from({ length: r.l.copies }, () => r));
  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <style>{`@page { size: ${w}mm ${h}mm; margin: 0 } .lbl { page-break-after: always; } @media print { .lbl { box-shadow:none!important; margin:0!important } }`}</style>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <PrintButton label={`Print ${pages.length} label(s)`} />
        <span className="text-[13px] text-ink-3">
          {w} × {h} mm · {ctx.t("Labels are generated from product and batch master data.")}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 print:block">
        {pages.map(({ l, qr, bc }, i) => (
          <div key={`${l.id}-${i}`} className="lbl overflow-hidden bg-white text-black shadow" style={{ width: `${w}mm`, height: `${h}mm`, padding: compact ? "1.5mm 2mm" : "3mm", boxSizing: "border-box", fontFamily: "Inter Variable, Arial, sans-serif", lineHeight: 1.2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1.5mm" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: compact ? "7.5pt" : "10pt", fontWeight: 700 }}>{l.product.name}</div>
                <div style={{ fontSize: compact ? "5.5pt" : "7pt", color: "#333", marginTop: "0.5mm" }}>
                  {ctx.t("Batch")}: <b style={{ fontFamily: "monospace" }}>{l.batch.code}</b>
                  <br />
                  {ctx.t("Produced")}: {fmtDate(l.productionDate, ctx.tz)} {fmtTime(l.productionDate, ctx.tz)} · {ctx.t("Use by")}: <b>{fmtDate(l.expiryDate, ctx.tz)} {fmtTime(l.expiryDate, ctx.tz)}</b>
                  <br />
                  {l.product.storageInstructions ?? (l.product.storageType === "FROZEN" ? "≤ −18 °C" : "0…+4 °C")}
                </div>
              </div>
              {qr && <div style={{ width: compact ? "11mm" : "18mm", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: qr }} />}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "0.8mm", gap: "1.5mm" }}>
              <div style={{ fontSize: compact ? "6pt" : "8pt" }}>
                {ctx.t("Net")}: <b style={{ fontSize: compact ? "9pt" : "12pt" }}>{l.netWeightKg.toFixed(3)} kg</b>
                {tpl?.showPrice !== false && l.unitPrice && (
                  <div>
                    {fmtMoney(l.unitPrice)}/kg · <b>{fmtMoney(num(l.totalPrice))}</b>
                  </div>
                )}
              </div>
              {bc && <div style={{ height: compact ? "11mm" : "16mm", width: compact ? "28mm" : "40mm" }} dangerouslySetInnerHTML={{ __html: bc.replace("<svg", '<svg style="height:100%;width:100%" preserveAspectRatio="xMidYMid meet"') }} />}
            </div>
            <div style={{ fontSize: "4.5pt", color: "#666", marginTop: "0.3mm" }}>{ctx.tenant.name} · {l.serial}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
