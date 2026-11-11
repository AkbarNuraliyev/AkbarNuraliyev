import Link from "next/link";
import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { ACTIONS, EXTRA_PERMISSIONS, MODULES } from "@/lib/modules";
import { Card, CardHeader, PageHeader, Pill, cx } from "@/components/ui/basic";
import { spGet, type SP } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, Checkbox, FormError, Hidden, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { createRoleAction, saveDepartmentAction, saveRolePermissionsAction } from "../actions";
import { EmployeeTabs } from "../tabs";

export default async function RolesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "employees.view" });
  const sp = await searchParams;
  const data = await withTenant(ctx, async (tx) => {
    const [roles, departments] = await Promise.all([
      tx.role.findMany({ include: { permissions: true, _count: { select: { memberships: true } } }, orderBy: { createdAt: "asc" } }),
      tx.department.findMany({ include: { _count: { select: { memberships: true } } }, orderBy: { name: "asc" } }),
    ]);
    return { roles, departments };
  });
  const t = ctx.t;
  const canEdit = ctx.can("employees.users");
  const role = data.roles.find((r) => r.id === spGet(sp, "role")) ?? data.roles[0];
  const has = new Set(role.permissions.map((p) => p.permissionKey));
  const locked = role.key === "OWNER" || role.isPortal || !canEdit;
  return (
    <>
      <PageHeader
        title={t("Employees & Training")}
        description={t("Role-based access control. Permissions are enforced on the server for every page, action, export and API call.")}
        actions={
          canEdit && (
            <Modal trigger={<><Plus className="h-4 w-4" />{t("New role")}</>} title="New custom role" triggerVariant="primary">
              <ActionForm action={createRoleAction} className="space-y-3">
                <TextInput name="name" label="Role name" required />
                <TextInput name="description" label="Description" />
                <SelectInput name="copyFromId" label="Copy permissions from" placeholder="—" options={data.roles.filter((r) => !r.isPortal).map((r) => ({ value: r.id, label: t(r.name) }))} />
                <Checkbox name="departmentScoped" label="Department-scoped (limit to the member's department modules)" />
                <FormError />
                <div className="flex justify-end"><SubmitButton>Create role</SubmitButton></div>
              </ActionForm>
            </Modal>
          )
        }
      />
      <EmployeeTabs current="roles" t={t} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {data.roles.map((r) => (
              <li key={r.id}>
                <Link href={`/app/employees/roles?role=${r.id}`} className={cx("block px-4 py-3 hover:bg-slate-50", r.id === role.id && "bg-slate-50")}>
                  <div className="flex items-center justify-between gap-2 text-sm font-medium">{t(r.name)} {r.isSystem && <Pill>{t("System")}</Pill>}</div>
                  <div className="text-[12px] text-ink-3">{t("{n} members", { n: r._count.memberships })}{r.departmentScoped ? ` · ${t("department-scoped")}` : ""}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={t(role.name)} description={t(role.description ?? "")} />
          <ActionForm action={saveRolePermissionsAction}>
            <Hidden name="roleId" value={role.id} />
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead>
                  <tr>
                    <th className="th">{t("Module")}</th>
                    {ACTIONS.map((a) => <th key={a} className="th text-center">{t(a.charAt(0).toUpperCase() + a.slice(1))}</th>)}
                    <th className="th">{t("Special")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {MODULES.map((m) => (
                    <tr key={m.key}>
                      <td className="td">{t(m.label)}</td>
                      {ACTIONS.map((a) => {
                        const key = `${m.key}.${a}`;
                        const exists = m.key !== "overview" || a === "view";
                        return (
                          <td key={a} className="td text-center">
                            {exists && <input type="checkbox" name={`perm:${key}`} defaultChecked={has.has(key)} disabled={locked} className="h-4 w-4 accent-brand-600" aria-label={key} />}
                          </td>
                        );
                      })}
                      <td className="td">
                        {EXTRA_PERMISSIONS.filter((e) => e.module === m.key).map((e) => (
                          <label key={e.key} className="flex items-center gap-1.5 text-[12.5px]">
                            <input type="checkbox" name={`perm:${e.key}`} defaultChecked={has.has(e.key)} disabled={locked} className="h-4 w-4 accent-brand-600" /> {t(e.description)}
                          </label>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[12px] text-ink-3">{t("View: see records · Operate: record day-to-day operations · Manage: configure master data, approve, adjust and delete.")}</p>
            {!locked && (
              <div className="mt-3 flex justify-end gap-2">
                <FormError />
                <SubmitButton>Save permissions</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader
          title={t("Departments")}
          description={t("Department-scoped roles (Department Manager, Employee) get their role permissions only for these modules.")}
          actions={
            canEdit && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("Department")}</>} title="New department" triggerSize="sm">
                <DeptForm t={t} />
              </Modal>
            )
          }
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {data.departments.map((d) => (
            <div key={d.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t(d.name)}</span>
                {canEdit && (
                  <Modal trigger={t("Edit")} title="Edit department" triggerSize="sm" triggerVariant="ghost">
                    <DeptForm t={t} dept={d} />
                  </Modal>
                )}
              </div>
              <div className="mt-1 text-[12px] text-ink-3">{t("{n} members", { n: d._count.memberships })}</div>
              <div className="mt-2 flex flex-wrap gap-1">{d.modules.map((m) => <Pill key={m}>{t(MODULES.find((x) => x.key === m)?.label ?? m)}</Pill>)}</div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function DeptForm({ t, dept }: { t: (k: string) => string; dept?: { id: string; name: string; modules: string[] } }) {
  return (
    <ActionForm action={saveDepartmentAction} className="space-y-3">
      {dept && <Hidden name="id" value={dept.id} />}
      <TextInput name="name" label="Name" required defaultValue={dept?.name} />
      <div className="grid grid-cols-2 gap-1.5">
        {MODULES.filter((m) => m.key !== "overview" && m.key !== "settings").map((m) => (
          <label key={m.key} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="modules" value={m.key} defaultChecked={dept?.modules.includes(m.key)} className="h-4 w-4 accent-brand-600" /> {t(m.label)}
          </label>
        ))}
      </div>
      <FormError />
      <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
    </ActionForm>
  );
}
