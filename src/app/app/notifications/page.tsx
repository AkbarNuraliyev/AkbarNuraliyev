import Link from "@/components/ui/link";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { FilterSelect, Toolbar } from "@/components/ui/controls";
import { ActionButton } from "@/components/ui/dialog";
import { spGet, type SP } from "@/components/ui/table";
import { markAllReadAction, resolveNotificationAction } from "./actions";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp();
  const sp = await searchParams;
  const status = spGet(sp, "status") ?? "OPEN";
  const type = spGet(sp, "type");
  const rows = await withTenant(ctx, (tx) =>
    tx.notification.findMany({
      where: { ...(status !== "ALL" ? { status: status as "OPEN" } : {}), ...(type ? { type } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );
  const types = ["TEMP_EXCURSION", "EXPIRY", "EXPIRED", "LOW_STOCK", "MASS_BALANCE", "RECALL", "NONCONFORMITY", "RECEIVING_REJECTION", "OVERDUE_INVOICE", "LICENCE_EXPIRY"];
  return (
    <>
      <PageHeader
        title={ctx.t("Notifications & alerts")}
        description={ctx.t("Operational alerts generated from records: cold-chain excursions, expiry, low stock, mass balance, recalls and quality events.")}
        actions={<ActionButton action={markAllReadAction} variant="secondary" size="md">Mark all as read</ActionButton>}
      />
      <Toolbar>
        <FilterSelect param="status" label="Status" allLabel="Open" options={[{ value: "ACKNOWLEDGED", label: "Acknowledged" }, { value: "RESOLVED", label: "Resolved" }, { value: "ALL", label: "All" }]} />
        <FilterSelect param="type" label="Type" options={types.map((x) => ({ value: x, label: x.replaceAll("_", " ").toLowerCase() }))} />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState title={ctx.t("No notifications")} description={ctx.t("Alerts appear here when records require attention.")} />
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <StatusBadge status={n.severity} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={n.readAt ? "text-sm text-ink" : "text-sm font-semibold text-ink"}>{n.title}</span>
                    {n.status !== "OPEN" && <StatusBadge status={n.status} />}
                  </div>
                  <p className="mt-0.5 text-[13px] text-ink-3">{n.message}</p>
                  <div className="mt-1 text-[12px] text-ink-3">
                    {fmtDateTime(n.createdAt, ctx.tz)} · {n.type.replaceAll("_", " ").toLowerCase()}
                    {n.link && (
                      <>
                        {" · "}
                        <Link href={n.link} className="link">{ctx.t("Open record")}</Link>
                      </>
                    )}
                  </div>
                </div>
                {n.status === "OPEN" && (
                  <div className="flex gap-1.5">
                    <ActionButton action={resolveNotificationAction} fields={{ id: n.id, status: "ACKNOWLEDGED" }}>Acknowledge</ActionButton>
                    <ActionButton action={resolveNotificationAction} fields={{ id: n.id, status: "RESOLVED" }} variant="primary">Resolve</ActionButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
