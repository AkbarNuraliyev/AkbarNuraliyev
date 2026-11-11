import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime, fmtKg, fmtNum } from "@/lib/format";
import { batchScanUrl, barcodeSvg, qrSvg } from "@/server/codes";
import { PrintButton } from "@/components/app/print-button";

/** Printable 100×70 mm batch/crate label for a received lot. */
export default async function BatchLabel({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "receiving.view" });
  const { id } = await params;
  const r = await withTenant(ctx, (tx) => tx.rawMaterialReceipt.findUnique({ where: { id }, include: { batch: true, farm: true, supplier: true } }));
  if (!r?.batch) notFound();
  const qr = await qrSvg(batchScanUrl(r.batch.code), 220);
  const bc = await barcodeSvg(r.batch.code, "code128", 8);
  return (
    <div className="min-h-screen bg-slate-100 p-6 print:bg-white print:p-0">
      <style>{`@page { size: 100mm 70mm; margin: 0 } @media print { .label { box-shadow: none !important; margin: 0 !important } }`}</style>
      <div className="no-print mb-4 flex items-center gap-3">
        <PrintButton />
        <span className="text-[13px] text-ink-3">{ctx.t("Label size 100 × 70 mm. Select the label printer and 100% scale.")}</span>
      </div>
      <div className="label bg-white shadow" style={{ width: "100mm", height: "70mm", padding: "3.5mm", boxSizing: "border-box", fontFamily: "Inter Variable, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "3mm" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "7pt", color: "#475467" }}>{ctx.tenant.name} · {ctx.t("RAW MATERIAL LOT")}</div>
            <div style={{ fontSize: "11pt", fontWeight: 700, fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.15, marginTop: "1mm" }}>{r.batch.code}</div>
            <div style={{ fontSize: "8pt", marginTop: "1.5mm", lineHeight: 1.35 }}>
              <div>{ctx.t("Farm")}: <b>{r.farm.code}</b> {r.farm.name}</div>
              <div>{ctx.t("Supplier")}: {r.supplier.name}</div>
              <div>{ctx.t("Received")}: {fmtDateTime(r.receivedAt, ctx.tz)}</div>
              <div>{ctx.t("Birds")}: <b>{fmtNum(r.birdsAccepted)}</b> · {ctx.t("Live weight")}: <b>{fmtKg(r.acceptedWeightKg, 1)}</b></div>
              <div>{ctx.t("Receipt")}: {r.number}</div>
            </div>
          </div>
          <div style={{ width: "27mm", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
        <div style={{ marginTop: "2mm", height: "17mm" }} dangerouslySetInnerHTML={{ __html: bc.replace("<svg", '<svg style="height:100%;width:100%" preserveAspectRatio="xMidYMid meet"') }} />
      </div>
    </div>
  );
}
