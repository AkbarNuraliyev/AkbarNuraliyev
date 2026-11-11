import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, DescriptionList, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, SelectInput, SubmitButton, TextArea, TextInput } from "@/components/ui/form";
import { DocumentsPanel } from "@/components/app/documents";
import { addCapaAction, completeCapaAction, updateNcAction } from "../../actions";

export default async function NcDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireApp({ permission: "quality.view" });
  const { id } = await params;
  const data = await withTenant(ctx, async (tx) => {
    const nc = await tx.nonconformity.findUnique({ where: { id }, include: { batch: true, actions: { orderBy: { createdAt: "asc" } } } });
    if (!nc) return null;
    const [customer, history] = await Promise.all([
      nc.customerId ? tx.customer.findUnique({ where: { id: nc.customerId } }) : null,
      tx.auditLog.findMany({ where: { entityType: "nonconformity", entityId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    return { nc, customer, history };
  });
  if (!data) notFound();
  const { nc } = data;
  const t = ctx.t;
  const open = nc.status !== "CLOSED";
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t("Non-conformities & CAPA"), href: "/app/quality/nonconformities" }, { label: nc.number }]}
        title={`${nc.number} · ${nc.title}`}
        description={`${fmtDateTime(nc.createdAt, ctx.tz)} · ${nc.source.replaceAll("_", " ").toLowerCase()}`}
        actions={<><StatusBadge status={nc.severity} /><StatusBadge status={nc.status} /></>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Description")} />
            <p className="whitespace-pre-wrap text-sm text-ink-2">{nc.description}</p>
          </Card>
          <Card>
            <CardHeader
              title={t("Corrective & preventive actions (CAPA)")}
              actions={
                open && ctx.can("quality.operate") && (
                  <Modal trigger={t("Add action")} title="Add CAPA action" triggerSize="sm">
                    <ActionForm action={addCapaAction} className="space-y-3">
                      <Hidden name="nonconformityId" value={nc.id} />
                      <SelectInput name="type" label="Type" defaultValue="CORRECTIVE" translateOptions options={[{ value: "CORRECTIVE", label: "Corrective" }, { value: "PREVENTIVE", label: "Preventive" }]} />
                      <TextArea name="description" label="Action" required />
                      <div className="grid grid-cols-2 gap-3">
                        <TextInput name="responsibleName" label="Responsible" />
                        <TextInput name="dueDate" label="Due date" type="date" />
                      </div>
                      <FormError />
                      <div className="flex justify-end"><SubmitButton>Add</SubmitButton></div>
                    </ActionForm>
                  </Modal>
                )
              }
            />
            <SimpleTable head={[t("Type"), t("Action"), t("Responsible"), t("Due"), t("Status"), ""]}>
              {nc.actions.map((a) => (
                <tr key={a.id}>
                  <td className="td"><Pill tone={a.type === "CORRECTIVE" ? "orange" : "blue"}>{t(a.type === "CORRECTIVE" ? "Corrective" : "Preventive")}</Pill></td>
                  <td className="td text-[13px]">{a.description}</td>
                  <td className="td text-[13px]">{a.responsibleName ?? "—"}</td>
                  <td className="td">{a.dueDate ? fmtDate(a.dueDate, ctx.tz) : "—"}</td>
                  <td className="td"><StatusBadge status={a.status} />{a.completedAt && <div className="text-[11px] text-ink-3">{fmtDate(a.completedAt, ctx.tz)}</div>}</td>
                  <td className="td">{a.status === "OPEN" && open && ctx.can("quality.operate") && <ActionButton action={completeCapaAction} fields={{ id: a.id }}>Mark done</ActionButton>}</td>
                </tr>
              ))}
              {nc.actions.length === 0 && <tr><td colSpan={6} className="td text-center text-ink-3">{t("No actions yet")}</td></tr>}
            </SimpleTable>
          </Card>
          <DocumentsPanel ctx={ctx} entityType="nonconformity" entityId={nc.id} canUpload={ctx.can("quality.operate")} title="Evidence & attachments" defaultType="PHOTO" />
          <Card>
            <CardHeader title={t("Audit history")} />
            <ul className="space-y-1.5 text-[12.5px]">
              {data.history.map((h) => <li key={h.id}><span className="text-ink-3">{fmtDateTime(h.createdAt, ctx.tz)}</span> · {h.userEmail ?? t("System")} · {h.action} — {h.summary}</li>)}
            </ul>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("Details")} />
            <DescriptionList
              cols={1}
              items={[
                { label: t("Batch"), value: nc.batch ? <Link href={`/app/traceability/${nc.batch.id}`} className="link font-mono text-[12px]">{nc.batch.code}</Link> : "—" },
                { label: t("Customer"), value: data.customer ? <Link href={`/app/sales/customers/${data.customer.id}`} className="link">{data.customer.name}</Link> : "—" },
                { label: t("Responsible"), value: nc.responsibleName },
                { label: t("Due date"), value: nc.dueDate ? fmtDate(nc.dueDate, ctx.tz) : "—" },
                { label: t("Root cause"), value: nc.rootCause },
                { label: t("Closed"), value: nc.closedAt ? fmtDateTime(nc.closedAt, ctx.tz) : "—" },
              ]}
            />
          </Card>
          {open && ctx.can("quality.manage") && (
            <Card>
              <CardHeader title={t("Update status")} />
              <ActionForm action={updateNcAction} className="space-y-3">
                <Hidden name="id" value={nc.id} />
                <SelectInput name="status" label="Status" defaultValue={nc.status} translateOptions options={[{ value: "OPEN", label: "Open" }, { value: "INVESTIGATING", label: "Investigating" }, { value: "ACTION", label: "Action" }, { value: "CLOSED", label: "Closed" }]} />
                <TextArea name="rootCause" label="Root cause" defaultValue={nc.rootCause} />
                <TextInput name="responsibleName" label="Responsible" defaultValue={nc.responsibleName} />
                <p className="text-[12px] text-ink-3">{t("Closing requires a root cause and all CAPA actions completed.")}</p>
                <FormError />
                <SubmitButton className="w-full">Save</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
