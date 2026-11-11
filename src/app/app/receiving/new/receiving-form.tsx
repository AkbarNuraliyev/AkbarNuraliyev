"use client";

import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { Scale, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { ActionForm, FormError, Hidden, NumberInput, SelectInput, SubmitButton, TextArea, TextInput, Field, useFormState } from "@/components/ui/form";
import { buttonClass, cx } from "@/components/ui/basic";
import { toast } from "@/components/ui/toast";
import { createReceiptAction, readScaleAction } from "../actions";

interface Props {
  suppliers: { id: string; code: string; name: string; price: number | null }[];
  farms: { id: string; supplierId: string; code: string; name: string }[];
  facilities: { id: string; name: string }[];
  checklist: { id: string; items: { id: string; label: string; kind: string; min?: number; max?: number; critical?: boolean }[] } | null;
  defaultReceivedAt: string;
  scaleDevices: string[];
  batchPreview: string;
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2.5 text-[15px] font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[12px] text-white">{n}</span>
        {t(title)}
      </h2>
      {children}
    </section>
  );
}

function ControlledNumber({ name, label, value, onChange, required, suffix, hint }: { name: string; label: string; value: string; onChange: (v: string) => void; required?: boolean; suffix?: string; hint?: string }) {
  const { state } = useFormState();
  const err = state?.errors?.[name];
  return (
    <Field label={label} name={name} required={required} hint={hint}>
      <div className="relative">
        <input id={`f-${name}`} name={name} type="number" inputMode="decimal" step="any" min={0} value={value} onChange={(e) => onChange(e.target.value)} className={cx("input", err && "input-error", suffix && "pr-12")} />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-ink-3">{suffix}</span>}
      </div>
    </Field>
  );
}

