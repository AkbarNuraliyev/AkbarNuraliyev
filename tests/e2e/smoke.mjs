// End-to-end smoke test: signs in as different roles and visits every navigation
// route, failing on HTTP errors, React/Next runtime errors or console errors.
// Usage: BASE_URL=http://localhost:3000 node tests/e2e/smoke.mjs [--screens]
import fs from "node:fs";
import { createRequire } from "node:module";

// Playwright is pre-installed globally in CI/dev images; resolve it via CommonJS (NODE_PATH aware).
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SCREENS = process.argv.includes("--screens");
const ONLY = process.env.ONLY;
const PW = process.env.DEMO_PASSWORD || "Demo#2026!";
const outDir = "tests/e2e/screenshots";
if (SCREENS) fs.mkdirSync(outDir, { recursive: true });

const OWNER_ROUTES = [
  "/app", "/app?range=7d", "/app/onboarding", "/app/notifications",
  "/app/procurement", "/app/procurement/farms", "/app/procurement/performance",
  "/app/receiving", "/app/receiving/new",
  "/app/production", "/app/production/planning", "/app/production/lines",
  "/app/products", "/app/products/categories", "/app/products/labels",
  "/app/inventory", "/app/inventory?expiring=72", "/app/inventory/movements", "/app/inventory/transfers", "/app/inventory/stocktakes", "/app/inventory/warehouses", "/app/inventory/scan",
  "/app/orders", "/app/orders/new", "/app/orders/import",
  "/app/sales", "/app/sales/price-lists", "/app/sales/receivables", "/app/sales/returns",
  "/app/logistics", "/app/logistics/vehicles", "/app/logistics/drivers", "/app/logistics/routes", "/app/logistics/temperature", "/app/logistics/driver", "/app/logistics/new",
  "/app/retail", "/app/quality", "/app/quality/checklists", "/app/quality/nonconformities",
  "/app/traceability", "/app/reports", "/app/reports?tab=production", "/app/reports?tab=sales", "/app/reports?tab=quality",
  "/app/employees", "/app/employees/roles", "/app/employees/training",
  "/app/integrations", "/app/integrations/api", "/app/integrations/webhooks",
  "/app/settings", "/app/settings/subscription", "/app/settings/audit", "/app/settings/holidays",
];

// Detail pages discovered from list pages (first row link)
const DETAIL_FROM = [
  ["/app/procurement", "/app/procurement/suppliers/"],
  ["/app/procurement/farms", "/app/procurement/farms/"],
  ["/app/receiving", "/app/receiving/"],
  ["/app/production", "/app/production/shifts/"],
  ["/app/products", "/app/products/"],
  ["/app/orders?status=all", "/app/orders/"],
  ["/app/sales", "/app/sales/customers/"],
  ["/app/receiving", "/app/traceability/"],
  ["/app/logistics", "/app/logistics/shipments/"],
  ["/app/retail", "/app/retail/"],
  ["/app/quality/nonconformities", "/app/quality/nonconformities/"],
  ["/app/inventory/stocktakes", "/app/inventory/stocktakes/"],
];

const PUBLIC = ["/", "/pricing", "/roi", "/login", "/register", "/forgot-password"];

const problems = [];

async function check(page, url, label) {
  const errors = [];
  const onConsole = (m) => {
    if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) errors.push(m.text());
  };
  const onPageError = (e) => errors.push(String(e));
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 90000 });
    status = res?.status() ?? 0;
  } catch (e) {
    errors.push(`navigation: ${e.message}`);
  }
  const body = await page.innerText("body").catch(() => "");
  if (/Application error|Unhandled Runtime Error|Internal Server Error|This page could not be found|Something went wrong/i.test(body)) errors.push("error page rendered: " + body.slice(0, 160).replace(/\s+/g, " "));
  const ms = Date.now() - t0;
  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  const ok = status > 0 && status < 400 && errors.length === 0;
  console.log(`${ok ? "OK  " : "FAIL"} ${status} ${String(ms).padStart(5)}ms ${label} ${url}${errors.length ? "\n      " + errors.slice(0, 3).join("\n      ") : ""}`);
  if (!ok) problems.push({ label, url, status, errors });
  if (SCREENS && ok) {
    const name = `${label}-${url.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 120);
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: false });
  }
  return ok;
}

async function login(page, email) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', email.startsWith("admin@poultryos") ? process.env.ADMIN_PASSWORD || "Admin#2026!" : PW);
  await Promise.all([page.waitForURL(/\/(app|portal|admin)/, { timeout: 60000 }), page.click('button[type="submit"]')]);
}

const browser = await chromium.launch();
try {
  // Public pages
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const u of PUBLIC) await check(page, u, "public");
    await ctx.close();
  }
  // Owner — every module
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await login(page, "owner@safi-demo.uz");
    for (const u of OWNER_ROUTES) if (!ONLY || u.includes(ONLY)) await check(page, u, "owner");
    for (const [list, prefix] of DETAIL_FROM) {
      if (ONLY && !prefix.includes(ONLY)) continue;
      await page.goto(BASE + list, { waitUntil: "networkidle" });
      const href = await page.$$eval(`a[href^="${prefix}"]`, (as, pre) => as.map((a) => a.getAttribute("href")).find((h) => h && /^c[a-z0-9]{20,}$/.test(h.slice(pre.length))), prefix);
      if (href) await check(page, href, "owner-detail");
      else problems.push({ label: "owner-detail", url: `${list} → ${prefix}`, errors: ["no link found"] });
    }
    await ctx.close();
  }
  // Department-scoped employee: must be denied outside the Warehouse department
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "warehouse@safi-demo.uz");
    await check(page, "/app/inventory", "warehouse");
    await page.goto(BASE + "/app/production", { waitUntil: "networkidle" });
    if (!page.url().includes("/app/forbidden")) problems.push({ label: "rbac", url: "/app/production", errors: [`warehouse employee was not redirected (at ${page.url()})`] });
    else console.log("OK   rbac: warehouse employee denied /app/production");
    await ctx.close();
  }
  // Driver on a phone
  {
    const ctx = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await ctx.newPage();
    await login(page, "driver@safi-demo.uz");
    await check(page, "/app/logistics/driver", "driver-mobile");
    await ctx.close();
  }
  // Portal customer
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "buyer@baraka-demo.uz");
    for (const u of ["/portal", "/portal/catalog", "/portal/orders", "/portal/orders/new", "/portal/documents"]) await check(page, u, "portal");
    await page.goto(BASE + "/app", { waitUntil: "networkidle" });
    if (!page.url().includes("/portal")) problems.push({ label: "rbac", url: "/app", errors: ["portal user reached /app"] });
    else console.log("OK   rbac: portal user redirected away from /app");
    await ctx.close();
  }
  // Super admin
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "admin@poultryos.local");
    for (const u of ["/admin", "/admin/organizations", "/admin/plans", "/admin/billing", "/admin/activity", "/admin/emails"]) await check(page, u, "superadmin");
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${problems.length ? `${problems.length} problem(s)` : "All checks passed"}`);
process.exit(problems.length ? 1 : 0);
