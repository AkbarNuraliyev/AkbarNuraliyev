import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDay, fmtMoney } from "@/lib/format";
import { ExportLinks, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";
import { Modal } from "@/components/ui/dialog";
import { SupplierForm } from "./forms";
import { ProcurementTabs } from "./tabs";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "procurement.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "code", defaultDir: "asc", sortable: ["code", "name", "region", "type", "contractEnd"] });
  const type = spGet(sp, "type");
  const active = spGet(sp, "active");
  const where: Prisma.SupplierWhereInput = {
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { code: { contains: lp.q, mode: "insensitive" } }, { taxId: { contains: lp.q } }, { contactName: { contains: lp.q, mode: "insensitive" } }] } : {}),
    ...(type ? { type: type as "FARM" } : {}),
    ...(active ? { isActive: active === "yes" } : {}),
  };
  const [rows, total] = await withTenant(ctx, (tx) =>
    Promise.all([
      tx.supplier.findMany({ where, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take, include: { _count: { select: { farms: true, receipts: true } } } }),
      tx.supplier.count({ where }),
    ]),
  );
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Procurement & Farms")}
        description={t("Supplier and farm registry with contracts, deliveries and performance.")}
        actions={
          <>
            <ExportLinks report="suppliers" />
            {ctx.can("procurement.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New supplier")}</>} title="New supplier" size="lg" triggerVariant="primary">
                <SupplierForm />
              </Modal>
            )}
          </>
        }
      />
      <ProcurementTabs current="suppliers" t={t} />
      <Toolbar>
        <SearchBox placeholder="Search name, code, TIN, contact…" />
        <FilterSelect param="type" label="Type" options={[{ value: "FARM", label: "Farm" }, { value: "INTEGRATOR", label: "Integrator" }, { value: "TRADER", label: "Trader" }]} />
        <FilterSelect param="active" label="Status" options={[{ value: "yes", label: "Active" }, { value: "no", label: "Inactive" }]} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/procurement"
        params={lp}
        total={total}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/procurement/suppliers/${r.id}`}
        columns={[
          { key: "code", header: "Code", sortKey: "code", render: (r) => r.code },
          { key: "name", header: "Supplier", sortKey: "name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "type", header: "Type", sortKey: "type", render: (r) => <Pill>{t(r.type.charAt(0) + r.type.slice(1).toLowerCase())}</Pill> },
          { key: "region", header: "Region", sortKey: "region", render: (r) => r.region ?? "—" },
          { key: "contact", header: "Contact", render: (r) => <span className="text-ink-2">{r.contactName ?? "—"}<br /><span className="text-[12px] text-ink-3">{r.phone}</span></span> },
          { key: "contract", header: "Contract until", sortKey: "contractEnd", render: (r) => (r.contractEnd ? fmtDay(r.contractEnd) : "—") },
          { key: "price", header: "Price / kg live", align: "right", render: (r) => (r.pricePerKgLive ? fmtMoney(r.pricePerKgLive) : "—") },
          { key: "farms", header: "Farms", align: "right", render: (r) => r._count.farms },
          { key: "deliveries", header: "Deliveries", align: "right", render: (r) => r._count.receipts },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
        ]}
      />
    </>
  );
}
