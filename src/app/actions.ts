"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { normalizeLocale } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/i18n/server";
import { destroySession, getSession, setSessionTenant } from "@/lib/auth";
import { withSystem, withTenant } from "@/lib/db";

export async function setLocaleAction(locale: string) {
  const l = normalizeLocale(locale);
  if (!l) return;
  const c = await cookies();
  c.set(LOCALE_COOKIE, l, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const s = await getSession();
  if (s) await withSystem((tx) => tx.user.update({ where: { id: s.user.id }, data: { locale: l } }));
  revalidatePath("/", "layout");
}

export async function signOutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchTenantAction(tenantId: string) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.memberships.some((m) => m.tenantId === tenantId)) return;
  await setSessionTenant(s.sessionId, tenantId);
  redirect("/app");
}

export async function markNotificationsReadAction() {
  const s = await getSession();
  if (!s?.tenant) return;
  await withTenant({ tenantId: s.tenant.id }, (tx) => tx.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } }));
  revalidatePath("/", "layout");
}
