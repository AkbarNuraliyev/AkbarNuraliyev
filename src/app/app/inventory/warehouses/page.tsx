import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtNum, fmtTemp } from "@/lib/format";
import { Card, CardHeader, PageHeader, Pill } from "@/components/ui/basic";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormActions, FormError, NumberInput, SelectInput, SubmitButton, TextInput, Hidden } from "@/components/ui/form";
import { EPS } from "@/server/services/inventory";
import { createChamberAction, createWarehouseAction } from "../actions";
import { InventoryTabs } from "../tabs";

export default async function WarehousesPage() {
  const ctx = await requireApp({ permission: "inventory.view" });
  const now = new Date();
  const data = await withTenant(ctx, async (tx) => {
    const [whs, facilities, stock, lastTemps] = await Promise.all([
      tx.warehouse.findMany({ include: { chambers: { orderBy: { code: "asc" } }, facility: true, retail: true }, orderBy: [{ type: "asc" }, { code: "asc" }] }),
      tx.facility.findMany({ orderBy: { code: "asc" } }),
      tx.inventory.groupBy({ by: ["chamberId"], where: { quantityKg: { gt: EPS }, expiryDate: { gt: now } }, _sum: { quantityKg: true } }),
      tx.$queryRaw<{ chamberId: string; temperatureC: number; isExcursion: boolean }[]>`
        SELECT DISTINCT ON ("chamberId") "chamberId", "temperatureC", "isExcursion" FROM temperature_readings WHERE "chamberId" IS NOT NULL ORDER BY "chamberId", "recordedAt" DESC`,
    ]);
    return { whs, facilities, stock, lastTemps };
  });
  const t = ctx.t;
  const canManage = ctx.can("inventory.manage");
  const nonRetail = data.whs.filter((w) => w.type !== "RETAIL");
  return (
    <>
      <PageHeader
        title={t("Inventory & Warehouses")}
        description={t("Warehouses, storage chambers and their temperature limits. Retail store stock locations are created with each store.")}
        actions={
          canManage && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("New warehouse")}</>} title="New warehouse" triggerVariant="primary">
              <ActionForm action={createWarehouseAction} className="space-y-4">
                <TextInput name="code" label="Code" required placeholder="DC2" />
                <TextInput name="name" label="Name" required />
                <SelectInput name="type" label="Type" defaultValue="DISTRIBUTION" translateOptions options={[{ value: "FACTORY", label: "Factory" }, { value: "DISTRIBUTION", label: "Distribution" }]} />
                <SelectInput name="facilityId" label="Facility" placeholder="—" options={data.facilities.map((f) => ({ value: f.id, label: f.name }))} />
                <TextInput name="address" label="Address" />
                <p className="text-[12px] text-ink-3">{t("Plan limit")}: {ctx.session.plan?.maxWarehouses ?? t("Unlimited")} · {t("in use")}: {nonRetail.length}</p>
                <FormError />
                <FormActions><SubmitButton>Create warehouse</SubmitButton></FormActions>
              </ActionForm>
            </Modal>
          )
        }
      />
      <InventoryTabs current="warehouses" t={t} />
      <div className="space-y-4">
        {data.whs.map((w) => (
          <Card key={w.id}>
            <CardHeader
              title={`${w.code} — ${w.name}`}
              description={[t(w.type === "RETAIL" ? "Retail store" : w.type === "FACTORY" ? "Factory" : "Distribution"), w.facility?.name, w.address].filter(Boolean).join(" · ")}
              actions={
                canManage && (
                  <Modal trigger={<><Plus className="h-4 w-4" />{t("Chamber")}</>} title="New storage chamber" triggerSize="sm">
                    <ActionForm action={createChamberAction} className="space-y-4">
                      <Hidden name="warehouseId" value={w.id} />
                      <TextInput name="code" label="Code" required placeholder={`${w.code}-C3`} />
                      <TextInput name="name" label="Name" required />
                      <SelectInput name="type" label="Type" defaultValue="CHILLED" translateOptions options={[{ value: "CHILLED", label: "Chilled" }, { value: "FROZEN", label: "Frozen" }, { value: "QUARANTINE", label: "Quarantine" }, { value: "AMBIENT", label: "Ambient" }]} />
                      <div className="grid grid-cols-3 gap-3">
                        <NumberInput name="minTempC" label="Min °C" />
                        <NumberInput name="maxTempC" label="Max °C" />
                        <NumberInput name="capacityKg" label="Capacity kg" />
                      </div>
                      <p className="text-[12px] text-ink-3">{t("Leave limits empty to use the organization defaults (chilled max {c} °C, frozen max {f} °C).", { c: ctx.settings.chilledMaxTempC, f: ctx.settings.frozenMaxTempC })}</p>
                      <FormError />
                      <FormActions><SubmitButton>Create chamber</SubmitButton></FormActions>
                    </ActionForm>
                  </Modal>
                )
              }
            />
            <SimpleTable head={[t("Code"), t("Chamber"), t("Type"), t("Limits"), t("Capacity"), t("Stock kg"), t("Last reading")]}>
              {w.chambers.map((c) => {
                const kg = data.stock.find((s) => s.chamberId === c.id)?._sum.quantityKg ?? 0;
                const last = data.lastTemps.find((x) => x.chamberId === c.id);
                return (
                  <tr key={c.id}>
                    <td className="td">{c.code}</td>
                    <td className="td">{c.name}</td>
                    <td className="td"><Pill tone={c.type === "FROZEN" ? "blue" : c.type === "QUARANTINE" ? "amber" : "green"}>{t(c.type.charAt(0) + c.type.slice(1).toLowerCase())}</Pill></td>
                    <td className="td tabular">{c.minTempC !== null ? fmtTemp(c.minTempC) : "—"} … {c.maxTempC !== null ? fmtTemp(c.maxTempC) : "—"}</td>
                    <td className="td tabular">{c.capacityKg ? fmtNum(c.capacityKg) : "—"}</td>
                    <td className="td tabular">{fmtNum(kg, 0)}{c.capacityKg ? <span className="text-[11.5px] text-ink-3"> ({Math.round((kg / c.capacityKg) * 100)}%)</span> : null}</td>
                    <td className="td tabular">{last ? <span className={last.isExcursion ? "font-medium text-red-700" : ""}>{fmtTemp(last.temperatureC)}</span> : "—"}</td>
                  </tr>
                );
              })}
            </SimpleTable>
          </Card>
        ))}
      </div>
    </>
  );
}
