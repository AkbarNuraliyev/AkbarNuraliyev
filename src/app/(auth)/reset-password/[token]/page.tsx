import Link from "next/link";
import { getI18n } from "@/lib/i18n/server";
import { withSystem } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { ActionForm, FormError, Hidden, SubmitButton, TextInput } from "@/components/ui/form";
import { Alert } from "@/components/ui/basic";
import { resetPasswordAction } from "../../actions";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getI18n();
  const row = await withSystem((tx) => tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } }));
  const valid = row && !row.usedAt && row.expiresAt > new Date();
  return (
    <div className="w-full max-w-[400px]">
      <div className="card p-6 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("Set a new password")}</h1>
        {!valid ? (
          <>
            <Alert tone="warning" className="mt-4">{t("This reset link is invalid or has expired. Request a new one.")}</Alert>
            <p className="mt-4 text-center text-[13px]">
              <Link href="/forgot-password" className="link">{t("Request a new link")}</Link>
            </p>
          </>
        ) : (
          <ActionForm action={resetPasswordAction} className="mt-5 space-y-4">
            <Hidden name="token" value={token} />
            <TextInput name="password" label="New password" type="password" required autoComplete="new-password" hint="At least 8 characters with letters and digits." />
            <TextInput name="confirm" label="Confirm password" type="password" required autoComplete="new-password" />
            <FormError />
            <SubmitButton className="w-full" size="lg">Update password</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
