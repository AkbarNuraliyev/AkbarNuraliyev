import Link from "@/components/ui/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cx } from "./basic";

export type SP = Record<string, string | string[] | undefined>;

export function spGet(sp: SP, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || undefined;
}

export function qs(sp: SP, patch: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) p.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export interface ListParams {
  q?: string;
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  sort: string;
  dir: "asc" | "desc";
}

export function listParams(sp: SP, opts: { defaultSort: string; defaultDir?: "asc" | "desc"; sortable: string[]; pageSize?: number }): ListParams {
  const pageSize = Math.min(100, Math.max(10, Number(spGet(sp, "size")) || opts.pageSize || 25));
  const page = Math.max(1, Number(spGet(sp, "page")) || 1);
  const sortRaw = spGet(sp, "sort");
  const sort = sortRaw && opts.sortable.includes(sortRaw) ? sortRaw : opts.defaultSort;
  const dirRaw = spGet(sp, "dir");
  const dir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : opts.defaultDir ?? "desc";
  return { q: spGet(sp, "q")?.trim() || undefined, page, pageSize, skip: (page - 1) * pageSize, take: pageSize, sort, dir };
}

/** Turns "customer.name" into { customer: { name: dir } } for Prisma orderBy. */
export function orderByOf(sort: string, dir: "asc" | "desc"): Record<string, unknown> {
  const parts = sort.split(".");
  let o: Record<string, unknown> = { [parts[parts.length - 1]]: dir };
  for (let i = parts.length - 2; i >= 0; i--) o = { [parts[i]]: o };
  return o;
}

export interface Column<T> {
  key: string;
  header: string;
  sortKey?: string;
  align?: "left" | "right" | "center";
  className?: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sp,
  basePath,
  total,
  params,
  empty,
  t,
  rowHref,
  footer,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sp: SP;
  basePath: string;
  total?: number;
  params?: ListParams;
  empty?: ReactNode;
  t: (k: string, p?: Record<string, string | number>) => string;
  rowHref?: (row: T) => string | null;
  footer?: ReactNode;
  dense?: boolean;
}) {
  const pages = params && total !== undefined ? Math.max(1, Math.ceil(total / params.pageSize)) : 1;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line">
          <thead className="bg-slate-50/70">
            <tr>
              {columns.map((c) => {
                const active = params && c.sortKey && params.sort === c.sortKey;
                const nextDir = active && params?.dir === "asc" ? "desc" : "asc";
                return (
                  <th key={c.key} className={cx("th", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                    {c.sortKey && params ? (
                      <Link
                        href={`${basePath}${qs(sp, { sort: c.sortKey, dir: nextDir, page: null })}`}
                        className={cx("inline-flex items-center gap-1 hover:text-ink", active && "text-ink")}
                        scroll={false}
                      >
                        {t(c.header)}
                        {active ? params!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                      </Link>
                    ) : (
                      t(c.header)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-ink-3">
                  {empty ?? t("No records found")}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr key={rowKey(row)} className={cx("transition-colors", href && "hover:bg-slate-50/80")}>
                  {columns.map((c, i) => (
                    <td key={c.key} className={cx("td", dense && "py-2", c.align === "right" && "text-right tabular", c.align === "center" && "text-center", c.className)}>
                      {href && i === 0 ? (
                        <Link href={href} className="link">
                          {c.render(row)}
                        </Link>
                      ) : (
                        c.render(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {footer}
        </table>
      </div>
      {params && total !== undefined && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-4 py-2.5 text-[13px] text-ink-3">
          <span>
            {t("Showing {from}–{to} of {total}", {
              from: params.skip + 1,
              to: Math.min(params.skip + params.take, total),
              total,
            })}
          </span>
          <div className="flex items-center gap-1">
            <PageLink disabled={params.page <= 1} href={`${basePath}${qs(sp, { page: params.page - 1 })}`} label={t("Previous")}>
              <ChevronLeft className="h-4 w-4" />
            </PageLink>
            <span className="px-2 tabular">
              {params.page} / {pages}
            </span>
            <PageLink disabled={params.page >= pages} href={`${basePath}${qs(sp, { page: params.page + 1 })}`} label={t("Next")}>
              <ChevronRight className="h-4 w-4" />
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, children, label }: { href: string; disabled: boolean; children: ReactNode; label: string }) {
  if (disabled)
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded border border-line text-slate-300" aria-label={label}>
        {children}
      </span>
    );
  return (
    <Link href={href} scroll={false} aria-label={label} className="inline-flex h-7 w-7 items-center justify-center rounded border border-line text-ink-2 hover:bg-slate-50">
      {children}
    </Link>
  );
}

/** Simple non-paginated table for detail pages. */
export function SimpleTable({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto rounded-lg border border-line", className)}>
      <table className="min-w-full divide-y divide-line">
        <thead className="bg-slate-50/70">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="th">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-white">{children}</tbody>
      </table>
    </div>
  );
}
