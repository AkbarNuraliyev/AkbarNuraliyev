import Link from "@/components/ui/link";
import { fmtDateTime, fmtKg, fmtNum } from "@/lib/format";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";

export function ReceiptRows({
  receipts,
  ctx,
}: {
  receipts: { id: string; number: string; receivedAt: Date; status: string; birdsReceived: number; birdsAccepted: number; netWeightKg: number; acceptedWeightKg: number; avgBirdWeightKg: number; farm: { code: string }; batch: { id: string; code: string } | null }[];
  ctx: { t: (k: string) => string; tz: string };
}) {
  const t = ctx.t;
  return (
    <SimpleTable head={[t("Receipt"), t("Batch"), t("Received"), t("Farm"), t("Birds"), t("Accepted"), t("Net live kg"), t("Avg kg"), t("Status")]}>
      {receipts.map((r) => (
        <tr key={r.id}>
          <td className="td"><Link className="link" href={`/app/receiving/${r.id}`}>{r.number}</Link></td>
          <td className="td">{r.batch ? <Link className="link font-mono text-[12.5px]" href={`/app/traceability/${r.batch.id}`}>{r.batch.code}</Link> : "—"}</td>
          <td className="td whitespace-nowrap">{fmtDateTime(r.receivedAt, ctx.tz)}</td>
          <td className="td">{r.farm.code}</td>
          <td className="td tabular">{fmtNum(r.birdsReceived)}</td>
          <td className="td tabular">{fmtNum(r.birdsAccepted)}</td>
          <td className="td tabular">{fmtKg(r.netWeightKg, 0)}</td>
          <td className="td tabular">{r.avgBirdWeightKg.toFixed(3)}</td>
          <td className="td"><StatusBadge status={r.status} /></td>
        </tr>
      ))}
      {receipts.length === 0 && (
        <tr>
          <td colSpan={9} className="td text-center text-ink-3">{t("No deliveries yet")}</td>
        </tr>
      )}
    </SimpleTable>
  );
}