export function ReceivingForm(p: Props) {
  const t = useT();
  const [supplierId, setSupplierId] = useState("");
  const [farmId, setFarmId] = useState("");
  const [birdsReceived, setBirdsReceived] = useState("");
  const [doa, setDoa] = useState("0");
  const [rejected, setRejected] = useState("0");
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [source, setSource] = useState<"MANUAL" | "SCALE">("MANUAL");
  const [device, setDevice] = useState(p.scaleDevices[0] ?? "");
  const [decision, setDecision] = useState<"ACCEPTED" | "PARTIAL" | "REJECTED">("ACCEPTED");
  const [scaleState, scaleAction, scalePending] = useActionState(readScaleAction, null);

  useEffect(() => {
    if (!scaleState) return;
    if (scaleState.message) toast(scaleState.ok ? "success" : "error", scaleState.message);
    const d = scaleState.data as { weightKg: number } | undefined;
    if (scaleState.ok && d) {
      setGross(String(d.weightKg));
      setSource("SCALE");
    }
  }, [scaleState]);

  const farms = useMemo(() => p.farms.filter((f) => f.supplierId === supplierId), [p.farms, supplierId]);
  const supplier = p.suppliers.find((s) => s.id === supplierId);
  const farm = p.farms.find((f) => f.id === farmId);
  const n = (v: string) => (v === "" ? 0 : Number(v));
  const net = Math.max(0, n(gross) - n(tare));
  const recv = n(birdsReceived);
  const avg = recv ? net / recv : 0;
  const acceptedBirds = decision === "REJECTED" ? 0 : Math.max(0, recv - n(doa) - n(rejected));
  const acceptedKg = decision === "REJECTED" ? 0 : Math.max(0, net - avg * (n(doa) + n(rejected)));
  const avgWarn = recv > 0 && net > 0 && (avg < 0.6 || avg > 5);

  return (
    <ActionForm action={createReceiptAction} className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Section n={1} title="Supplier and farm">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput
              name="supplierId"
              label="Supplier"
              required
              placeholder=""
              options={p.suppliers.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
              onChange={(v) => {
                setSupplierId(v);
                setFarmId("");
              }}
            />
            <Field label="Farm" name="farmId" required>
              <select name="farmId" id="f-farmId" className="input" value={farmId} onChange={(e) => setFarmId(e.target.value)} disabled={!supplierId}>
                <option value="">{supplierId ? t("Select…") : t("Select a supplier first")}</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>{`${f.code} — ${f.name}`}</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section n={2} title="Delivery registration">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextInput name="receivedAt" label="Received at" type="datetime-local" required defaultValue={p.defaultReceivedAt} />
            <TextInput name="vehiclePlate" label="Vehicle plate" placeholder="10 A 123 AA" />
            <TextInput name="driverName" label="Driver" />
            {p.facilities.length > 1 && <SelectInput name="facilityId" label="Facility" options={p.facilities.map((f) => ({ value: f.id, label: f.name }))} defaultValue={p.facilities[0]?.id} />}
            <TextInput name="vetCertificateNo" label="Veterinary certificate no." />
            <NumberInput name="pricePerKg" label="Price per kg live" defaultValue={supplier?.price ?? undefined} suffix="UZS" key={supplierId} />
          </div>
        </Section>

        <Section n={3} title="Received quantity">
          <div className="grid gap-4 sm:grid-cols-4">
            <NumberInput name="birdsDeclared" label="Birds declared" required step={1} min={0} />
            <ControlledNumber name="birdsReceived" label="Birds received" required value={birdsReceived} onChange={setBirdsReceived} />
            <ControlledNumber name="birdsDeadOnArrival" label="Dead on arrival" value={doa} onChange={setDoa} />
            <ControlledNumber name="birdsRejected" label="Rejected birds" value={rejected} onChange={setRejected} />
          </div>
        </Section>

        <Section n={4} title="Weighing">
          <Hidden name="weighingSource" value={source} />
          <div className="grid gap-4 sm:grid-cols-3">
            <ControlledNumber name="grossWeightKg" label="Gross weight (vehicle + crates + birds)" required value={gross} onChange={(v) => { setGross(v); setSource("MANUAL"); }} suffix="kg" />
            <ControlledNumber name="tareWeightKg" label="Tare weight (vehicle + crates)" required value={tare} onChange={setTare} suffix="kg" />
            <NumberInput name="rejectedWeightKg" label="Rejected weight (optional)" suffix="kg" hint="Defaults to average weight × (DOA + rejected)." />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line bg-slate-50/60 p-3">
            <label className="block">
              <span className="label">{t("Scale device ID")}</span>
              <input name="scaleDeviceId" className="input h-9 w-48" value={device} onChange={(e) => setDevice(e.target.value)} placeholder="SCALE-RCV-1" list="scale-devices" />
              <datalist id="scale-devices">{p.scaleDevices.map((d) => <option key={d} value={d} />)}</datalist>
            </label>
            <button
              type="button"
              className={buttonClass("secondary", "md")}
              disabled={scalePending}
              onClick={() => {
                const fd = new FormData();
                fd.set("deviceId", device);
                startTransition(() => scaleAction(fd));
              }}
            >
              {scalePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
              {t("Read gross weight from scale")}
            </button>
            <span className="text-[12px] text-ink-3">{source === "SCALE" ? t("Weight captured from scale") : t("Manual entry")}</span>
          </div>
        </Section>

        <Section n={5} title="Quality inspection">
          <div className="grid gap-4 sm:grid-cols-4">
            <SelectInput name="qualityGrade" label="Quality grade" defaultValue="A" options={[{ value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }]} />
            <NumberInput name="bodyTempC" label="Body temperature" suffix="°C" />
            <NumberInput name="feedWithdrawalHours" label="Feed withdrawal" suffix="h" />
            <NumberInput name="bruisingPct" label="Bruising / damage" suffix="%" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="appearanceOk" defaultChecked className="h-4 w-4 accent-brand-600" /> {t("General appearance and plumage acceptable")}
          </label>
          {p.checklist && (
            <div className="mt-4 rounded-lg border border-line">
              <Hidden name="checklistId" value={p.checklist.id} />
              <div className="border-b border-line bg-slate-50 px-3 py-2 text-[13px] font-medium text-ink-2">{t("Receiving checklist (HACCP prerequisite)")}</div>
              <div className="divide-y divide-line">
                {p.checklist.items.map((it) => (
                  <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      {t(it.label)} {it.critical && <span className="text-[11px] font-semibold text-red-600">CCP</span>}
                    </span>
                    {it.kind === "bool" ? (
                      <span className="flex gap-3">
                        <label className="flex items-center gap-1"><input type="radio" name={`r_${it.id}`} value="yes" defaultChecked className="accent-brand-600" /> {t("Yes")}</label>
                        <label className="flex items-center gap-1"><input type="radio" name={`r_${it.id}`} value="no" className="accent-red-600" /> {t("No")}</label>
                      </span>
                    ) : (
                      <input name={`r_${it.id}`} type="number" step="any" className="input h-8 w-28" placeholder={it.min !== undefined || it.max !== undefined ? `${it.min ?? ""}…${it.max ?? ""}` : ""} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <TextArea name="inspectionNotes" label="Inspection notes" className="mt-4" />
        </Section>

        <Section n={6} title="Decision">
          <Hidden name="decision" value={decision} />
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["ACCEPTED", "Accept", "All live birds accepted (DOA deducted)", "border-brand-500 bg-brand-50"],
                ["PARTIAL", "Partially accept", "Some birds rejected; reason required", "border-amber-400 bg-amber-50"],
                ["REJECTED", "Reject delivery", "Entire load rejected; reason required", "border-red-400 bg-red-50"],
              ] as const
            ).map(([v, label, desc, active]) => (
              <button type="button" key={v} onClick={() => setDecision(v)} className={cx("rounded-lg border-2 p-3 text-left transition-colors", decision === v ? active : "border-line bg-white hover:bg-slate-50")}>
                <div className="text-sm font-semibold">{t(label)}</div>
                <div className="text-[12px] text-ink-3">{t(desc)}</div>
              </button>
            ))}
          </div>
          {decision !== "ACCEPTED" && <TextArea name="rejectionReason" label="Rejection reason" required className="mt-4" />}
        </Section>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <div className="card p-4 sm:p-5">
          <h3 className="text-[15px] font-semibold">{t("Summary")}</h3>
          <dl className="mt-3 space-y-2 text-sm">
            {[
              [t("Farm"), farm ? farm.code : "—"],
              [t("Net live weight"), net ? `${net.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} kg` : "—"],
              [t("Average bird weight"), avg ? `${avg.toFixed(3)} kg` : "—"],
              [t("Accepted birds"), recv ? acceptedBirds.toLocaleString("ru-RU") : "—"],
              [t("Accepted weight"), recv ? `${acceptedKg.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} kg` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-3">{k}</dt>
                <dd className="tabular font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {avgWarn && <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900">{t("Average live weight per bird looks implausible. Check weights and counts.")}</p>}
          <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-[12px] text-ink-3">
            {t("Batch ID will be generated on save, e.g.")} <span className="font-mono text-ink">{p.batchPreview.replace("{FARM}", farm?.code ?? "FARM")}</span>
          </div>
          <div className="mt-4 space-y-2">
            <FormError />
            <SubmitButton className="w-full" size="lg">{decision === "REJECTED" ? "Save rejection" : "Save and generate batch"}</SubmitButton>
          </div>
        </div>
      </aside>
    </ActionForm>
  );
}
