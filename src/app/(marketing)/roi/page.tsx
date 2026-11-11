import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { RoiCalculator } from "@/components/roi-calculator";

export const metadata: Metadata = { title: "ROI calculator" };

export default async function RoiPage() {
  const { t } = await getI18n();
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">{t("Financial impact calculator")}</h1>
      <p className="mt-2 max-w-3xl text-ink-3">
        {t("Estimate the potential effect of FEFO inventory, fewer returns, better yield control and faster document processing. Every input is editable.")}
      </p>
      <div className="mt-8">
        <RoiCalculator />
      </div>
    </main>
  );
}
