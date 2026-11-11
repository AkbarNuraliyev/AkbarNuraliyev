import { requireApp } from "@/lib/auth";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui/basic";
import { ActionForm, FormError, SubmitButton, TextInput } from "@/components/ui/form";
import { SimpleTable } from "@/components/ui/table";
import { importOrdersAction } from "../actions";

export default async function ImportOrdersPage() {
  const ctx = await requireApp({ permission: "orders.operate" });
  const t = ctx.t;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: t("B2B Orders"), href: "/app/orders" }, { label: t("Import") }]} title={t("Import orders from a spreadsheet")} description={t("Upload CSV (UTF-8) or Excel (.xlsx). Rows with the same customer, delivery date and external reference become one order.")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("Upload file")} />
          <ActionForm action={importOrdersAction} className="space-y-4">
            <TextInput name="file" label="CSV or XLSX file" type="file" required />
            <FormError />
            <SubmitButton>Validate and import</SubmitButton>
          </ActionForm>
          <Alert tone="info" className="mt-4">{t("The import is all-or-nothing: if any row is invalid, no orders are created and the first error is shown.")}</Alert>
        </Card>
        <Card>
          <CardHeader title={t("File format")} actions={<a className="link text-[13px]" href="/api/templates/orders">{t("Download template")}</a>} />
          <SimpleTable head={[t("Column"), t("Required"), t("Example")]}>
            {[
              ["customer_code", "yes", "C007"],
              ["delivery_date", "yes", "2026-11-12"],
              ["sku", "yes", "CH-BRF"],
              ["quantity_kg", "yes", "120.5"],
              ["external_ref", "no", "PO-55120"],
              ["notes", "no", "Dock 3"],
            ].map((r) => (
              <tr key={r[0]}>
                <td className="td font-mono text-[12.5px]">{r[0]}</td>
                <td className="td">{t(r[1] === "yes" ? "Yes" : "No")}</td>
                <td className="td font-mono text-[12.5px]">{r[2]}</td>
              </tr>
            ))}
          </SimpleTable>
          <p className="mt-3 text-[12.5px] text-ink-3">{t("Large retail customers can also send orders automatically through the REST API (POST /api/v1/orders) — see Integrations → API.")}</p>
        </Card>
      </div>
    </>
  );
}
