import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { ExportLinks, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";
import { Modal } from "@/components/ui/dialog";
import { FarmForm } from "../forms";
import { ProcurementTabs } from "../tabs";

export default async function FarmsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "procurement.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "code", defaultDir: "asc", sortable: ["code", "name", "region", "capacityBirds", "supplier.name"] });
  const supplierId = spGet(sp, "supplier");
  const region = spGet(sp, "region");
  const where: Prisma.FarmWhereInput = {
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { code: { contains: lp.q, mode: "insensitive" } }, { district: { contains: lp.q, mode: "insensitive" } }] } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(region ? { region } : {}),
  };
  const [rows, total, suppliers, regions] = await withTenant(ctx, (tx) =>
    Promise.all([
      tx.farm.findMany({ where, include: { supplier: true, _count: { select: { receipts: true } } }, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take }),
      tx.farm.count({ where }),
      tx.supplier.findMany({ select: { id: true, name: true, code: true }, orderBy: { code: "asc" } }),
      tx.farm.findMany({ distinct: ["region"], select: { region: true }, where: { region: { not: null } } }),
    ]),
  );
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Procurement & Farms")}
        description={t("Farms supplying live birds. The farm code is part of every batch ID.")}
        actions={
          <>
            <ExportLinks report="farms" />
            {ctx.can("procurement.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New farm")}</>} title="New farm" size="lg" triggerVariant="primary">
                <FarmForm suppliers={suppliers} />
              </Modal>
            )}
          </>
        }
      />
      <ProcurementTabs current="farms" t={t} />
      <Toolbar>
        <SearchBox placeholder="Search farm name, code, district…" />
        <FilterSelect param="supplier" label="Supplier" translate={false} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        <FilterSelect param="region" label="Region" translate={false} options={regions.map((r) => ({ value: r.region!, label: r.region! }))} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/procurement/farms"
        params={lp}
        total={total}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/procurement/farms/${r.id}`}
        columns={[
          { key: "code", header: "Code", sortKey: "code", render: (r) => r.code },
          { key: "name", header: "Farm", sortKey: "name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "supplier", header: "Supplier", sortKey: "supplier.name", render: (r) => r.supplier.name },
          { key: "region", header: "Region", sortKey: "region", render: (r) => <>{r.region ?? "—"}<div className="text-[12px] text-ink-3">{r.district}</div></> },
          { key: "breed", header: "Breed", render: (r) => r.breed ?? "—" },
          { key: "cap", header: "Capacity (birds)", sortKey: "capacityBirds", align: "right", render: (r) => (r.capacityBirds ? fmtNum(r.capacityBirds) : "—") },
          { key: "del", header: "Deliveries", align: "right", render: (r) => r._count.receipts },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
        ]}
      />
    </>
  );
}
