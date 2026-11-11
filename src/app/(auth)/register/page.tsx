import Link from "next/link";
import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { prisma } from "@/lib/prisma";
import { ActionForm, Checkbox, FormError, SubmitButton, TextInput, SelectInput, FormGrid } from "@/components/ui/form";
import { fmtMoney } from "@/lib/format";
import { registerAction } from "../actions";

export const metadata: Metadata = { title: "Create your organization" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const plans = await prisma.plan.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } });
  const selected = plans.find((p) => p.code === sp.plan)?.code ?? "GROWTH";
  return (
    <div className="w-full max-w-[520px]">
      <div className="card p-6 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("Create your organization")}</h1>
        <p className="mt-1 text-sm text-ink-3">{t("Start a 14-day free trial. No payment details required. Your workspace and data are isolated from other companies.")}</p>
        <ActionForm action={registerAction} className="mt-5 space-y-4">
          <TextInput name="companyName" label="Company name" required placeholder="e.g. Sifatli Tovuq LLC" />
          <FormGrid>
            <TextInput name="name" label="Your full name" required autoComplete="name" />
            <TextInput name="phone" label="Phone" type="tel" autoComplete="tel" placeholder="+998 90 123 45 67" />
          </FormGrid>
          <TextInput name="email" label="Work email" type="email" required autoComplete="email" />
          <TextInput name="password" label="Password" type="password" required autoComplete="new-password" hint="At least 8 characters with letters and digits." />
          <SelectInput
            name="plan"
            label="Plan for the trial"
            defaultValue={selected}
            options={plans.map((p) => ({ value: p.code, label: `${p.name} — ${fmtMoney(p.priceMonthly)} / ${t("month")}` }))}
          />
          <Checkbox name="terms" label="I agree to the terms of service and the data processing agreement." />
          <FormError />
          <SubmitButton className="w-full" size="lg">Create workspace</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-[13px] text-ink-3">
          {t("Already have an account?")} <Link href="/login" className="link">{t("Sign in")}</Link>
        </p>
      </div>
    </div>
  );
}
