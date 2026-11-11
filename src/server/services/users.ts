import type { Tx } from "@/lib/prisma";
import { AppError, assert } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/crypto";
import { audit, nowOf, type ServiceCtx } from "../core";
import { assertWithinLimit } from "./billing";

/** Creates an invitation and returns the one-time token (to be e-mailed). */
export async function createInvitation(
  tx: Tx,
  ctx: ServiceCtx,
  input: { email: string; roleId: string; departmentId?: string | null; customerId?: string | null; tenantName: string },
) {
  const role = await tx.role.findUnique({ where: { id: input.roleId } });
  assert(role, "Role not found", {}, "roleId");
  if (role.key === "OWNER") throw new AppError("The owner role cannot be assigned by invitation", {}, "roleId");
  if (role.isPortal && !input.customerId) throw new AppError("Select the customer for a portal user", {}, "customerId");
  if (!role.isPortal) await assertWithinLimit(tx, ctx.tenantId, "users");
  if (role.departmentScoped && !input.departmentId) throw new AppError("Department-scoped roles need a department", {}, "departmentId");
  const existingUser = await tx.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId: existingUser.id } } });
    if (m && m.status === "ACTIVE") throw new AppError("This user is already a member of the organization", {}, "email");
  }
  await tx.invitation.updateMany({ where: { email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: nowOf(ctx) } });
  const token = randomToken(32);
  const inv = await tx.invitation.create({
    data: {
      tenantId: ctx.tenantId,
      email: input.email,
      roleId: role.id,
      departmentId: role.departmentScoped ? input.departmentId ?? null : null,
      customerId: role.isPortal ? input.customerId ?? null : null,
      tokenHash: sha256(token),
      expiresAt: new Date(nowOf(ctx).getTime() + 7 * 86400000),
      invitedById: ctx.userId ?? null,
    },
  });
  await audit(tx, ctx, { action: "invitation.create", entityType: "invitation", entityId: inv.id, summary: `${input.email} as ${role.name}` });
  return { invitation: inv, token, role };
}
