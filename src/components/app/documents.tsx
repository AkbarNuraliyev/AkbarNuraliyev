import { FileText, Paperclip } from "lucide-react";
import type { AppCtx } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { Card, CardHeader, Pill } from "@/components/ui/basic";
import { Modal, ActionButton } from "@/components/ui/dialog";
import { ActionForm, Checkbox, FormError, Hidden, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { deleteDocumentAction, uploadDocumentAction } from "@/app/app/documents/actions";

const TYPES = ["CONTRACT", "CERTIFICATE", "PHOTO", "INVOICE", "DELIVERY_NOTE", "REPORT", "IMAGE", "OTHER"];

export async function DocumentsPanel({
  ctx,
  entityType,
  entityId,
  canUpload,
  title = "Documents & attachments",
  defaultType = "OTHER",
  allowPublic = false,
}: {
  ctx: AppCtx;
  entityType: string;
  entityId: string;
  canUpload: boolean;
  title?: string;
  defaultType?: string;
  allowPublic?: boolean;
}) {
  const docs = await withTenant(ctx, (tx) => tx.document.findMany({ where: { entityType, entityId }, orderBy: { createdAt: "desc" } }));
  return (
    <Card>
      <CardHeader
        title={ctx.t(title)}
        description={ctx.t("PDF, PNG, JPEG or WEBP up to 5 MB. Files are stored privately for your organization.")}
        actions={
          canUpload ? (
            <Modal trigger={<><Paperclip className="h-4 w-4" />{ctx.t("Attach file")}</>} title="Attach file" triggerSize="sm">
              <ActionForm action={uploadDocumentAction} className="space-y-4">
                <Hidden name="entityType" value={entityType} />
                <Hidden name="entityId" value={entityId} />
                <TextInput name="title" label="Title" required />
                <SelectInput name="type" label="Document type" defaultValue={defaultType} options={TYPES.map((x) => ({ value: x, label: x.replaceAll("_", " ").toLowerCase() }))} translateOptions />
                <TextInput name="file" label="File" type="file" required />
                {allowPublic && <Checkbox name="isPublic" label="Show on the public QR traceability page (certificates only)" />}
                <FormError />
                <div className="flex justify-end">
                  <SubmitButton>Upload</SubmitButton>
                </div>
              </ActionForm>
            </Modal>
          ) : null
        }
      />
      {docs.length === 0 ? (
        <p className="text-[13px] text-ink-3">{ctx.t("No files attached.")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <FileText className="h-4 w-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="link block truncate text-sm">{d.title}</a>
                <div className="text-[12px] text-ink-3">
                  {d.type.toLowerCase()} · {d.fileName} · {Math.round(d.sizeBytes / 1024)} KB · {fmtDateTime(d.createdAt, ctx.tz)}
                </div>
              </div>
              {d.isPublic && <Pill tone="green">{ctx.t("Public")}</Pill>}
              {canUpload && (
                <ActionButton action={deleteDocumentAction} fields={{ id: d.id }} variant="ghost" confirm="Delete this file?" confirmText="The file will be removed permanently.">
                  Delete
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
