import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDay } from "@/lib/format";
import { PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { createDriverAction } from "../actions";
import { LogisticsTabs } from "../tabs";

export default async function DriversPage() {
  const ctx = await requireApp({ permission: "logistics.view" });
  const data = await withTenant(ctx, async (tx) => {
    const [drivers, members] = await Promise.all([
      tx.driver.findMany({ include: { _count: { select: { shipments: true } } }, orderBy: { name: "asc" } }),
      tx.membership.findMany({ where: { role: { isPortal: false } }, include: { user: true } }),
    ]);
    return { drivers, members };
  });
  const t = ctx.t;
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 86400000);
  return (
    <>
      <PageHeader
        title={t("Logistics & Fleet")}
        description={t("Drivers, licences and their user accounts for the mobile driver app.")}
        actions={
          ctx.can("logistics.manage") && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("Driver")}</>} title="New driver" triggerVariant="primary">
              <ActionForm action={createDriverAction} className="space-y-3">
                <TextInput name="name" label="Full name" required />
                <TextInput name="phone" label="Phone" type="tel" />
                <TextInput name="licenseNumber" label="Licence number" />
                <TextInput name="licenseExpiry" label="Licence expiry" type="date" />
                <SelectInput name="userId" label="User account (for driver app)" placeholder="—" options={data.members.map((m) => ({ value: m.userId, label: `${m.user.name} (${m.user.email})` }))} />
                <FormError />
                <div className="flex justify-end"><SubmitButton>Add driver</SubmitButton></div>
              </ActionForm>
            </Modal>
          )
        }
      />
      <LogisticsTabs current="drivers" t={t} />
      <SimpleTable head={[t("Driver"), t("Phone"), t("Licence"), t("Expires"), t("App user"), t("Shipments"), t("Status")]}>
        {data.drivers.map((d) => (
          <tr key={d.id}>
            <td className="td font-medium">{d.name}</td>
            <td className="td">{d.phone}</td>
            <td className="td">{d.licenseNumber}</td>
            <td className={`td ${d.licenseExpiry && d.licenseExpiry < soon ? "font-medium text-amber-700" : ""}`}>{d.licenseExpiry ? fmtDay(d.licenseExpiry) : "—"}</td>
            <td className="td text-[12.5px]">{data.members.find((m) => m.userId === d.userId)?.user.email ?? "—"}</td>
            <td className="td tabular">{d._count.shipments}</td>
            <td className="td"><StatusBadge status={d.isActive ? "ACTIVE" : "INACTIVE"} /></td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
