import Link from "next/link";
import {
  Wheat, PackageCheck, Factory, Tags, Warehouse, ClipboardList, Truck, Store, ShieldCheck, Route, BarChart3, Plug, ArrowRight, Check, ThermometerSnowflake, QrCode, Scale,
} from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { buttonClass } from "@/components/ui/basic";

const CHAIN = ["Farm", "Receiving", "Slaughter", "Processing", "Packaging", "Warehouse", "Orders", "Delivery", "Retail", "Customer"];

const MODULE_CARDS = [
  { icon: Wheat, title: "Procurement & farms", text: "Farm and supplier registry, contracts, deliveries and supplier performance comparison." },
  { icon: PackageCheck, title: "Raw material receiving", text: "Weigh, inspect, accept or reject each delivery. Unique batch ID and QR code per lot." },
  { icon: Factory, title: "Production / MES", text: "Shift input/output by batch, automatic yield and waste %, mass-balance checks." },
  { icon: Tags, title: "Products & labels", text: "One product master. Variable-weight EAN-13 labels with batch, dates and QR." },
  { icon: Warehouse, title: "Inventory & FEFO", text: "Stock by warehouse, chamber and batch. First-expired-first-out allocation." },
  { icon: ClipboardList, title: "B2B orders & portal", text: "Contract prices, customer self-service ordering, statuses from New to Delivered." },
  { icon: Truck, title: "Logistics & cold chain", text: "Vehicles, drivers, routes, shipments and temperature excursion alerts." },
  { icon: Store, title: "Retail locations", text: "Store stock, daily sales, returns, write-offs and low-stock alerts." },
  { icon: ShieldCheck, title: "Quality & HACCP", text: "Digital checklists, CCP records, non-conformities and CAPA with audit history." },
  { icon: Route, title: "Batch traceability", text: "Farm → shift → product → warehouse → shipment → customer in one view. Recall workflow." },
  { icon: BarChart3, title: "Reports & forecasting", text: "Executive KPIs from live records, transparent statistical demand forecasts." },
  { icon: Plug, title: "Integrations layer", text: "REST API, webhooks and adapters prepared for Didox, Faktura.uz, 1C, Smartup, Wialon, BILLZ." },
];

export default async function Landing() {
  const { t } = await getI18n();
  return (
    <main>
      <section className="relative overflow-hidden bg-navy-900 text-white">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "28px 28px" }} />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12.5px] text-navy-200">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> {t("For poultry farms, processing plants and distributors")}
            </span>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight sm:text-[52px]">
              {t("One system from farm to customer.")}
            </h1>
            <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-navy-200">
              {t("PoultryOS replaces disconnected spreadsheets and messenger orders with one operational record: every delivery becomes a traceable batch, every cut is weighed against its input, and every kilogram is shipped first-expired-first-out.")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className={buttonClass("primary", "lg")}>
                {t("Start 14-day free trial")} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/login" className={buttonClass("secondary", "lg", "border-white/20 bg-white/5 text-white hover:bg-white/10")}>
                {t("Explore the SAFI demo")}
              </Link>
            </div>
          </div>
          <div className="mt-14 overflow-x-auto">
            <ol className="flex min-w-max items-center gap-2 text-[13px]">
              {CHAIN.map((c, i) => (
                <li key={c} className="flex items-center gap-2">
                  <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 font-medium text-white">{t(c)}</span>
                  {i < CHAIN.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-brand-500" />}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-canvas">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:grid-cols-3 sm:px-6">
          {[
            { icon: Scale, title: "Yield you can trust", text: "Total yield, product yield and waste % are calculated from recorded weights — impossible entries are rejected and unexplained mass differences are flagged." },
            { icon: ThermometerSnowflake, title: "Short shelf life under control", text: "Chilled products with 72-hour shelf life are allocated FEFO, with 24/48/72-hour expiry views and cold-chain excursion alerts." },
            { icon: QrCode, title: "Recall in minutes, not days", text: "Search any batch, see every customer and store holding it, block stock and record recall actions with a full audit trail." },
          ].map((f) => (
            <div key={f.title} className="card p-5">
              <f.icon className="h-5 w-5 text-brand-600" />
              <h3 className="mt-3 font-semibold text-ink">{t(f.title)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{t(f.text)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Every operational module in one workspace")}</h2>
        <p className="mt-2 max-w-2xl text-ink-3">{t("Multi-tenant SaaS: each company gets an isolated workspace with its own users, roles, settings and data.")}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULE_CARDS.map((m) => (
            <div key={m.title} className="rounded-xl border border-line p-5 transition-colors hover:border-navy-200">
              <m.icon className="h-5 w-5 text-navy-700" />
              <h3 className="mt-3 font-semibold text-ink">{t(m.title)}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-3">{t(m.text)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="traceability" className="bg-canvas">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("End-to-end batch traceability")}</h2>
            <p className="mt-3 text-ink-3">{t("When a customer complaint arrives, PoultryOS immediately shows:")}</p>
            <ul className="mt-4 space-y-2 text-sm text-ink-2">
              {[
                "The source farm and supplier",
                "The receiving record and inspection results",
                "Production shifts and lines that processed the batch",
                "Products manufactured from the batch",
                "Current inventory by warehouse, chamber and store",
                "Customers and shipments that received the batch",
              ].map((x) => (
                <li key={x} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {t(x)}
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-5 font-mono text-[12.5px] leading-6 text-ink-2">
            <div className="text-ink-3">{t("Batch")}</div>
            <div className="text-[15px] font-semibold text-ink">SAFI-20261111-FARM001-0001</div>
            <div className="mt-3 space-y-1.5">
              {[
                ["Farm", "FARM001 · Bahor Broiler · 2 140 birds · 5 312 kg"],
                ["Receiving", "RCV-2026-00412 · Accepted · 06:20"],
                ["Production", "SH-2026-00123 · L1 DAY · yield 76.8%"],
                ["Products", "14 SKUs · 4 088 kg"],
                ["Warehouse", "Factory cold store · 1 240 kg"],
                ["Shipment", "SHP-2026-00311 · 01 A 101 SA · +2.8 °C"],
                ["Customers", "7 customers · 3 stores"],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <span className="w-24 shrink-0 text-ink-3">{t(k)}</span>
                  <span className="text-ink">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl bg-navy-900 px-6 py-10 text-white sm:px-10">
          <h2 className="text-2xl font-semibold tracking-tight">{t("See it with realistic data")}</h2>
          <p className="mt-2 max-w-2xl text-navy-200">
            {t("The SAFI Demo workspace contains a clearly labelled demonstration company with 50+ farms, 40+ products, 21 B2B customers and 10 retail stores. Demo records never mix with real tenants.")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/login" className={buttonClass("primary", "lg")}>{t("Open the demo")}</Link>
            <Link href="/roi" className={buttonClass("secondary", "lg", "border-white/20 bg-white/5 text-white hover:bg-white/10")}>{t("Estimate your ROI")}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
