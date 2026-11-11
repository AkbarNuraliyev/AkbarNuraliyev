import Link from "@/components/ui/link";
import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { ActionForm, FormError, SubmitButton, TextInput, Hidden } from "@/components/ui/form";
import { Alert } from "@/components/ui/basic";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  "no-workspace": "Your account is not a member of any active workspace.",
  "portal-disabled": "The B2B portal is not enabled for this organization.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t } = await getI18n();
  const showDemo = process.env.SHOW_DEMO_LOGINS !== "0";
  return (
    <div className="w-full max-w-[400px]">
      <div className="card p-6 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("Sign in to PoultryOS")}</h1>
        <p className="mt-1 text-sm text-ink-3">{t("Use your work email and password.")}</p>
        {sp.error && ERRORS[sp.error] && <Alert tone="warning" className="mt-4">{t(ERRORS[sp.error])}</Alert>}
        {sp.reset && <Alert tone="good" className="mt-4">{t("Password updated. You can now sign in.")}</Alert>}
        <ActionForm action={loginAction} className="mt-5 space-y-4">
          <Hidden name="next" value={sp.next} />
          <TextInput name="email" label="Email" type="email" autoComplete="email" required autoFocus />
          <TextInput name="password" label="Password" type="password" autoComplete="current-password" required />
          <FormError />
          <SubmitButton className="w-full" size="lg">Sign in</SubmitButton>
        </ActionForm>
        <div className="mt-4 flex justify-between text-[13px]">
          <Link href="/forgot-password" className="link">{t("Forgot password?")}</Link>
          <Link href="/register" className="link">{t("Create an organization")}</Link>
        </div>
      </div>
      {showDemo && (
        <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4 text-[12.5px] text-violet-950">
          <div className="font-semibold">{t("SAFI Demo accounts (demonstration data)")}</div>
          <p className="mt-1 text-violet-900/80">{t("Password for all demo users")}: <code className="rounded bg-white px-1">Demo#2026!</code></p>
          <ul className="mt-2 grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
            <li><code>owner@safi-demo.uz</code> — {t("Tenant Owner")}</li>
            <li><code>admin@safi-demo.uz</code> — {t("Company Admin")}</li>
            <li><code>production@safi-demo.uz</code> — {t("Department Manager")}</li>
            <li><code>warehouse@safi-demo.uz</code> — {t("Employee")}</li>
            <li><code>driver@safi-demo.uz</code> — {t("Driver (mobile)")}</li>
            <li><code>buyer@baraka-demo.uz</code> — {t("B2B portal")}</li>
          </ul>
          <p className="mt-2 text-violet-900/80">{t("Super Admin")}: <code>admin@poultryos.local</code> / <code>Admin#2026!</code></p>
        </div>
      )}
    </div>
  );
}
