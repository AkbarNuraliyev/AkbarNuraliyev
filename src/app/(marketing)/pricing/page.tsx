import Link from "@/components/ui/link";
import type { Metadata } from "next";
import { Check, Minus } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { FEATURES } from "@/lib/modules";
import { fmtMoney } from "@/lib/format";
import { buttonClass, cx } from "@/components/ui/basic";

export const metadata: Metadata = { title: "Pricing" };
export const dynamic = "force-dynamic";

export default async function PricingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const yearly = sp.cycle === "yearly";
  const { t } = await getI18n();
  const plans = await prisma.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } });
  const limit = (v: number | null, unit: string) => (v === null ? t("Unlimited / custom") : `${v} ${t(unit)}`);
  return (
    <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("Plans for every stage of growth")}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-ink-3">{t("All plans start with a 14-day free trial. Prices in UZS, excluding VAT. Plan prices are configured by the platform operator.")}</p>
        <div className="mt-6 inline-flex rounded-lg border border-line bg-white p-1 text-sm">
          <Link href="/pricing" className={cx("rounded-md px-4 py-1.5 font-medium", !yearly ? "bg-navy-900 text-white" : "text-ink-2")}>{t("Monthly")}</Link>
          <Link href="/pricing?cycle=yearly" className={cx("rounded-md px-4 py-1.5 font-medium", yearly ? "bg-navy-900 text-white" : "text-ink-2")}>{t("Yearly")}</Link>
        </div>
      </div>
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {plans.map((p) => {
          const featured = p.code === "GROWTH";
          const price = yearly ? p.priceYearly : p.priceMonthly;
          return (
            <div key={p.id} className={cx("flex flex-col rounded-2xl border bg-white p-6", featured ? "border-brand-500 shadow-lg shadow-brand-600/10" : "border-line")}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{t(p.name)}</h2>
                {featured && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[12px] font-semibold text-brand-700">{t("Most popular")}</span>}
              </div>
              <p className="mt-1 min-h-[40px] text-[13px] text-ink-3">{t(p.description ?? "")}</p>
              <div className="mt-4">
                <span className="text-3xl font-semibold tracking-tight">{fmtMoney(price, p.currency)}</span>
                <span className="text-sm text-ink-3"> / {yearly ? t("year") : t("month")}</span>
              </div>
              <ul className="mt-5 space-y-1.5 text-[13px] text-ink-2">
                <li>{limit(p.maxUsers, "users")}</li>
                <li>{limit(p.maxFacilities, "production facilities")}</li>
                <li>{limit(p.maxWarehouses, "warehouses")}</li>
                <li>{p.maxRetailLocations === 0 ? t("No retail locations") : limit(p.maxRetailLocations, "retail locations")}</li>
              </ul>
              <Link href={`/register?plan=${p.code}`} className={buttonClass(featured ? "primary" : "secondary", "lg", "mt-6 w-full")}>
                {t("Start free trial")}
              </Link>
              <ul className="mt-6 space-y-2 border-t border-line pt-5 text-[13px]">
                {FEATURES.map((f) => {
                  const on = p.features.includes(f.key);
                  return (
                    <li key={f.key} className={cx("flex gap-2", on ? "text-ink" : "text-ink-3")}>
                      {on ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <Minus className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
                      {t(f.label)}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-8 text-center text-[12.5px] text-ink-3">
        {t("Online card payment is not connected yet; subscriptions are invoiced and payments are confirmed manually by the platform operator after bank transfer.")}
      </p>
    </main>
  );
}
