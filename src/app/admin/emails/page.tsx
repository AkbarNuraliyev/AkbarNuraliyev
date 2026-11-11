import { requireSuperAdmin } from "@/lib/auth";
import { withSystem } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Alert, PageHeader } from "@/components/ui/basic";
import { StatusBadge } from "@/components/ui/status";
import { SimpleTable } from "@/components/ui/table";

/** Transactional e-mail log. One-time tokens in links are masked so operators cannot use them. */
export default async function AdminEmails() {
  const { t } = await requireSuperAdmin();
  const rows = await withSystem((tx) => tx.emailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 200 }));
  const mask = (s: string) => s.replace(/(\/(?:reset-password|invite)\/)[\w-]+/g, "$1••••••••");
  return (
    <>
      <PageHeader title={t("Email outbox")} description={t("Every transactional e-mail is logged. Without SMTP configuration messages are stored as NOT_SENT.")} />
      {!process.env.SMTP_HOST && <Alert tone="warning" className="mb-4">{t("SMTP is not configured (SMTP_HOST). E-mails are not delivered; invitation links are shown once to the inviting user instead.")}</Alert>}
      <SimpleTable head={[t("Time"), t("To"), t("Subject"), t("Status"), t("Body (tokens masked)")]}>
        {rows.map((r) => (
          <tr key={r.id} className="align-top">
            <td className="td whitespace-nowrap text-[12.5px]">{fmtDateTime(r.createdAt, "Asia/Tashkent")}</td>
            <td className="td text-[12.5px]">{r.to}</td>
            <td className="td text-[12.5px]">{r.subject}</td>
            <td className="td"><StatusBadge status={r.status} />{r.error && <div className="text-[11px] text-ink-3">{r.error}</div>}</td>
            <td className="td"><pre className="max-w-md whitespace-pre-wrap text-[11.5px] text-ink-2">{mask(r.body).slice(0, 400)}</pre></td>
          </tr>
        ))}
      </SimpleTable>
    </>
  );
}
