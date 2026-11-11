import { MoreHorizontal } from "lucide-react";
import type { AppCtx } from "@/lib/auth";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { LinkButton } from "@/components/ui/basic";
import { adjustLotAction, moveLotAction, setLotStatusAction, writeOffLotAction } from "./actions";
import { DestinationSelect as SplitDestination } from "./destination-select";

export interface LotLite {
  id: string;
  quantityKg: number;
  reservedKg: number;
  status: string;
  productName: string;
  batchCode: string;
  storageType: string;
  warehouseId: string;
}

export function LotActions({ ctx, lot, warehouses }: { ctx: AppCtx; lot: LotLite; warehouses: { id: string; name: string; chambers: { id: string; name: string; type: string }[] }[] }) {
  const t = ctx.t;
  const free = Math.max(0, lot.quantityKg - lot.reservedKg);
  const canManage = ctx.can("inventory.manage");
  const canOperate = ctx.can("inventory.operate");
  if (!canManage && !canOperate) return null;
  const chamberOpts = warehouses.flatMap((w) =>
    w.chambers.filter((c) => (lot.storageType === "FROZEN" ? c.type === "FROZEN" : c.type !== "FROZEN")).map((c) => ({ value: `${w.id}|${c.id}`, label: `${w.name} / ${c.name}` })),
  );
  return (
    <Modal trigger={<MoreHorizontal className="h-4 w-4" />} title="Lot actions" description={`${lot.productName} · ${lot.batchCode}`} triggerVariant="ghost" triggerSize="sm" size="lg">
      <div className="space-y-5">
        <div className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-ink-2">
          {t("On hand")}: <b className="tabular">{lot.quantityKg.toFixed(3)} kg</b> · {t("Reserved")}: <b className="tabular">{lot.reservedKg.toFixed(3)} kg</b> · {t("Free")}: <b className="tabular">{free.toFixed(3)} kg</b>
        </div>
        {canOperate && lot.status === "AVAILABLE" && chamberOpts.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">{t("Move / transfer")}</h4>
            <MoveForm lot={lot} options={chamberOpts} free={free} />
          </section>
        )}
        {canManage && (
          <>
            <section>
              <h4 className="mb-2 text-sm font-semibold">{t("Write-off")}</h4>
              <ActionForm action={writeOffLotAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
                <Hidden name="inventoryId" value={lot.id} />
                <NumberInput name="quantityKg" label="Quantity" required defaultValue={free.toFixed(3)} suffix="kg" />
                <SelectInput name="type" label="Type" defaultValue="DAMAGE" translateOptions options={[{ value: "DAMAGE", label: "Damaged goods" }, { value: "EXPIRED", label: "Expired" }, { value: "WRITE_OFF", label: "Other write-off" }]} />
                <TextInput name="reason" label="Reason" required />
                <SubmitButton variant="danger">Write off</SubmitButton>
                <div className="sm:col-span-4"><FormError /></div>
              </ActionForm>
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold">{t("Inventory adjustment")}</h4>
              <ActionForm action={adjustLotAction} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <Hidden name="inventoryId" value={lot.id} />
                <NumberInput name="newQuantityKg" label="Counted quantity" required defaultValue={lot.quantityKg.toFixed(3)} suffix="kg" />
                <TextInput name="reason" label="Reason" required placeholder="Recount, scale correction…" />
                <SubmitButton variant="secondary">Adjust</SubmitButton>
                <div className="sm:col-span-3"><FormError /></div>
              </ActionForm>
            </section>
            <section>
              <h4 className="mb-2 text-sm font-semibold">{t("Status")}</h4>
              <ActionForm action={setLotStatusAction} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <Hidden name="inventoryId" value={lot.id} />
                <SelectInput name="status" label="New status" defaultValue={lot.status === "AVAILABLE" ? "BLOCKED" : "AVAILABLE"} translateOptions options={[{ value: "AVAILABLE", label: "Available" }, { value: "QUARANTINE", label: "Quarantine" }, { value: "BLOCKED", label: "Blocked" }]} />
                <TextInput name="reason" label="Reason" required />
                <SubmitButton variant="secondary">Update status</SubmitButton>
                <div className="sm:col-span-3"><FormError /></div>
              </ActionForm>
            </section>
          </>
        )}
        <div className="flex justify-end border-t border-line pt-3">
          <LinkButton href={`/app/products/labels?lot=${lot.id}`} size="sm">{t("Print labels")}</LinkButton>
        </div>
      </div>
    </Modal>
  );
}

function MoveForm({ lot, options, free }: { lot: LotLite; options: { value: string; label: string }[]; free: number }) {
  return (
    <ActionForm action={moveLotAction} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <Hidden name="inventoryId" value={lot.id} />
      <NumberInput name="quantityKg" label="Quantity" required defaultValue={free.toFixed(3)} suffix="kg" />
      <SplitDestination options={options} />
      <SubmitButton>Move</SubmitButton>
      <div className="sm:col-span-3"><FormError /></div>
    </ActionForm>
  );
}

