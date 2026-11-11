"use server";

import { z } from "zod";
import { defineAction, zDate, zEmail, zId, zOptNum, zOptStr, zStr, zBool } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { allPermissionKeys } from "@/lib/modules";
import { audit } from "@/server/core";
import { createInvitation } from "@/server/services/users";
import { assertWithinLimit } from "@/server/services/billing";
import { appUrl, sendEmail } from "@/server/services/email";

const inviteSchema = z.object({ email: zEmail, roleId: zId, departmentId: zOptStr(40) });
export const inviteUserAction = defineAction({ permission: "employees.users", schema: inviteSchema }, async (ctx, input) => {
  const { token, role } = await withTenant(ctx, (tx) => createInvitation(tx, ctx, { ...input, tenantName: ctx.tenant.name }));
  const link = appUrl(`/invite/${token}`);
  const r = await sendEmail({ to: input.email, subject: `Invitation to ${ctx.tenant.name} on PoultryOS`, body: `${ctx.user.name} invited you to join ${ctx.tenant.name} as ${role.name}.\n\nAccept (valid 7 days): ${link}\n`, tenantId: ctx.tenantId });
  return { ok: true, message: r.sent ? "Invitation e-mailed to {email}" : "Invitation created. E-mail is not configured — copy the link below and share it securely.", params: { email: input.email }, data: r.sent ? undefined : { link } };
});

const revokeSchema = z.object({ id: zId });
export const revokeInvitationAction = defineAction({ permission: "employees.users", schema: revokeSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const inv = await tx.invitation.update({ where: { id: input.id }, data: { revokedAt: new Date() } });
    await audit(tx, ctx, { action: "invitation.revoke", entityType: "invitation", entityId: inv.id, summary: inv.email });
  });
  return { ok: true, message: "Invitation revoked" };
});

const memberSchema = z.object({ id: zId, roleId: zId, departmentId: zOptStr(40), jobTitle: zOptStr(120), active: zBool });
export const updateMemberAction = defineAction({ permission: "employees.users", schema: memberSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const m = await tx.membership.findUniqueOrThrow({ where: { id: input.id }, include: { role: true } });
    const role = await tx.role.findUniqueOrThrow({ where: { id: input.roleId } });
    if (m.userId === ctx.userId && (!input.active || role.id !== m.roleId)) throw new AppError("You cannot change your own role or deactivate yourself");
    if (m.role.key === "OWNER" && (role.key !== "OWNER" || !input.active)) {
      const owners = await tx.membership.count({ where: { role: { key: "OWNER" }, status: "ACTIVE" } });
      if (owners <= 1) throw new AppError("The workspace must keep at least one active owner");
    }
    if (role.key === "OWNER" && !ctx.can("settings.billing")) throw new AppError("Only an owner can assign the owner role");
    if (role.departmentScoped && !input.departmentId) throw new AppError("Department-scoped roles need a department", {}, "departmentId");
    if (input.active && m.status !== "ACTIVE" && !role.isPortal) await assertWithinLimit(tx, ctx.tenantId, "users");
    await tx.membership.update({
      where: { id: m.id },
      data: { roleId: role.id, departmentId: role.departmentScoped ? input.departmentId : null, jobTitle: input.jobTitle, status: input.active ? "ACTIVE" : "DISABLED" },
    });
    if (!input.active) await tx.session.deleteMany({ where: { userId: m.userId, tenantId: ctx.tenantId } });
    await audit(tx, ctx, { action: "member.update", entityType: "membership", entityId: m.id, summary: `${m.role.name} → ${role.name}${input.active ? "" : " (disabled)"}`, changes: { role: { from: m.role.key, to: role.key }, status: { from: m.status, to: input.active ? "ACTIVE" : "DISABLED" } } });
  });
  return { ok: true, message: "Member updated" };
});

const roleSchema = z.object({ name: zStr(80), description: zOptStr(300), departmentScoped: zBool, copyFromId: zOptStr(40) });
export const createRoleAction = defineAction({ permission: "employees.users", schema: roleSchema }, async (ctx, input) => {
  const id = await withTenant(ctx, async (tx) => {
    const key = `CUSTOM_${input.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 30)}`;
    if (await tx.role.findUnique({ where: { tenantId_key: { tenantId: ctx.tenantId, key } } })) throw new AppError("A role with this name exists", {}, "name");
    const role = await tx.role.create({ data: { tenantId: ctx.tenantId, key, name: input.name, description: input.description, departmentScoped: input.departmentScoped } });
    if (input.copyFromId) {
      const perms = await tx.rolePermission.findMany({ where: { roleId: input.copyFromId } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ tenantId: ctx.tenantId, roleId: role.id, permissionKey: p.permissionKey })) });
    }
    await audit(tx, ctx, { action: "role.create", entityType: "role", entityId: role.id, summary: role.name });
    return role.id;
  });
  return { ok: true, message: "Role created", redirectTo: `/app/employees/roles?role=${id}` };
});

