import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { withSystem } from "./db";
import { randomToken, sha256 } from "./crypto";
import { effectivePermissions } from "./roles";
import { ALWAYS_ON_FEATURES, MODULES } from "./modules";
import { parseSettings, type TenantSettings } from "./settings";
import { AppError } from "./errors";
import { getI18n } from "./i18n/server";
import type { ServiceCtx } from "@/server/core";
import type { Locale } from "./format";
import type { TFunc } from "./i18n";

export const SESSION_COOKIE = "pos_session";
const SESSION_TTL_DAYS = 14;

export interface SessionTenant {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  locale: string;
  isDemo: boolean;
  status: "ACTIVE" | "SUSPENDED";
  settings: TenantSettings;
  batchFormat: string;
  batchPrefix: string;
}

export interface SessionData {
  sessionId: string;
  user: { id: string; email: string; name: string; isSuperAdmin: boolean; locale: string };
  tenant: SessionTenant | null;
  membership: {
    id: string;
    roleKey: string;
    roleName: string;
    isPortal: boolean;
    customerId: string | null;
    departmentName: string | null;
  } | null;
  permissions: Set<string>;
  features: Set<string>;
  plan: { code: string; name: string; maxUsers: number | null; maxFacilities: number | null; maxWarehouses: number | null; maxRetailLocations: number | null } | null;
  subscription: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date; writable: boolean; trialDaysLeft: number | null } | null;
  memberships: { tenantId: string; tenantName: string; roleName: string; isDemo: boolean }[];
}

export async function createSession(userId: string, tenantId: string | null) {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000);
  await withSystem((tx) =>
    tx.session.create({
      data: {
        id: sha256(token),
        userId,
        tenantId,
        expiresAt,
        ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      },
    }),
  );
  const c = await cookies();
  c.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.APP_URL ?? "").startsWith("https"),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) await withSystem((tx) => tx.session.deleteMany({ where: { id: sha256(token) } }));
  c.delete(SESSION_COOKIE);
}

export async function setSessionTenant(sessionId: string, tenantId: string) {
  await withSystem((tx) => tx.session.update({ where: { id: sessionId }, data: { tenantId } }));
}

