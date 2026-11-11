"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { definePublicAction, zEmail, zStr, zOptStr } from "@/lib/action";
import { withSystem } from "@/lib/db";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { createSession, getSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { createWorkspace } from "@/server/services/tenants";
import { appUrl, sendEmail } from "@/server/services/email";
import { usage, planLimits } from "@/server/services/billing";

const zPassword = z
  .string({ required_error: "This field is required" })
  .min(8, "Password must be at least 8 characters")
  .max(128, "Too long")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Password must contain letters and digits");

function safeNext(next: unknown): string | null {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

const loginSchema = z.object({ email: zEmail, password: z.string().min(1, "This field is required"), next: z.string().optional() });

export const loginAction = definePublicAction(
  loginSchema,
  async (input) => {
    const user = await withSystem((tx) => tx.user.findUnique({ where: { email: input.email } }));
    if (user?.lockedUntil && user.lockedUntil > new Date()) throw new AppError("Too many failed attempts. Try again in 15 minutes.");
    const ok = user && user.isActive ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!user || !ok) {
      if (user) {
        const fails = user.failedLogins + 1;
        await withSystem((tx) =>
          tx.user.update({ where: { id: user.id }, data: { failedLogins: fails >= 5 ? 0 : fails, lockedUntil: fails >= 5 ? new Date(Date.now() + 15 * 60000) : null } }),
        );
      }
      throw new AppError("Invalid email or password");
    }
    const membership = await withSystem((tx) =>
      tx.membership.findFirst({ where: { userId: user.id, status: "ACTIVE" }, include: { role: true }, orderBy: { createdAt: "asc" } }),
    );
    await withSystem((tx) => tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }));
    await createSession(user.id, membership?.tenantId ?? null);
    await withSystem((tx) =>
      tx.auditLog.create({ data: { tenantId: membership?.tenantId ?? null, userId: user.id, userEmail: user.email, action: "auth.login", entityType: "user", entityId: user.id } }),
    );
    const next = safeNext(input.next);
    if (!membership) redirect(user.isSuperAdmin ? "/admin" : "/login?error=no-workspace");
    redirect(next ?? (membership.role.isPortal ? "/portal" : "/app"));
  },
);

const registerSchema = z.object({
  companyName: zStr(120),
  name: zStr(120),
  email: zEmail,
  phone: zOptStr(40),
  password: zPassword,
  plan: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]).default("GROWTH"),
  terms: z.literal("on", { errorMap: () => ({ message: "You must accept the terms" }) }),
});

export const registerAction = definePublicAction(
  registerSchema,
  async (input) => {
    const existing = await withSystem((tx) => tx.user.findUnique({ where: { email: input.email } }));
    if (existing) throw new AppError("An account with this email already exists. Sign in instead.", {}, "email");
    const passwordHash = await hashPassword(input.password);
    const { userId, tenantId } = await withSystem(async (tx) => {
      const user = await tx.user.create({ data: { email: input.email, name: input.name, phone: input.phone, passwordHash, lastLoginAt: new Date() } });
      const ws = await createWorkspace(tx, { name: input.companyName, phone: input.phone, ownerUserId: user.id, planCode: input.plan });
      await tx.auditLog.create({ data: { tenantId: ws.tenant.id, userId: user.id, userEmail: user.email, action: "tenant.register", entityType: "tenant", entityId: ws.tenant.id, summary: `${input.companyName} — ${input.plan} trial` } });
      return { userId: user.id, tenantId: ws.tenant.id };
    });
    await createSession(userId, tenantId);
    await sendEmail({
      to: input.email,
      subject: "Welcome to PoultryOS",
      body: `Hello ${input.name},\n\nYour workspace "${input.companyName}" is ready. Your 14-day trial of the ${input.plan} plan has started.\n\nSign in: ${appUrl("/login")}\n`,
      tenantId,
    });
    redirect("/app/onboarding");
  },
);

