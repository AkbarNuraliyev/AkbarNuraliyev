import Link from "@/components/ui/link";
import { requireSuperAdmin } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable, spGet, type SP } from "@/components/ui/table";
import { SearchBox, Toolbar } from "@/components/ui/controls";
import { ActionButton } from "@/components/ui/dialog";
import { setTenantStatusAction } from "../actions";

export default async function AdminOrgs({ searchParams }: { searchParams: Promise<SP> }) {
  const { t } = await requireSuperAdmin();
  const sp = await searchParams;
  const q = spGet(sp, "q");
  const orgs = await withSystem((tx) =>
    tx.tenant.findMany({
      where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { taxId: { contains: q } }] } : {},
      include: { subscription: { include: { plan: true } }, _count: { select: { memberships: true, rOrder: true, rRawMaterialReceipt: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );
  return (
    <>
      <PageHeader title={t("Organizations")} description={t("Every registered company workspace. Suspending blocks sign-in and API access immediately; data is retained.")} />
      <Toolbar><SearchBox placeholder="Name, slug, TIN…" /></Toolbar>
      <SimpleTable head={[t("Organization"), t("Plan"), t("Subscription"), t("Users"), t("Orders"), t("Receipts"), t("Created"), t("Status"), ""]}>
        {orgs.map((o) => (
          <tr key={o.id}>
            <td className="td"><Link href={`/admin/organizations/${o.id}`} className="link">{o.name}</Link><div className="text-[11.5px] text-ink-3">{o.slug}{o.isDemo && <Pill tone="violet" className="ml-1">demo</Pill>}</div></td>
            <td className="td">{o.subscription?.plan.name ?? "—"}</td>
            <td className="td">{o.subscription && <StatusBadge status={o.subscription.status} />}</td>
            <td className="td tabular">{o._count.memberships}</td>
            <td className="td tabular">{o._count.rOrder}</td>
            <td className="td tabular">{o._count.rRawMaterialReceipt}</td>
            <td className="td text-[12.5px]">{fmtDate(o.createdAt, "Asia/Tashkent")}</td>
            <td className="td"><StatusBadge status={o.status} /></td>
            <td className="td text-right">
              {o.status === "ACTIVE" ? (
                <ActionButton action={setTenantStatusAction} fields={{ tenantId: o.id, status: "SUSPENDED" }} variant="ghost" reasonLabel="Reason (shown in audit log)" confirm={`${t("Suspend")} ${o.name}?`} confirmText="Users are signed out and cannot sign in until reactivated.">
                  Suspend
                </ActionButton>
              ) : (
                <ActionButton action={setTenantStatusAction} fields={{ tenantId: o.id, status: "ACTIVE" }} variant="primary" confirm={`${t("Activate")} ${o.name}?`} confirmVariant="primary">
                  Activate
                </ActionButton>
              )}
            </td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
