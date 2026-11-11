import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";
export type ButtonSize = "sm" | "md" | "lg";

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" && "h-8 px-2.5 text-[13px]",
    size === "md" && "h-9 px-3.5 text-sm",
    size === "lg" && "h-11 px-5 text-[15px]",
    variant === "primary" && "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
    variant === "secondary" && "border border-line bg-white text-ink shadow-[0_1px_0_rgba(16,24,40,0.04)] hover:bg-slate-50",
    variant === "ghost" && "text-ink-2 hover:bg-slate-100 hover:text-ink",
    variant === "danger" && "bg-red-600 text-white shadow-sm hover:bg-red-700",
    variant === "dark" && "bg-navy-900 text-white hover:bg-navy-800",
    extra,
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "md",
  className,
  prefetch,
  target,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  prefetch?: boolean;
  target?: string;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} prefetch={prefetch} target={target}>
      {children}
    </Link>
  );
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx("card", padded && "p-4 sm:p-5", className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="mb-1 flex flex-wrap items-center gap-1 text-[13px] text-ink-3">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {b.href ? (
                  <Link href={b.href} className="hover:text-ink">
                    {b.label}
                  </Link>
                ) : (
                  <span>{b.label}</span>
                )}
                {i < breadcrumbs.length - 1 && <span className="text-slate-300">/</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-[22px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({
  label,
  value,
  sub,
  href,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  tone?: "default" | "good" | "warning" | "critical";
  icon?: ReactNode;
}) {
  const inner = (
    <div className={cx("card h-full p-4 transition-colors", href && "hover:border-navy-200 hover:bg-slate-50/60")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink-3">{label}</span>
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span
          className={cx(
            "tabular text-[22px] font-semibold leading-tight tracking-tight",
            tone === "good" && "text-brand-700",
            tone === "warning" && "text-amber-700",
            tone === "critical" && "text-red-700",
          )}
        >
          {value}
        </span>
      </div>
      {sub && <div className="mt-1 text-[12px] text-ink-3">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-md text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "critical" | "good"; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-lg border px-4 py-3 text-sm",
        tone === "info" && "border-navy-200 bg-navy-200/20 text-navy-800",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
        tone === "critical" && "border-red-200 bg-red-50 text-red-900",
        tone === "good" && "border-brand-200 bg-brand-50 text-brand-700",
        className,
      )}
    >
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cx(!!title && "mt-0.5", "text-[13px] leading-relaxed")}>{children}</div>}
    </div>
  );
}

export function Pill({ children, tone = "gray", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset", TONES[tone], className)}>{children}</span>;
}

export type Tone = "gray" | "green" | "blue" | "amber" | "red" | "violet" | "navy" | "orange";
export const TONES: Record<Tone, string> = {
  gray: "bg-slate-50 text-slate-700 ring-slate-200",
  green: "bg-brand-50 text-brand-700 ring-brand-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  navy: "bg-navy-900 text-white ring-navy-900",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
};

export function DescriptionList({ items, cols = 2 }: { items: { label: string; value: ReactNode }[]; cols?: 1 | 2 | 3 | 4 }) {
  return (
    <dl className={cx("grid gap-x-6 gap-y-3", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[12px] font-medium text-ink-3">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({ tabs, current }: { tabs: { href: string; label: string; key: string; count?: number }[]; current: string }) {
  return (
    <div className="mb-5 -mx-1 overflow-x-auto border-b border-line">
      <nav className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              t.key === current ? "border-brand-600 text-ink" : "border-transparent text-ink-3 hover:border-slate-300 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-ink-2">{t.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function ProgressBar({ value, max = 100, tone = "green" }: { value: number; max?: number; tone?: "green" | "amber" | "red" | "blue" }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={cx("h-full rounded-full", tone === "green" && "bg-brand-500", tone === "amber" && "bg-amber-500", tone === "red" && "bg-red-500", tone === "blue" && "bg-blue-500")}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

export function DataSourceBadge({ source, t }: { source: string; t: (k: string) => string }) {
  if (source === "DEVICE") return <Pill tone="green">{t("Device")}</Pill>;
  if (source === "DEMO") return <Pill tone="violet">{t("Demo data")}</Pill>;
  return <Pill tone="gray">{t("Manual")}</Pill>;
}

/** CSV / Excel download links for a report defined in src/server/exports.ts. */
export function ExportLinks({ report, query = "" }: { report: string; query?: string }) {
  const q = query.startsWith("?") ? query.slice(1) : query;
  const base = `/api/export/${report}${q ? `?${q}` : ""}`;
  const xlsx = `/api/export/${report}?${q ? `${q}&` : ""}format=xlsx`;
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-line bg-white text-[13px] font-medium shadow-[0_1px_0_rgba(16,24,40,0.04)]">
      <a href={base} className="px-2.5 py-1.5 text-ink-2 hover:bg-slate-50 hover:text-ink">CSV</a>
      <a href={xlsx} className="border-l border-line px-2.5 py-1.5 text-ink-2 hover:bg-slate-50 hover:text-ink">Excel</a>
    </span>
  );
}
