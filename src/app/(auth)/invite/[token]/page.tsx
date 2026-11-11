import { getI18n } from "@/lib/i18n/server";
import { withSystem } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { ActionForm, FormError, Hidden, SubmitButton, TextInput } from "@/components/ui/form";
import { Alert } from "@/components/ui/basic";
import { acceptInviteAction } from "../../actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { t } = await getI18n();
  const invite = await withSystem((tx) =>
    tx.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { role: true, tenant: { select: { name: true, status: true } } } }),
  );
  const valid = invite && !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > new Date() && invite.tenant.status === "ACTIVE";
  const existing = valid ? await withSystem((tx) => tx.user.findUnique({ where: { email: invite!.email }, select: { id: true } })) : null;
  return (
    <div className="w-full max-w-[420px]">
      <div className="card p-6 sm:p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("Join a workspace")}</h1>
        {!valid ? (
          <Alert tone="warning" className="mt-4">{t("This invitation is invalid or has expired.")}</Alert>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-3">
              {t("You have been invited to {org} as {role}.", { org: invite!.tenant.name, role: t(invite!.role.name) })}
            </p>
            <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-ink-2">{invite!.email}</div>
            <ActionForm action={acceptInviteAction} className="mt-5 space-y-4">
              <Hidden name="token" value={token} />
              {existing ? (
                <TextInput name="password" label="Your existing password" type="password" required autoComplete="current-password" hint="An account with this email already exists." />
              ) : (
                <>
                  <TextInput name="name" label="Your full name" required autoComplete="name" />
                  <TextInput name="password" label="Choose a password" type="password" required autoComplete="new-password" hint="At least 8 characters with letters and digits." />
                </>
              )}
              <FormError />
              <SubmitButton className="w-full" size="lg">Accept invitation</SubmitButton>
            </ActionForm>
          </>
        )}
      </div>
    </div>
  );
}
