import Link from "@/components/ui/link";
import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { ActionForm, FormError, SubmitButton, TextInput } from "@/components/ui/form";
import { forgotPasswordAction } from "../actions";

export const metadata: Metadata = { title: "Reset password" };

export default async function ForgotPage() {
  const { t } = await getI18n();
  return (
    <div className="w-full max-w-[400px]">
      <div className="card p-6 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("Reset your password")}</h1>
        <p className="mt-1 text-sm text-ink-3">{t("Enter your account email. We will send a one-time link that is valid for 60 minutes.")}</p>
        <ActionForm action={forgotPasswordAction} className="mt-5 space-y-4" resetOnSuccess>
          <TextInput name="email" label="Email" type="email" required autoComplete="email" />
          <FormError />
          <SubmitButton className="w-full" size="lg">Send reset link</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-[12px] text-ink-3">
          {t("E-mail delivery requires SMTP to be configured by the platform operator. Without SMTP, the message is stored in the platform outbox and not delivered.")}
        </p>
        <p className="mt-3 text-center text-[13px]">
          <Link href="/login" className="link">{t("Back to sign in")}</Link>
        </p>
      </div>
    </div>
  );
}
