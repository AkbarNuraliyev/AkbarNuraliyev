import { getSession } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { signOutAction } from "@/app/actions";

export default async function Suspended() {
  const { t } = await getI18n();
  const s = await getSession();
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="card max-w-md p-7 text-center">
        <h1 className="text-lg font-semibold">{t("This organization is suspended")}</h1>
        <p className="mt-2 text-sm text-ink-3">
          {t("Access to {org} has been suspended by the platform operator. Data is retained. Contact support to restore access.", { org: s?.tenant?.name ?? "—" })}
        </p>
        <form action={signOutAction} className="mt-5">
          <button className="text-sm font-medium text-navy-700 hover:underline">{t("Sign out")}</button>
        </form>
      </div>
    </div>
  );
}