const permsSchema = z.object({ roleId: zId });
export const saveRolePermissionsAction = defineAction({ permission: "employees.users", schema: permsSchema }, async (ctx, input, fd) => {
  const valid = new Set(allPermissionKeys());
  const selected = new Set<string>();
  for (const [k] of fd.entries()) if (k.startsWith("perm:") && valid.has(k.slice(5))) selected.add(k.slice(5));
  await withTenant(ctx, async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { id: input.roleId }, include: { permissions: true } });
    if (role.key === "OWNER") throw new AppError("Owner permissions cannot be changed");
    if (role.isPortal) throw new AppError("Portal role permissions are fixed");
    const before = new Set(role.permissions.map((p) => p.permissionKey));
    if (!ctx.can("settings.billing")) selected.delete("settings.billing");
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (selected.size) await tx.rolePermission.createMany({ data: [...selected].map((p) => ({ tenantId: ctx.tenantId, roleId: role.id, permissionKey: p })) });
    const added = [...selected].filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !selected.has(p));
    await audit(tx, ctx, { action: "role.permissions", entityType: "role", entityId: role.id, summary: `${role.name}: +${added.length} / −${removed.length}`, changes: { added, removed } });
  });
  return { ok: true, message: "Permissions saved" };
});

const deptSchema = z.object({ id: zOptStr(40), name: zStr(80) });
export const saveDepartmentAction = defineAction({ permission: "employees.users", schema: deptSchema }, async (ctx, input, fd) => {
  const modules = fd.getAll("modules").map(String);
  await withTenant(ctx, async (tx) => {
    const d = input.id
      ? await tx.department.update({ where: { id: input.id }, data: { name: input.name, modules } })
      : await tx.department.create({ data: { tenantId: ctx.tenantId, name: input.name, modules } });
    await audit(tx, ctx, { action: "department.save", entityType: "department", entityId: d.id, summary: `${d.name}: ${modules.join(", ")}` });
  });
  return { ok: true, message: "Department saved" };
});

const courseSchema = z.object({ title: zStr(160), category: zStr(60), description: zOptStr(1000), validityMonths: zOptNum({ min: 1, max: 120, int: true }), mandatory: zBool });
export const createCourseAction = defineAction({ permission: "employees.manage", feature: "training", schema: courseSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const c = await tx.trainingCourse.create({ data: { tenantId: ctx.tenantId, ...input, validityMonths: input.validityMonths ?? null } });
    await audit(tx, ctx, { action: "training.course_create", entityType: "training_course", entityId: c.id, summary: c.title });
  });
  return { ok: true, message: "Course created" };
});

const recordSchema = z.object({ courseId: zId, userId: zOptStr(40), employeeName: zOptStr(120), completedAt: zDate, score: zOptNum({ min: 0, max: 100 }), trainer: zOptStr(120), notes: zOptStr(500) });
export const addTrainingRecordAction = defineAction({ permission: "employees.operate", feature: "training", schema: recordSchema }, async (ctx, input) => {
  await withTenant(ctx, async (tx) => {
    const course = await tx.trainingCourse.findUniqueOrThrow({ where: { id: input.courseId } });
    let name = input.employeeName;
    if (input.userId) {
      const m = await tx.membership.findFirst({ where: { userId: input.userId }, include: { user: true } });
      if (!m) throw new AppError("Employee not found", {}, "userId");
      name = m.user.name;
    }
    if (!name) throw new AppError("Select an employee or enter a name", {}, "employeeName");
    const completed = new Date(`${input.completedAt}T12:00:00Z`);
    if (completed > new Date()) throw new AppError("Completion date cannot be in the future", {}, "completedAt");
    const r = await tx.trainingRecord.create({
      data: {
        tenantId: ctx.tenantId,
        courseId: course.id,
        userId: input.userId,
        employeeName: name,
        completedAt: completed,
        expiresAt: course.validityMonths ? new Date(completed.getTime() + course.validityMonths * 30.44 * 86400000) : null,
        score: input.score ?? null,
        trainer: input.trainer,
        notes: input.notes,
        createdById: ctx.userId,
      },
    });
    await audit(tx, ctx, { action: "training.record", entityType: "training_record", entityId: r.id, summary: `${name}: ${course.title}` });
  });
  return { ok: true, message: "Training record saved" };
});
