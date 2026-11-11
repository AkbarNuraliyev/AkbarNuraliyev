import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { PageHeader, Pill } from "@/components/ui/basic";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, NumberInput, SubmitButton, TextInput } from "@/components/ui/form";
import { createRouteAction } from "../actions";
import { LogisticsTabs } from "../tabs";

export default async function RoutesPage() {
  const ctx = await requireApp({ permission: "logistics.view" });
  const routes = await withTenant(ctx, (tx) => tx.deliveryRoute.findMany({ include: { _count: { select: { shipments: true } } }, orderBy: { code: "asc" } }));
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Logistics & Fleet")}
        description={t("Delivery routes used for shipment planning.")}
        actions={
          ctx.can("logistics.manage") && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("Route")}</>} title="New route" triggerVariant="primary">
              <ActionForm action={createRouteAction} className="space-y-3">
                <TextInput name="code" label="Code" required />
                <TextInput name="name" label="Name" required />
                <TextInput name="description" label="Description" />
                <TextInput name="regions" label="Regions (comma separated)" />
                <NumberInput name="estimatedDurationMin" label="Estimated duration (min)" step={5} />
                <FormError />
                <div className="flex justify-end"><SubmitButton>Create route</SubmitButton></div>
              </ActionForm>
            </Modal>
          )
        }
      />
      <LogisticsTabs current="routes" t={t} />
      <SimpleTable head={[t("Code"), t("Route"), t("Regions"), t("Duration"), t("Shipments")]}>
        {routes.map((r) => (
          <tr key={r.id}>
            <td className="td">{r.code}</td>
            <td className="td font-medium">{r.name}</td>
            <td className="td"><div className="flex flex-wrap gap-1">{r.regions.map((x) => <Pill key={x}>{x}</Pill>)}</div></td>
            <td className="td tabular">{r.estimatedDurationMin ? `${Math.round(r.estimatedDurationMin / 60)} h ${r.estimatedDurationMin % 60} min` : "—"}</td>
            <td className="td tabular">{r._count.shipments}</td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
