import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { num } from "@/lib/format";
import { localDateKey, toLocalInput } from "@/lib/tz";
import { renderBatchCode } from "@/server/core";
import { PageHeader } from "@/components/ui/basic";
import { ReceivingForm } from "./receiving-form";

export default async function NewReceipt() {
  const ctx = await requireApp({ permission: "receiving.operate" });
  const data = await withTenant(ctx, async (tx) => {
    const [suppliers, farms, facilities, checklist, scales] = await Promise.all([
      tx.supplier.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
      tx.farm.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
      tx.facility.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } }),
      tx.qualityChecklist.findFirst({ where: { type: "RECEIVING", isActive: true }, orderBy: { createdAt: "asc" } }),
      tx.integration.findUnique({ where: { tenantId_provider: { tenantId: ctx.tenantId, provider: "scales" } } }),
    ]);
    return { suppliers, farms, facilities, checklist, scales };
  });
  const now = new Date();
  const devices = String((data.scales?.config as { deviceIds?: string } | null)?.deviceIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const preview = renderBatchCode(ctx.tenant.batchFormat, { prefix: ctx.tenant.batchPrefix, dateKey: localDateKey(now, ctx.tz), farm: "{FARM}", supplier: "SUP", facility: "PLANT", seq: 1 });
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: ctx.t("Raw Material Receiving"), href: "/app/receiving" }, { label: ctx.t("New delivery") }]}
        title={ctx.t("Receive live birds")}
        description={ctx.t("Select supplier → register delivery → quantities → weighing → inspection → decision. A unique batch ID and QR code are generated on save.")}
      />
      <ReceivingForm
        suppliers={data.suppliers.map((s) => ({ id: s.id, code: s.code, name: s.name, price: s.pricePerKgLive ? num(s.pricePerKgLive) : null }))}
        farms={data.farms.map((f) => ({ id: f.id, supplierId: f.supplierId, code: f.code, name: f.name }))}
        facilities={data.facilities.map((f) => ({ id: f.id, name: f.name }))}
        checklist={data.checklist ? { id: data.checklist.id, items: data.checklist.items as never } : null}
        defaultReceivedAt={toLocalInput(now, ctx.tz)}
        scaleDevices={devices}
        batchPreview={preview}
      />
    </>
  );
}
