import { Modal, ActionButton } from "@/components/ui/dialog";
import { ActionForm, FormError, Hidden, SelectInput, SubmitButton, TextInput } from "@/components/ui/form";
import { confirmPaymentAction, voidInvoiceAction } from "../actions";

/** Manual payment confirmation by the platform operator (no payment gateway is connected). */
export function PaymentConfirm({ invoiceId, number }: { invoiceId: string; number: string }) {
  return (
    <span className="inline-flex gap-1.5">
      <Modal trigger="Confirm payment" title="Confirm received payment" description={number} triggerSize="sm" triggerVariant="primary">
        <ActionForm action={confirmPaymentAction} className="space-y-3">
          <Hidden name="invoiceId" value={invoiceId} />
          <SelectInput name="method" label="Method" defaultValue="BANK_TRANSFER" translateOptions options={[{ value: "BANK_TRANSFER", label: "Bank transfer" }, { value: "CASH", label: "Cash" }, { value: "OTHER", label: "Other" }]} />
          <TextInput name="reference" label="Bank statement / payment reference" required />
          <p className="text-[12px] text-ink-3">Confirm only after the funds are visible on the bank statement. The subscription period is activated from the invoice period.</p>
          <FormError />
          <div className="flex justify-end"><SubmitButton>Confirm payment</SubmitButton></div>
        </ActionForm>
      </Modal>
      <ActionButton action={voidInvoiceAction} fields={{ invoiceId }} variant="ghost" confirm="Void this invoice?">Void</ActionButton>
    </span>
  );
}
