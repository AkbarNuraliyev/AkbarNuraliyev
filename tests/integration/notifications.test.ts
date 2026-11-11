import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@/lib/db";
import { makeT } from "@/lib/i18n";
import { ru } from "@/lib/i18n/ru";
import { uz } from "@/lib/i18n/uz";
import { notificationParams } from "@/lib/notifications";
import { notify } from "@/server/core";
import { makeTenant, type TestTenant } from "./helpers";

let T: TestTenant;

beforeAll(async () => {
  T = await makeTenant("Alerts Co");
});

describe("translatable notifications", () => {
  it("stores the English template with params and renders it in the viewer's language", async () => {
    const row = await withTenant(T.ctx, async (tx) => {
      await notify(tx, T.ctx, {
        type: "LOW_STOCK",
        title: "Low stock: {product}",
        message: "Free stock {free} is below the minimum of {min}.",
        params: { product: "Fillet", free: "5,0 kg", min: "20,0 kg" },
      });
      return tx.notification.findFirstOrThrow({ where: { type: "LOW_STOCK" } });
    });
    expect(row.title).toBe("Low stock: {product}");
    const params = notificationParams(row.params);
    expect(makeT("en")(row.title, params)).toBe("Low stock: Fillet");
    expect(makeT("ru")(row.title, params)).toBe("Мало на складе: Fillet");
    expect(makeT("ru")(row.message, params)).toBe("Свободный остаток 5,0 kg ниже минимума 20,0 kg.");
  });

  it("has Russian and Uzbek translations for every alert template in the services", () => {
    const dir = path.join(process.cwd(), "src/server/services");
    const templates = new Set<string>();
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const call of src.split("notify(tx, ctx, {").slice(1)) {
        const body = call.slice(0, call.indexOf("});"));
        for (const m of body.matchAll(/(?:title|message):[^\n]*?"([^"]*\{[^"]*)"/g)) templates.add(m[1]);
      }
      for (const m of src.matchAll(/^\s+(?:MANUAL|DEVICE|DEMO): "([^"]+)",$/gm)) templates.add(m[1]);
    }
    expect(templates.size).toBeGreaterThan(15);
    const missing = [...templates].filter((k) => !ru[k] || !uz[k]);
    expect(missing).toEqual([]);
  });
});
