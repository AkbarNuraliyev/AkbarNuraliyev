"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  LayoutDashboard, Wheat, PackageCheck, Factory, Tags, Warehouse, ClipboardList, Users, Truck, Store, ShieldCheck,
  Route, BarChart3, GraduationCap, Plug, Settings, Bell, Menu, X, ChevronsLeft, ChevronsRight, Lock, LogOut, Bird, ChevronDown, Building2,
} from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cx } from "@/components/ui/basic";
import { LanguageSwitcher } from "./language-switcher";
import { signOutAction, switchTenantAction } from "@/app/actions";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Wheat, PackageCheck, Factory, Tags, Warehouse, ClipboardList, Users, Truck, Store, ShieldCheck, Route, BarChart3, GraduationCap, Plug, Settings,
};

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: string;
  locked: boolean;
}

export interface ShellProps {
  nav: NavItem[];
  tenantName: string;
  isDemo: boolean;
  userName: string;
  userEmail: string;
  roleName: string;
  unread: number;
  memberships: { tenantId: string; tenantName: string; roleName: string }[];
  currentTenantId: string;
  banner?: ReactNode;
  isSuperAdmin: boolean;
  children: ReactNode;
}

function isActive(pathname: string, path: string) {
  if (path === "/app") return pathname === "/app";
  return pathname === path || pathname.startsWith(path + "/");
}

export function Shell(props: ShellProps) {
  const t = useT();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("pos_sidebar") === "1");
    } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("pos_sidebar", c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

  const sidebar = (mobile: boolean) => (
    <div className="flex h-full flex-col bg-navy-900 text-navy-200">
      <div className={cx("flex h-14 shrink-0 items-center gap-2.5 border-b border-white/5 px-4", collapsed && !mobile && "justify-center px-0")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Bird className="h-4.5 w-4.5" />
        </div>
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-white">PoultryOS</div>
            <div className="truncate text-[11px] text-navy-300">{props.tenantName}</div>
          </div>
        )}
        {mobile && (
          <button className="ml-auto rounded p-1 text-navy-300 hover:text-white" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {props.nav.map((item) => {
          const Icon = ICONS[item.icon] ?? LayoutDashboard;
          const active = isActive(pathname, item.path);
          return (
            <Link
              key={item.key}
              href={item.path}
              title={collapsed && !mobile ? t(item.label) : undefined}
              className={cx(
                "group mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium transition-colors",
                active ? "bg-white/10 text-white" : "text-navy-200 hover:bg-white/5 hover:text-white",
                collapsed && !mobile && "justify-center px-0",
              )}
            >
              <Icon className={cx("h-[18px] w-[18px] shrink-0", active ? "text-brand-500" : "text-navy-300 group-hover:text-navy-200")} />
              {(!collapsed || mobile) && <span className="flex-1 truncate">{t(item.label)}</span>}
              {(!collapsed || mobile) && item.locked && <Lock className="h-3.5 w-3.5 text-navy-300" />}
            </Link>
          );
        })}
        {props.isSuperAdmin && (
          <Link href="/admin" className={cx("mt-3 flex items-center gap-2.5 rounded-md border border-white/10 px-2.5 py-2 text-[13px] text-navy-200 hover:bg-white/5 hover:text-white", collapsed && !mobile && "justify-center px-0")}>
            <Building2 className="h-4 w-4" />
            {(!collapsed || mobile) && t("Super Admin")}
          </Link>
        )}
      </nav>
      {!mobile && (
        <button onClick={toggle} className="flex h-10 shrink-0 items-center justify-center border-t border-white/5 text-navy-300 hover:text-white" aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      )}
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className={cx("fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-150 lg:block", collapsed ? "w-[64px]" : "w-[248px]")}>{sidebar(false)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[272px] shadow-xl">{sidebar(true)}</aside>
        </div>
      )}
      <div className={cx("transition-[padding] duration-150", collapsed ? "lg:pl-[64px]" : "lg:pl-[248px]")}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white/95 px-3 backdrop-blur sm:px-5">
          <button className="rounded-md p-1.5 text-ink-2 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("Open menu")}>
            <Menu className="h-5 w-5" />
          </button>
          <WorkspaceSwitcher memberships={props.memberships} current={props.currentTenantId} tenantName={props.tenantName} />
          {props.isDemo && (
            <span className="hidden rounded-full bg-violet-50 px-2 py-0.5 text-[11.5px] font-semibold text-violet-700 ring-1 ring-violet-200 sm:inline">{t("DEMO DATA")}</span>
          )}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
            <div className="hidden sm:block">
              <LanguageSwitcher />
            </div>
            <Link href="/app/notifications" className="relative rounded-md p-2 text-ink-2 hover:bg-slate-100" aria-label={t("Notifications")}>
              <Bell className="h-[18px] w-[18px]" />
              {props.unread > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{props.unread > 99 ? "99+" : props.unread}</span>
              )}
            </Link>
            <UserMenu name={props.userName} email={props.userEmail} role={props.roleName} />
          </div>
        </header>
        {props.banner}
        <main className="mx-auto max-w-[1440px] px-3 py-5 sm:px-6 sm:py-6">{props.children}</main>
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ memberships, current, tenantName }: { memberships: ShellProps["memberships"]; current: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (memberships.length <= 1) return <span className="truncate text-sm font-semibold text-ink">{tenantName}</span>;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-ink hover:bg-slate-100">
        <span className="max-w-[160px] truncate sm:max-w-[260px]">{tenantName}</span>
        <ChevronDown className="h-4 w-4 text-ink-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-white p-1 shadow-lg">
          {memberships.map((m) => (
            <button
              key={m.tenantId}
              disabled={pending}
              onClick={() => start(() => switchTenantAction(m.tenantId))}
              className={cx("block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-50", m.tenantId === current && "bg-slate-50")}
            >
              <div className="font-medium text-ink">{m.tenantName}</div>
              <div className="text-[12px] text-ink-3">{m.roleName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md p-1 hover:bg-slate-100" aria-label={t("Account")}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-[12px] font-semibold text-white">{initials}</span>
        <span className="hidden text-left md:block">
          <span className="block max-w-[160px] truncate text-[13px] font-medium leading-tight text-ink">{name}</span>
          <span className="block max-w-[160px] truncate text-[11.5px] leading-tight text-ink-3">{t(role)}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-white p-1 shadow-lg">
            <div className="border-b border-line px-3 py-2">
              <div className="truncate text-sm font-medium text-ink">{name}</div>
              <div className="truncate text-[12px] text-ink-3">{email}</div>
            </div>
            <div className="px-3 py-2 sm:hidden">
              <LanguageSwitcher />
            </div>
            <Link href="/app/settings" className="block rounded px-3 py-2 text-sm text-ink-2 hover:bg-slate-50" onClick={() => setOpen(false)}>
              {t("Settings & Subscription")}
            </Link>
            <form action={signOutAction}>
              <button className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50">
                <LogOut className="h-4 w-4" />
                {t("Sign out")}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
