import { Plus } from "lucide-react";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { localDateKey } from "@/lib/tz";
import { Card, CardHeader, Kpi, PageHeader, Pill } from "@/components/ui/basic";
import { SimpleTable } from "@/components/ui/table";
import { Modal } from "@/components/ui/dialog";
import { ActionForm, Checkbox, FormError, NumberInput, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { addTrainingRecordAction, createCourseAction } from "../actions";
import { EmployeeTabs } from "../tabs";

export default async function TrainingPage() {
  const ctx = await requireApp({ permission: "employees.view", feature: "training" });
  const now = new Date();
  const data = await withTenant(ctx, async (tx) => {
    const [courses, records, members] = await Promise.all([
      tx.trainingCourse.findMany({ include: { _count: { select: { records: true } } }, orderBy: { title: "asc" } }),
      tx.trainingRecord.findMany({ include: { course: true }, orderBy: { completedAt: "desc" }, take: 300 }),
      tx.membership.findMany({ where: { role: { isPortal: false }, status: "ACTIVE" }, include: { user: true } }),
    ]);
    return { courses, records, members };
  });
  const t = ctx.t;
  const soon = new Date(now.getTime() + 30 * 86400000);
  const expired = data.records.filter((r) => r.expiresAt && r.expiresAt < now).length;
  const expiring = data.records.filter((r) => r.expiresAt && r.expiresAt >= now && r.expiresAt < soon).length;
  return (
    <>
      <PageHeader
        title={t("Employees & Training")}
        description={t("Food-safety and occupational training records with validity tracking (supports FSSC 22000 competence records).")}
        actions={
          <>
            {ctx.can("employees.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("Course")}</>} title="New training course">
                <ActionForm action={createCourseAction} className="space-y-3">
                  <TextInput name="title" label="Title" required />
                  <TextInput name="category" label="Category" required placeholder="Food safety" />
                  <TextInput name="description" label="Description" />
                  <NumberInput name="validityMonths" label="Validity (months)" step={1} />
                  <Checkbox name="mandatory" label="Mandatory for production staff" />
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Create</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
            {ctx.can("employees.operate") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("Training record")}</>} title="Record completed training" triggerVariant="primary">
                <ActionForm action={addTrainingRecordAction} className="space-y-3">
                  <SelectInput name="courseId" label="Course" required placeholder="" options={data.courses.map((c) => ({ value: c.id, label: c.title }))} />
                  <SelectInput name="userId" label="Employee (user)" placeholder="— or enter name below —" options={data.members.map((m) => ({ value: m.userId, label: m.user.name }))} />
                  <TextInput name="employeeName" label="Employee name (without user account)" />
                  <div className="grid grid-cols-2 gap-3">
                    <TextInput name="completedAt" label="Completed" type="date" required defaultValue={localDateKey(now, ctx.tz)} />
                    <NumberInput name="score" label="Score %" />
                  </div>
                  <TextInput name="trainer" label="Trainer" />
                  <FormError />
                  <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
                </ActionForm>
              </Modal>
            )}
          </>
        }
      />
      <EmployeeTabs current="training" t={t} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Kpi label={t("Training records")} value={String(data.records.length)} />
        <Kpi label={t("Expiring within 30 days")} value={String(expiring)} tone={expiring ? "warning" : "default"} />
        <Kpi label={t("Expired")} value={String(expired)} tone={expired ? "critical" : "good"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader title={t("Courses")} />
          <ul className="space-y-2 text-[13px]">
            {data.courses.map((c) => (
              <li key={c.id} className="rounded-md border border-line p-2.5">
                <div className="font-medium">{t(c.title)}</div>
                <div className="text-[12px] text-ink-3">{t(c.category)} · {c.validityMonths ? `${c.validityMonths} ${t("months")}` : t("no expiry")} · {t("{n} records", { n: c._count.records })} {c.mandatory && <Pill tone="amber">{t("Mandatory")}</Pill>}</div>
              </li>
            ))}
          </ul>
        </Card>
        <SimpleTable head={[t("Employee"), t("Course"), t("Completed"), t("Valid until"), t("Score"), t("Trainer")]}>
          {data.records.map((r) => (
            <tr key={r.id}>
              <td className="td">{r.employeeName}</td>
              <td className="td">{t(r.course.title)}</td>
              <td className="td">{fmtDate(r.completedAt, ctx.tz)}</td>
              <td className="td">{r.expiresAt ? <span className={r.expiresAt < now ? "font-medium text-red-700" : r.expiresAt < soon ? "text-amber-700" : ""}>{fmtDate(r.expiresAt, ctx.tz)}</span> : "—"}</td>
              <td className="td tabular">{r.score ?? "—"}</td>
              <td className="td text-[12.5px]">{r.trainer}</td>
            </tr>
          ))}
        </SimpleTable>
      </div>
    </>
  );
}