export const getSession = cache(async (): Promise<SessionData | null> => {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  return withSystem(async (tx) => {
    const session = await tx.session.findUnique({ where: { id }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

    const memberships = await tx.membership.findMany({
      where: { userId: session.userId, status: "ACTIVE" },
      include: { tenant: { select: { id: true, name: true, isDemo: true } }, role: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    let tenantId = session.tenantId;
    if (!tenantId || !memberships.some((m) => m.tenantId === tenantId)) tenantId = memberships[0]?.tenantId ?? null;

    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60000) {
      await tx.session.update({ where: { id }, data: { lastSeenAt: new Date(), tenantId } });
    }

    const base: SessionData = {
      sessionId: id,
      user: { id: session.user.id, email: session.user.email, name: session.user.name, isSuperAdmin: session.user.isSuperAdmin, locale: session.user.locale },
      tenant: null,
      membership: null,
      permissions: new Set(),
      features: new Set(),
      plan: null,
      subscription: null,
      memberships: memberships.map((m) => ({ tenantId: m.tenantId, tenantName: m.tenant.name, roleName: m.role.name, isDemo: m.tenant.isDemo })),
    };
    if (!tenantId) return base;

    const m = await tx.membership.findFirst({
      where: { tenantId, userId: session.userId, status: "ACTIVE" },
      include: {
        role: { include: { permissions: true } },
        department: true,
        tenant: { include: { subscription: { include: { plan: true } }, featureOverrides: true } },
      },
    });
    if (!m) return base;
    const t = m.tenant;
    const sub = t.subscription;
    const features = new Set<string>(sub?.plan.features ?? []);
    for (const o of t.featureOverrides) (o.enabled ? features.add(o.feature) : features.delete(o.feature));
    const now = new Date();
    const trialExpired = sub?.status === "TRIALING" && !!sub.trialEndsAt && sub.trialEndsAt < now;
    const writable = t.isDemo || (!!sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE" || (sub.status === "TRIALING" && !trialExpired)));

    return {
      ...base,
      tenant: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        timezone: t.timezone,
        currency: t.currency,
        locale: t.locale,
        isDemo: t.isDemo,
        status: t.status,
        settings: parseSettings(t.settings),
        batchFormat: t.batchFormat,
        batchPrefix: t.batchPrefix,
      },
      membership: {
        id: m.id,
        roleKey: m.role.key,
        roleName: m.role.name,
        isPortal: m.role.isPortal,
        customerId: m.customerId,
        departmentName: m.department?.name ?? null,
      },
      permissions: effectivePermissions(
        m.role.permissions.map((p) => p.permissionKey),
        m.role.departmentScoped,
        m.department?.modules,
      ),
      features,
      plan: sub
        ? {
            code: sub.plan.code,
            name: sub.plan.name,
            maxUsers: sub.customMaxUsers ?? sub.plan.maxUsers,
            maxFacilities: sub.plan.maxFacilities,
            maxWarehouses: sub.plan.maxWarehouses,
            maxRetailLocations: sub.plan.maxRetailLocations,
          }
        : null,
      subscription: sub
        ? {
            status: trialExpired ? "TRIAL_EXPIRED" : sub.status,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            writable,
            trialDaysLeft: sub.status === "TRIALING" && sub.trialEndsAt ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86400000)) : null,
          }
        : null,
    };
  });
});

export interface AppCtx extends ServiceCtx {
  session: SessionData;
  tenant: SessionTenant;
  user: SessionData["user"];
  t: TFunc;
  locale: Locale;
  can: (permission: string) => boolean;
  has: (feature: string) => boolean;
}

function buildCtx(s: SessionData, t: TFunc, locale: Locale): AppCtx {
  const tenant = s.tenant!;
  return {
    tenantId: tenant.id,
    userId: s.user.id,
    userName: s.user.name,
    userEmail: s.user.email,
    tz: tenant.timezone,
    settings: tenant.settings,
    session: s,
    tenant,
    user: s.user,
    t,
    locale,
    can: (p) => s.permissions.has(p),
    has: (f) => ALWAYS_ON_FEATURES.has(f) || s.features.has(f),
  };
}

export function featureOfPermission(permission: string): string | null {
  const mod = permission.split(".")[0];
  return MODULES.find((m) => m.key === mod)?.feature ?? null;
}

/** Guard for tenant application pages. Redirects instead of rendering unauthorized content. */
export async function requireApp(opts: { permission?: string; feature?: string } = {}): Promise<AppCtx> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.tenant || !s.membership) redirect(s.user.isSuperAdmin ? "/admin" : "/login?error=no-workspace");
  if (s.tenant.status === "SUSPENDED") redirect("/suspended");
  if (s.membership.isPortal) redirect("/portal");
  const { locale, t } = await getI18n();
  const ctx = buildCtx(s, t, locale);
  const feature = opts.feature ?? (opts.permission ? featureOfPermission(opts.permission) : null);
  if (feature && !ctx.has(feature)) redirect(`/app/upgrade?feature=${encodeURIComponent(feature)}`);
  if (opts.permission && !ctx.can(opts.permission)) redirect(`/app/forbidden?permission=${encodeURIComponent(opts.permission)}`);
  return ctx;
}

/** Guard for the B2B customer portal. */
export async function requirePortal(): Promise<AppCtx & { customerId: string }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.tenant || !s.membership) redirect("/login?error=no-workspace");
  if (s.tenant.status === "SUSPENDED") redirect("/suspended");
  if (!s.membership.isPortal || !s.membership.customerId) redirect("/app");
  const { locale, t } = await getI18n();
  const ctx = buildCtx(s, t, locale);
  if (!ctx.has("b2b_portal")) redirect("/login?error=portal-disabled");
  return { ...ctx, customerId: s.membership.customerId };
}

export async function requireSuperAdmin() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.user.isSuperAdmin) redirect("/app");
  const { locale, t } = await getI18n();
  return { session: s, user: s.user, t, locale };
}

/** Guard for server actions — throws AppError (shown as a toast) instead of redirecting. */
export async function actionCtx(opts: { permission?: string; feature?: string; allowReadOnly?: boolean; portal?: boolean } = {}): Promise<AppCtx> {
  const s = await getSession();
  if (!s) throw new AppError("Your session has expired. Please sign in again.");
  if (!s.tenant || !s.membership) throw new AppError("No active workspace");
  if (s.tenant.status === "SUSPENDED") throw new AppError("This organization is suspended");
  if (opts.portal ? !s.membership.isPortal : s.membership.isPortal) throw new AppError("You do not have permission to perform this action");
  const { locale, t } = await getI18n();
  const ctx = buildCtx(s, t, locale);
  const feature = opts.feature ?? (opts.permission ? featureOfPermission(opts.permission) : null);
  if (feature && !ctx.has(feature)) throw new AppError("This feature is not included in your plan");
  if (opts.permission && !ctx.can(opts.permission)) throw new AppError("You do not have permission to perform this action");
  if (!opts.allowReadOnly && !s.subscription?.writable)
    throw new AppError("Your subscription is not active. Renew it in Settings → Subscription to make changes.");
  return ctx;
}