const forgotSchema = z.object({ email: zEmail });

export const forgotPasswordAction = definePublicAction(forgotSchema, async (input) => {
  const user = await withSystem((tx) => tx.user.findUnique({ where: { email: input.email } }));
  if (user && user.isActive) {
    const token = randomToken(32);
    await withSystem((tx) => tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60000) } }));
    await sendEmail({
      to: user.email,
      subject: "Reset your PoultryOS password",
      body: `Hello ${user.name},\n\nUse the link below to set a new password. It is valid for 60 minutes and can be used once.\n\n${appUrl(`/reset-password/${token}`)}\n\nIf you did not request this, ignore this email.`,
    });
  }
  // Same response whether or not the account exists (no account enumeration).
  return { ok: true, message: "If an account exists for this email, a reset link has been issued." };
});

const resetSchema = z
  .object({ token: z.string().min(10), password: zPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export const resetPasswordAction = definePublicAction(
  resetSchema,
  async (input) => {
    const row = await withSystem((tx) => tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) } }));
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError("This reset link is invalid or has expired. Request a new one.");
    const passwordHash = await hashPassword(input.password);
    await withSystem(async (tx) => {
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
      await tx.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
      await tx.session.deleteMany({ where: { userId: row.userId } });
      await tx.auditLog.create({ data: { userId: row.userId, action: "auth.password_reset", entityType: "user", entityId: row.userId } });
    });
    return { ok: true, message: "Password updated. You can now sign in.", redirectTo: "/login?reset=1" };
  },
);

const inviteSchema = z.object({ token: z.string().min(10), name: zOptStr(120), password: z.string().min(1, "This field is required") });

export const acceptInviteAction = definePublicAction(
  inviteSchema,
  async (input) => {
    const invite = await withSystem((tx) => tx.invitation.findUnique({ where: { tokenHash: sha256(input.token) }, include: { role: true } }));
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) throw new AppError("This invitation is invalid or has expired.");
    let user = await withSystem((tx) => tx.user.findUnique({ where: { email: invite.email } }));
    if (user) {
      if (!(await verifyPassword(input.password, user.passwordHash))) throw new AppError("Incorrect password for the existing account", {}, "password");
    } else {
      const parsed = zPassword.safeParse(input.password);
      if (!parsed.success) throw new AppError(parsed.error.issues[0].message, {}, "password");
      if (!input.name) throw new AppError("This field is required", {}, "name");
      user = await withSystem(async (tx) => tx.user.create({ data: { email: invite.email, name: input.name!, passwordHash: await hashPassword(input.password) } }));
    }
    const u = user;
    await withSystem(async (tx) => {
      if (!invite.role.isPortal) {
        // seat check at acceptance time (the invite itself already reserved a seat)
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${invite.tenantId}, true)`;
        const [us, lim] = await Promise.all([usage(tx), planLimits(tx, invite.tenantId)]);
        if (lim.users !== null && us.activeUsers + 1 > lim.users) throw new AppError("The organization has reached its user limit. Ask the owner to upgrade the plan.");
      }
      await tx.membership.upsert({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId: u.id } },
        update: { roleId: invite.roleId, departmentId: invite.departmentId, customerId: invite.customerId, status: "ACTIVE" },
        create: { tenantId: invite.tenantId, userId: u.id, roleId: invite.roleId, departmentId: invite.departmentId, customerId: invite.customerId },
      });
      await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      await tx.auditLog.create({ data: { tenantId: invite.tenantId, userId: u.id, userEmail: u.email, action: "invitation.accept", entityType: "invitation", entityId: invite.id, summary: invite.role.name } });
    });
    const existing = await getSession();
    if (!existing || existing.user.id !== u.id) await createSession(u.id, invite.tenantId);
    else await withSystem((tx) => tx.session.update({ where: { id: existing.sessionId }, data: { tenantId: invite.tenantId } }));
    redirect(invite.role.isPortal ? "/portal" : "/app");
  },
);
