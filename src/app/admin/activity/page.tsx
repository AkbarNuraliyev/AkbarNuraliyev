import { requireSuperAdmin } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { PageHeader, Pill } from "@/components/ui/basic";
import { SimpleTable, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";

export default async function AdminActivity({ searchParams }: { searchParams: Promise<SP> }) {
  const { t } = await requireSuperAdmin();
  const sp = await searchParams;
  const q = spGet(sp, "q");
  const scope = spGet(sp, "scope");
  const rows = await withSystem(async (tx) => {
    const logs = await tx.auditLog.findMany({
      where: {
        ...(scope === "platform" ? { action: { startsWith: "platform." } } : scope === "auth" ? { action: { startsWith: "auth." } } : {}),
        ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" } }, { userEmail: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const tenants = await tx.tenant.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.tenantId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
    return logs.map((l) => ({ ...l, tenantName: tenants.find((x) => x.id === l.tenantId)?.name ?? "—" }));
  });
  return (
    <>
      <PageHeader title={t("Platform activity")} description={t("Cross-tenant audit trail (sign-ins, registrations, operator actions and business events).")} />
      <Toolbar>
        <SearchBox placeholder="Action, user, summary…" />
        <FilterSelect param="scope" label="Scope" options={[{ value: "platform", label: "Operator actions" }, { value: "auth", label: "Authentication" }]} />
      </Toolbar>
      <SimpleTable head={[t("Time"), t("Organization"), t("User"), t("Action"), t("Summary")]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="td whitespace-nowrap text-[12.5px]">{fmtDateTime(r.createdAt, "Asia/Tashkent")}</td>
            <td className="td text-[12.5px]">{r.tenantName}</td>
            <td className="td text-[12.5px]">{r.userEmail ?? "—"}</td>
            <td className="td"><Pill>{r.action}</Pill></td>
            <td className="td text-[12.5px]">{r.summary}</td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
