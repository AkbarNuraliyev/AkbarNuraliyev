import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireApp } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtKg, fmtMoney } from "@/lib/format";
import { ExportLinks, PageHeader, Pill } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { DataTable, listParams, orderByOf, spGet, type SP } from "@/components/ui/table";
import { FilterSelect, SearchBox, Toolbar } from "@/components/ui/controls";
import { Modal } from "@/components/ui/dialog";
import { ProductForm } from "./forms";
import { ProductTabs } from "./tabs";
import { EPS } from "@/server/services/inventory";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireApp({ permission: "products.view" });
  const sp = await searchParams;
  const lp = listParams(sp, { defaultSort: "sku", defaultDir: "asc", sortable: ["sku", "name", "price", "shelfLifeHours", "category.name"], pageSize: 50 });
  const cat = spGet(sp, "category");
  const storage = spGet(sp, "storage");
  const where: Prisma.ProductWhereInput = {
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { sku: { contains: lp.q, mode: "insensitive" } }, { pluCode: lp.q }, { barcode: lp.q }] } : {}),
    ...(cat ? { categoryId: cat } : {}),
    ...(storage ? { storageType: storage as "CHILLED" } : {}),
  };
  const now = new Date();
  const [rows, total, cats, stock] = await withTenant(ctx, (tx) =>
    Promise.all([
      tx.product.findMany({ where, include: { category: true }, orderBy: orderByOf(lp.sort, lp.dir), skip: lp.skip, take: lp.take }),
      tx.product.count({ where }),
      tx.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
      tx.inventory.groupBy({ by: ["productId"], where: { quantityKg: { gt: EPS }, expiryDate: { gt: now }, status: "AVAILABLE" }, _sum: { quantityKg: true, reservedKg: true } }),
    ]),
  );
  const t = ctx.t;
  return (
    <>
      <PageHeader
        title={t("Products & Labels")}
        description={t("Central product master: SKUs, storage rules, shelf life, prices, barcodes and batch tracking.")}
        actions={
          <>
            <ExportLinks report="products" />
            {ctx.can("products.manage") && (
              <Modal trigger={<><Plus className="h-4 w-4" />{t("New product")}</>} title="New product" size="xl" triggerVariant="primary">
                <ProductForm categories={cats} />
              </Modal>
            )}
          </>
        }
      />
      <ProductTabs current="catalog" t={t} />
      <Toolbar>
        <SearchBox placeholder="Search SKU, name, PLU, barcode…" />
        <FilterSelect param="category" label="Category" options={cats.map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect param="storage" label="Storage" options={[{ value: "CHILLED", label: "Chilled" }, { value: "FROZEN", label: "Frozen" }]} />
      </Toolbar>
      <DataTable
        t={t}
        sp={sp}
        basePath="/app/products"
        params={lp}
        total={total}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/app/products/${r.id}`}
        columns={[
          { key: "sku", header: "SKU", sortKey: "sku", render: (r) => r.sku },
          { key: "name", header: "Product", sortKey: "name", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "cat", header: "Category", sortKey: "category.name", render: (r) => t(r.category.name) },
          { key: "st", header: "Storage", render: (r) => <Pill tone={r.storageType === "FROZEN" ? "blue" : "green"}>{t(r.storageType === "FROZEN" ? "Frozen" : "Chilled")}</Pill> },
          { key: "shelf", header: "Shelf life", sortKey: "shelfLifeHours", align: "right", render: (r) => (r.shelfLifeHours >= 720 ? `${Math.round(r.shelfLifeHours / 24)} ${t("days")}` : `${r.shelfLifeHours} h`) },
          { key: "w", header: "Weight", render: (r) => (r.isVariableWeight ? t("Variable") : `${r.netWeightKg} kg`) },
          { key: "price", header: "Price", sortKey: "price", align: "right", render: (r) => fmtMoney(r.price) },
          {
            key: "stock",
            header: "Free stock",
            align: "right",
            render: (r) => {
              const s = stock.find((x) => x.productId === r.id);
              const free = (s?._sum.quantityKg ?? 0) - (s?._sum.reservedKg ?? 0);
              return <span className={r.minStockKg && free < r.minStockKg ? "font-medium text-amber-700" : ""}>{fmtKg(free, 1)}</span>;
            },
          },
          { key: "status", header: "Status", render: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} /> },
        ]}
      />
    </>
  );
}
