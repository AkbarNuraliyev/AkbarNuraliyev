"use client";

import { useState } from "react";
import { Field } from "@/components/ui/form";
import { useT } from "@/lib/i18n/client";

/** One select for "warehouse / chamber" that posts toWarehouseId and toChamberId. */
export function DestinationSelect({ options }: { options: { value: string; label: string }[] }) {
  const t = useT();
  const [v, setV] = useState(options[0]?.value ?? "");
  const [wh, ch] = v.split("|");
  return (
    <Field label="Destination" name="toWarehouseId" required>
      <select className="input" value={v} onChange={(e) => setV(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <input type="hidden" name="toWarehouseId" value={wh ?? ""} />
      <input type="hidden" name="toChamberId" value={ch ?? ""} />
      {!options.length && <p className="text-[12px] text-ink-3">{t("No compatible chambers")}</p>}
    </Field>
  );
}
