import { UserPlus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";
import { ActionButton, Modal } from "@/components/ui/dialog";
import { ActionForm, Checkbox, FormError, Hidden, ResultLink, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { inviteUserAction, revokeInvitationAction, updateMemberAction } from "./actions";
import { EmployeeTabs } from "./tabs";

export default async function EmployeesPage() {
  const ctx = await requireApp({ permission: "employees.view" });
  const data = await withTenant(ctx, async (tx) => {
    const [members, invites, roles, departments] = await Promise.all([
      tx.membership.findMany({ where: { role: { isPortal: false } }, include: { user: true, role: true, department: true }, orderBy: { createdAt: "asc" } }),
      tx.invitation.findMany({ where: { acceptedAt: null, revokedAt: null, role: { isPortal: false } }, include: { role: true, department: true }, orderBy: { createdAt: "desc" } }),
      tx.role.findMany({ where: { isPortal: false }, orderBy: { createdAt: "asc" } }),
      tx.department.findMany({ orderBy: { name: "asc" } }),
    ]);
    return { members, invites, roles, departments };
  });
  const t = ctx.t;
  const canUsers = ctx.can("employees.users");
  const roleOpts = data.roles.filter((r) => r.key !== "OWNER" || ctx.can("settings.billing")).map((r) => ({ value: r.id, label: `${t(r.name)}${r.departmentScoped ? ` (${t("department-scoped")})` : ""}` }));
  const deptOpts = data.departments.map((d) => ({ value: d.id, label: t(d.name) }));
  return (
    <>
      <PageHeader
        title={t("Employees & Training")}
        description={t("Invite colleagues, assign roles and departments. Department-scoped roles only see the modules of their department.")}
        actions={
          canUsers && (
            <Modal trigger={<><UserPlus className="h-4 w-4" />{t("Invite user")}</>} title="Invite user" triggerVariant="primary">
              <ActionForm action={inviteUserAction} className="space-y-3" closeOnSuccess={false} resetOnSuccess>
                <TextInput name="email" label="Email" type="email" required />
                <SelectInput name="roleId" label="Role" required placeholder="" options={roleOpts.filter((r) => !r.label.startsWith(t("Tenant Owner")))} />
                <SelectInput name="departmentId" label="Department (for department-scoped roles)" placeholder="—" options={deptOpts} />
                <p className="text-[12px] text-ink-3">{t("Plan seat limit")}: {ctx.session.plan?.maxUsers ?? t("Unlimited")}</p>
                <ResultLink />
                <FormError />
                <div className="flex justify-end"><SubmitButton>Send invitation</SubmitButton></div>
              </ActionForm>
            </Modal>
          )
        }
      />
      <EmployeeTabs current="members" t={t} />
      <SimpleTable head={[t("Name"), t("Role"), t("Department"), t("Job title"), t("Last sign-in"), t("Status"), ""]}>
        {data.members.map((m) => (
          <tr key={m.id}>
            <td className="td"><div className="font-medium">{m.user.name}</div><div className="text-[12px] text-ink-3">{m.user.email}</div></td>
            <td className="td"><Pill tone={m.role.key === "OWNER" ? "navy" : m.role.key === "ADMIN" ? "blue" : "gray"}>{t(m.role.name)}</Pill></td>
            <td className="td">{m.department ? t(m.department.name) : "—"}</td>
            <td className="td text-[12.5px]">{m.jobTitle ?? "—"}</td>
            <td className="td text-[12.5px]">{fmtDateTime(m.user.lastLoginAt, ctx.tz)}</td>
            <td className="td"><StatusBadge status={m.status} /></td>
            <td className="td text-right">
              {canUsers && (
                <Modal trigger={t("Edit")} title="Edit member" triggerSize="sm" triggerVariant="ghost" description={`${m.user.name} · ${m.user.email}`}>
                  <ActionForm action={updateMemberAction} className="space-y-3">
                    <Hidden name="id" value={m.id} />
                    <SelectInput name="roleId" label="Role" required defaultValue={m.roleId} options={roleOpts} />
                    <SelectInput name="departmentId" label="Department" placeholder="—" defaultValue={m.departmentId} options={deptOpts} />
                    <TextInput name="jobTitle" label="Job title" defaultValue={m.jobTitle} />
                    <Checkbox name="active" label="Active (can sign in)" defaultChecked={m.status === "ACTIVE"} />
                    <FormError />
                    <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
                  </ActionForm>
                </Modal>
              )}
            </td>
          </tr>
        ))}
      </SimpleTable>
      <Card className="mt-4">
        <CardHeader title={t("Pending invitations")} />
        {data.invites.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t("No pending invitations.")}</p>
        ) : (
          <SimpleTable head={[t("Email"), t("Role"), t("Department"), t("Expires"), ""]}>
            {data.invites.map((i) => (
              <tr key={i.id}>
                <td className="td">{i.email}</td>
                <td className="td">{t(i.role.name)}</td>
                <td className="td">{i.department ? t(i.department.name) : "—"}</td>
                <td className="td">{fmtDate(i.expiresAt, ctx.tz)}</td>
                <td className="td text-right">{canUsers && <ActionButton action={revokeInvitationAction} fields={{ id: i.id }} variant="ghost" confirm="Revoke this invitation?">Revoke</ActionButton>}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Card>
    </>
  );
}
