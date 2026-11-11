import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bird, ShieldCheck, AlertTriangle, FileText } from "lucide-react";
import { withSystem } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { parseSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/format";
import { LanguageSwitcher } from "@/components/app/language-switcher";

export const metadata: Metadata = { title: "Product traceability", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Public, customer-facing QR page. Uses a narrow system-context query that
 * returns only approved fields (no prices, customers, quantities or internal IDs).
 */
export default async function PublicTrace({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Z0-9]{8,20}$/.test(token)) notFound();
  const { t } = await getI18n();
  const data = await withSystem(async (tx) => {
    const batch = await tx.productionBatch.findUnique({
      where: { publicToken: token },
      select: {
        id: true,
        code: true,
        status: true,
        createdAt: true,
        tenantId: true,
        farm: { select: { name: true, region: true, district: true } },
        tenant: { select: { name: true, status: true, isDemo: true, settings: true, timezone: true, subscription: { select: { plan: { select: { features: true } } } }, featureOverrides: true } },
        recalls: { where: { status: { not: "CLOSED" } }, select: { number: true, initiatedAt: true } },
      },
    });
    if (!batch) return null;
    const products = await tx.productionOutput.findMany({
      where: { batchId: batch.id, productId: { not: null } },
      distinct: ["productId"],
      select: { product: { select: { name: true, storageType: true, shelfLifeHours: true, storageInstructions: true, ingredients: true } }, producedAt: true },
      orderBy: { producedAt: "asc" },
    });
    const certs = await tx.document.findMany({ where: { tenantId: batch.tenantId, isPublic: true, type: "CERTIFICATE" }, select: { id: true, title: true } });
    return { batch, products, certs };
  });
  if (!data) notFound();
  const { batch, products, certs } = data;
  const features = new Set(batch.tenant.subscription?.plan.features ?? []);
  for (const o of batch.tenant.featureOverrides) (o.enabled ? features.add(o.feature) : features.delete(o.feature));
  if (batch.tenant.status !== "ACTIVE" || !features.has("qr_public")) notFound();
  const s = parseSettings(batch.tenant.settings);
  const tz = batch.tenant.timezone;
  const recalled = batch.status === "RECALLED" || batch.recalls.length > 0;
  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex items-center justify-between bg-navy-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Bird className="h-5 w-5 text-brand-500" />
          <span className="font-semibold">{batch.tenant.name}</span>
        </div>
        <LanguageSwitcher dark compact />
      </header>
      <main className="mx-auto max-w-lg space-y-4 px-4 py-6">
        {batch.tenant.isDemo && <div className="rounded-lg bg-violet-50 px-3 py-2 text-center text-[12.5px] text-violet-900">{t("Demonstration data — not a real product.")}</div>}
        {recalled ? (
          <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <div>
              <div className="font-semibold">{t("This batch has been recalled")}</div>
              <div className="mt-1 text-sm">{t("Do not consume this product. Return it to the place of purchase or contact the producer.")}</div>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-brand-700">
            <ShieldCheck className="h-6 w-6 shrink-0" />
            <div>
              <div className="font-semibold">{t("Batch verified")}</div>
              <div className="mt-1 text-sm">{t("This product is registered in the producer's traceability system.")}</div>
            </div>
          </div>
        )}
        <div className="card p-5">
          <div className="text-[12px] uppercase tracking-wide text-ink-3">{t("Batch number")}</div>
          <div className="break-all font-mono text-lg font-semibold">{batch.code}</div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[12px] text-ink-3">{t("Raw material received")}</dt>
              <dd className="font-medium">{fmtDate(batch.createdAt, tz)}</dd>
            </div>
            {s.showFarmOnPublicPage && (
              <div>
                <dt className="text-[12px] text-ink-3">{t("Farm region")}</dt>
                <dd className="font-medium">{[batch.farm.region, batch.farm.district].filter(Boolean).join(", ") || "—"}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="card divide-y divide-line">
          {products.map((p, i) => {
            const exp = new Date(p.producedAt.getTime() + p.product!.shelfLifeHours * 3600000);
            return (
              <div key={i} className="p-4">
                <div className="font-semibold">{p.product!.name}</div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
                  <div><dt className="text-ink-3">{t("Production date")}</dt><dd>{fmtDate(p.producedAt, tz)}</dd></div>
                  <div><dt className="text-ink-3">{t("Use by")}</dt><dd className="font-medium">{fmtDate(exp, tz)}</dd></div>
                  <div className="col-span-2"><dt className="text-ink-3">{t("Storage")}</dt><dd>{p.product!.storageInstructions ?? (p.product!.storageType === "FROZEN" ? "≤ −18 °C" : "0…+4 °C")}</dd></div>
                  {p.product!.ingredients && <div className="col-span-2"><dt className="text-ink-3">{t("Ingredients")}</dt><dd>{p.product!.ingredients}</dd></div>}
                </dl>
              </div>
            );
          })}
          {products.length === 0 && <div className="p-4 text-[13px] text-ink-3">{t("Product information will appear after processing.")}</div>}
        </div>
        {certs.length > 0 && (
          <div className="card p-4">
            <div className="mb-2 text-sm font-semibold">{t("Certificates")}</div>
            <ul className="space-y-1.5">
              {certs.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-[13px]">
                  <FileText className="h-4 w-4 text-ink-3" />
                  <a href={`/api/documents/${c.id}`} className="link" target="_blank" rel="noreferrer">{c.title}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.publicPageMessage && <p className="text-center text-[12.5px] text-ink-3">{s.publicPageMessage}</p>}
        <p className="text-center text-[11px] text-ink-3">{t("Traceability by PoultryOS")}</p>
      </main>
    </div>
  );
}
