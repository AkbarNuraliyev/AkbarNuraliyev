/* eslint-disable no-console */
import { Prisma } from "@prisma/client";
import { withSystem, withTenant } from "@/lib/db";
import type { Tx } from "@/lib/prisma";
import { hashPassword } from "@/lib/crypto";
import { DEFAULT_SETTINGS, parseSettings } from "@/lib/settings";
import { addDaysKey, addHours, dateOnly, localDateKey, weekdayOfKey, zonedDateTime } from "@/lib/tz";
import { round } from "@/lib/format";
import type { ServiceCtx } from "@/server/core";
import { createWorkspace } from "@/server/services/tenants";
import { createReceipt } from "@/server/services/receiving";
import { addShiftInput, addShiftOutput, closeShift, createShift } from "@/server/services/production";
import { EPS, fefoCandidates, planFefo, transferStock, writeOff, createStocktake, saveStocktakeCounts, completeStocktake } from "@/server/services/inventory";
import { allocateOrder, completePicking, confirmOrder, createOrder, recordInvoicePayment, startPicking } from "@/server/services/orders";
import { confirmStop, createShipment, departShipment, recordTemperature } from "@/server/services/logistics";
import { recordReturn, recordSale } from "@/server/services/retail";
import { addCapa, completeCapa, createNonconformity, recordQuality, updateNonconformity } from "@/server/services/quality";
import { addRecallAction, closeRecall, initiateRecall } from "@/server/services/traceability";
import { savePlan } from "@/server/services/forecast";
import { runChecks } from "@/server/services/checks";
import { createLabels } from "@/server/services/labels";
import {
  CUSTOMERS, CUSTOMER_BASKETS, CUT_BONE_WASTE, CUT_MIX, FIRST, GIBLETS, LAST, PRICE_LIST_DISCOUNT, PRODUCTS, REGIONS, ROUTES, STORES,
  STORE_ASSORTMENT, SUPPLIERS, VEHICLES, WASTE, WHOLE_YIELD,
} from "./data";

const TZ = "Asia/Tashkent";
const DAYS = 35;
export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || "Demo#2026!";

// deterministic PRNG
let seedState = 20261111;
function rnd() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + (b - a) * rnd();
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const shuffle = <T,>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const phone = () => `+998 ${pick(["90", "91", "93", "94", "97", "99", "33", "88"])} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`;

const REAL_NOW = new Date();

interface DemoRefs {
  tenantId: string;
  users: Record<string, { id: string; name: string; email: string }>;
  products: Record<string, { id: string; storageType: string; net: number | null; variable: boolean; price: number }>;
  wh1: string;
  wh2: string;
  chamberC1: string;
  chamberC2: string;
  chamberF1: string;
  wh2Chilled: string;
  wh2Freezer: string;
  quarantine: string;
  lineL1: string;
  checklists: Record<string, string>;
  stores: { id: string; warehouseId: string; chilled: string; freezer: string; name: string }[];
  customers: { id: string; type: string; scale: number; route: string; region: string }[];
  vehicles: { id: string; type: string; cap: number; plate: string }[];
  drivers: string[];
  routes: Record<string, string>;
  batchFormat: string;
  batchPrefix: string;
}

let ctxBase: Omit<ServiceCtx, "now" | "userId" | "userName">;
let refs: DemoRefs;

async function at<T>(when: Date, actor: string, fn: (tx: Tx, ctx: ServiceCtx) => Promise<T>): Promise<T | undefined> {
  if (when.getTime() > REAL_NOW.getTime()) return undefined;
  const u = refs.users[actor];
  const ctx: ServiceCtx = { ...ctxBase, now: when, userId: u?.id, userName: u?.name, userEmail: u?.email };
  return withTenant(ctxBase, (tx) => fn(tx, ctx));
}

const T = (key: string, hhmm: string) => zonedDateTime(`${key}T${hhmm}`, TZ);

async function upsertUser(email: string, name: string, password: string, extra: Partial<{ isSuperAdmin: boolean; locale: string }> = {}) {
  const passwordHash = await hashPassword(password);
  return withSystem((tx) =>
    tx.user.upsert({
      where: { email },
      update: { name, passwordHash, isActive: true, failedLogins: 0, lockedUntil: null, ...extra },
      create: { email, name, passwordHash, ...extra },
    }),
  );
}

// ───────────────────────── master data ─────────────────────────

async function createMasterData(start: Date) {
  const owner = await upsertUser("owner@safi-demo.uz", "Akmal Safarov (demo owner)", DEMO_PASSWORD, { locale: "ru" });
  const ws = await withSystem((tx) =>
    createWorkspace(tx, {
      name: "SAFI Demo",
      legalName: "SAFI (Sifatli Tovuq) — demonstration workspace",
      taxId: "000000000",
      ownerUserId: owner.id,
      planCode: "ENTERPRISE",
      isDemo: true,
      batchPrefix: "SAFI",
      activeSubscription: true,
      billingCycle: "YEARLY",
      now: start,
      settings: { ...DEFAULT_SETTINGS, forecastWeeks: 4, publicPageMessage: "Demonstration data — PoultryOS SAFI Demo workspace." },
    }),
  );
  const tenantId = ws.tenant.id;
  ctxBase = { tenantId, tz: TZ, settings: parseSettings({ ...DEFAULT_SETTINGS, forecastWeeks: 4 }) };

  const staff = [
    { key: "admin", email: "admin@safi-demo.uz", name: "Dilnoza Karimova (demo admin)", role: "ADMIN", dept: null, title: "Operations director" },
    { key: "production", email: "production@safi-demo.uz", name: "Rustam Tursunov (demo)", role: "MANAGER", dept: "Production", title: "Production manager" },
    { key: "quality", email: "quality@safi-demo.uz", name: "Malika Yusupova (demo)", role: "MANAGER", dept: "Quality", title: "Quality & food safety manager" },
    { key: "warehouse", email: "warehouse@safi-demo.uz", name: "Jasur Aliyev (demo)", role: "EMPLOYEE", dept: "Warehouse", title: "Warehouse operator" },
    { key: "sales", email: "sales@safi-demo.uz", name: "Nigora Saidova (demo)", role: "MANAGER", dept: "Sales", title: "Key account manager" },
    { key: "driver", email: "driver@safi-demo.uz", name: "Bekzod Nazarov (demo)", role: "EMPLOYEE", dept: "Logistics", title: "Driver" },
    { key: "retail", email: "retail@safi-demo.uz", name: "Kamola Ergasheva (demo)", role: "MANAGER", dept: "Retail", title: "Retail network manager" },
    { key: "procurement", email: "procurement@safi-demo.uz", name: "Otabek Qodirov (demo)", role: "EMPLOYEE", dept: "Procurement", title: "Livestock buyer" },
  ];
  const users: DemoRefs["users"] = { owner: { id: owner.id, name: owner.name, email: owner.email } };
  for (const s of staff) {
    const u = await upsertUser(s.email, s.name, DEMO_PASSWORD);
    users[s.key] = { id: u.id, name: u.name, email: u.email };
    await withSystem((tx) =>
      tx.membership.create({ data: { tenantId, userId: u.id, roleId: ws.roles[s.role], departmentId: s.dept ? ws.departments[s.dept] : null, jobTitle: s.title } }),
    );
  }

  const out = await withTenant({ tenantId }, async (tx) => {
    await tx.facility.update({ where: { id: ws.facility.id }, data: { name: "SAFI processing plant, Tashkent region (demo)", address: "Zangiota district, Tashkent region" } });
    const l1 = await tx.productionLine.findFirstOrThrow({ where: { code: "L1" } });
    await tx.productionLine.create({ data: { tenantId, facilityId: ws.facility.id, code: "L2", name: "Further processing line", capacityKgPerHour: 600 } });
    await tx.warehouse.update({ where: { id: ws.warehouse.id }, data: { name: "Factory cold store (demo)" } });
    const c1 = await tx.storageChamber.findFirstOrThrow({ where: { code: "WH1-C1" } });
    const f1 = await tx.storageChamber.findFirstOrThrow({ where: { code: "WH1-F1" } });
    const q = await tx.storageChamber.findFirstOrThrow({ where: { code: "WH1-Q" } });
    const c2 = await tx.storageChamber.create({ data: { tenantId, warehouseId: ws.warehouse.id, code: "WH1-C2", name: "Chilled chamber 2 (dispatch)", type: "CHILLED", minTempC: 0, maxTempC: 4, capacityKg: 20000 } });
    const wh2 = await tx.warehouse.create({ data: { tenantId, code: "DC1", name: "Distribution center Chilonzor (demo)", type: "DISTRIBUTION", address: "Tashkent, Chilonzor industrial zone" } });
    const wh2c = await tx.storageChamber.create({ data: { tenantId, warehouseId: wh2.id, code: "DC1-C1", name: "DC chilled chamber", type: "CHILLED", minTempC: 0, maxTempC: 4, capacityKg: 15000 } });
    const wh2f = await tx.storageChamber.create({ data: { tenantId, warehouseId: wh2.id, code: "DC1-F1", name: "DC freezer", type: "FROZEN", maxTempC: -18, capacityKg: 80000 } });

    // suppliers & farms (20 suppliers, 52 farms)
    let farmN = 1;
    for (const s of SUPPLIERS) {
      const sup = await tx.supplier.create({
        data: {
          tenantId,
          code: s.code,
          name: s.name,
          type: s.type,
          region: s.region,
          taxId: String(300000000 + int(1000000, 9999999)),
          contactName: person(),
          phone: phone(),
          email: `${s.code.toLowerCase()}@supplier-demo.uz`,
          address: `${s.region}, demo address`,
          contractNumber: `PC-2026/${s.code}`,
          contractStart: new Date("2026-01-01T00:00:00Z"),
          contractEnd: new Date("2026-12-31T00:00:00Z"),
          paymentTermsDays: pick([3, 5, 7, 10]),
          pricePerKgLive: s.price,
          notes: "Demonstration supplier record.",
        },
      });
      for (let i = 0; i < s.farms; i++) {
        const code = `FARM${String(farmN).padStart(3, "0")}`;
        await tx.farm.create({
          data: {
            tenantId,
            supplierId: sup.id,
            code,
            name: `${s.name.replace(" (demo)", "").split(" ")[0]} farm ${i + 1} (demo)`,
            region: s.region,
            district: `${pick(["Northern", "Central", "Southern", "Eastern", "Western"])} district`,
            capacityBirds: int(20, 120) * 1000,
            breed: pick(["Ross 308", "Cobb 500", "Arbor Acres"]),
            vetRegistration: `VET-${s.region.slice(0, 3).toUpperCase()}-${int(1000, 9999)}`,
          },
        });
        farmN++;
      }
    }
    // a couple of extra independent farms to exceed 50 farms
    void REGIONS;

    // products
    const cats = await tx.productCategory.findMany();
    const products: DemoRefs["products"] = {};
    for (const p of PRODUCTS) {
      const cat = cats.find((c) => c.code === p.cat)!;
      const storage = p.storage ?? (p.cat === "FROZEN" ? "FROZEN" : "CHILLED");
      const created = await tx.product.create({
        data: {
          tenantId,
          sku: p.sku,
          name: p.name,
          categoryId: cat.id,
          description: p.desc ?? `${p.name}. Demonstration product.`,
          ingredients: p.ingredients ?? "100% chicken (Gallus gallus domesticus).",
          isVariableWeight: p.variable ?? true,
          netWeightKg: p.net ?? null,
          storageType: storage,
          storageTempMin: storage === "FROZEN" ? null : 0,
          storageTempMax: storage === "FROZEN" ? -18 : 4,
          storageInstructions: storage === "FROZEN" ? "Store at −18 °C or below. Do not refreeze after thawing." : "Store at 0…+4 °C.",
          shelfLifeHours: p.shelf,
          price: p.price,
          costPerKg: round(p.price * 0.72, 0),
          barcode: null,
          pluCode: p.plu,
          isByproduct: p.cat === "BYPRODUCT",
          targetYieldPct: p.yieldPct ?? null,
          minStockKg: p.min ?? null,
        },
      });
      products[p.sku] = { id: created.id, storageType: storage, net: p.net ?? null, variable: p.variable ?? true, price: p.price };
    }

    // price lists
    const base = await tx.priceList.findFirstOrThrow({ where: { name: "Base wholesale" } });
    const lists: Record<string, string> = { "Base wholesale": base.id };
    for (const name of ["HoReCa contract 2026", "Retail chains 2026", "Distributors 2026"]) {
      lists[name] = (await tx.priceList.create({ data: { tenantId, name } })).id;
    }
    for (const [name, id] of Object.entries(lists)) {
      const f = PRICE_LIST_DISCOUNT[name];
      await tx.priceListItem.createMany({
        data: PRODUCTS.map((p) => ({ tenantId, priceListId: id, productId: products[p.sku].id, price: round((p.price * f) / 100, 0) * 100 })),
      });
    }

    // customers
    const routeByRegion = (region: string) =>
      region === "Samarkand" || region === "Bukhara" ? "R-SAM" : region === "Fergana" || region === "Andijan" || region === "Namangan" ? "R-VAL" : region === "Tashkent region" ? "R-TSHR" : pick(["R-TSH-N", "R-TSH-S"]);
    const custRegions = ["Tashkent", "Tashkent", "Tashkent", "Samarkand", "Tashkent", "Tashkent", "Tashkent", "Tashkent", "Tashkent", "Samarkand", "Tashkent", "Tashkent region", "Fergana", "Samarkand", "Bukhara", "Fergana", "Andijan", "Tashkent", "Tashkent", "Tashkent", "Andijan"];
    const customers: DemoRefs["customers"] = [];
    for (let i = 0; i < CUSTOMERS.length; i++) {
      const c = CUSTOMERS[i];
      const region = custRegions[i];
      const cust = await tx.customer.create({
        data: {
          tenantId,
          code: c.code,
          name: c.name,
          type: c.type,
          taxId: String(200000000 + int(1000000, 9999999)),
          contactName: person(),
          phone: phone(),
          email: `orders@${c.code.toLowerCase()}-demo.uz`,
          address: `${region}, demo address ${int(1, 120)}`,
          deliveryAddress: `${region}, receiving dock ${int(1, 9)}`,
          region,
          creditLimit: Math.round(c.scale * 150) * 1_000_000,
          paymentTermsDays: c.type === "HORECA" ? 7 : c.type === "RETAIL_CHAIN" ? 21 : c.type === "DISTRIBUTOR" ? 14 : 3,
          priceListId: lists[c.pl],
        },
      });
      customers.push({ id: cust.id, type: c.type, scale: c.scale, route: routeByRegion(region), region });
    }

    // routes, vehicles, drivers
    const routes: Record<string, string> = {};
    for (const r of ROUTES) routes[r.code] = (await tx.deliveryRoute.create({ data: { tenantId, code: r.code, name: r.name, regions: r.regions, estimatedDurationMin: r.min } })).id;
    const vehicles: DemoRefs["vehicles"] = [];
    for (const v of VEHICLES) {
      const veh = await tx.vehicle.create({
        data: {
          tenantId,
          plate: v.plate,
          model: v.model,
          type: v.type,
          capacityKg: v.cap,
          tempMinC: v.type === "FREEZER" ? null : 0,
          tempMaxC: v.type === "FREEZER" ? -18 : 4,
          telematicsProvider: v.dev ? "wialon" : null,
          telematicsDeviceId: v.dev,
        },
      });
      vehicles.push({ id: veh.id, type: v.type, cap: v.cap, plate: v.plate });
    }
    const drivers: string[] = [];
    for (let i = 0; i < 8; i++) {
      const d = await tx.driver.create({
        data: {
          tenantId,
          name: i === 0 ? users.driver.name : `${person()} (demo)`,
          phone: phone(),
          licenseNumber: `AF ${int(1000000, 9999999)}`,
          licenseExpiry: i === 5 ? addHours(REAL_NOW, 24 * 20) : new Date(`202${int(7, 9)}-0${int(1, 9)}-15T00:00:00Z`),
          userId: i === 0 ? users.driver.id : null,
        },
      });
      drivers.push(d.id);
    }

    // retail stores (each with its own warehouse + chambers)
    const stores: DemoRefs["stores"] = [];
    for (const s of STORES) {
      const w = await tx.warehouse.create({ data: { tenantId, code: `WH-${s.code}`, name: `${s.name} — store stock`, type: "RETAIL", address: s.address } });
      const ch = await tx.storageChamber.create({ data: { tenantId, warehouseId: w.id, code: `${s.code}-C`, name: "Chilled display", type: "CHILLED", minTempC: 0, maxTempC: 4, capacityKg: 800 } });
      const fr = await tx.storageChamber.create({ data: { tenantId, warehouseId: w.id, code: `${s.code}-F`, name: "Freezer cabinet", type: "FROZEN", maxTempC: -18, capacityKg: 500 } });
      const loc = await tx.retailLocation.create({
        data: { tenantId, code: s.code, name: s.name, brand: "SAFI Fresh (demo)", address: s.address, region: s.region, phone: phone(), managerName: person(), warehouseId: w.id, posProvider: "billz" },
      });
      stores.push({ id: loc.id, warehouseId: w.id, chilled: ch.id, freezer: fr.id, name: s.name });
    }

    const checklists: Record<string, string> = {};
    for (const c of await tx.qualityChecklist.findMany()) checklists[c.type + (c.name.includes("Metal") ? "-METAL" : "")] = c.id;

    // training records
    const courses = await tx.trainingCourse.findMany();
    for (const u of Object.values(users)) {
      for (const c of courses.slice(0, int(2, 4))) {
        const completed = addHours(start, -24 * int(30, 330));
        await tx.trainingRecord.create({
          data: {
            tenantId,
            courseId: c.id,
            userId: u.id,
            employeeName: u.name,
            completedAt: completed,
            expiresAt: c.validityMonths ? addHours(completed, 24 * 30 * c.validityMonths) : null,
            score: int(72, 100),
            trainer: "External trainer (demo)",
          },
        });
      }
    }
    for (let i = 0; i < 12; i++) {
      const c = pick(courses);
      const completed = addHours(start, -24 * int(30, 400));
      await tx.trainingRecord.create({
        data: { tenantId, courseId: c.id, employeeName: `${person()} (line operator, demo)`, completedAt: completed, expiresAt: c.validityMonths ? addHours(completed, 24 * 30 * c.validityMonths) : null, score: int(65, 98), trainer: "Malika Yusupova (demo)" },
      });
    }

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return {
      wh1: ws.warehouse.id,
      wh2: wh2.id,
      chamberC1: c1.id,
      chamberC2: c2.id,
      chamberF1: f1.id,
      wh2Chilled: wh2c.id,
      wh2Freezer: wh2f.id,
      quarantine: q.id,
      lineL1: l1.id,
      products,
      customers,
      routes,
      vehicles,
      drivers,
      stores,
      checklists,
      batchFormat: tenant.batchFormat,
      batchPrefix: tenant.batchPrefix,
    };
  });

  // B2B portal user for one retail chain
  const portalUser = await upsertUser("buyer@baraka-demo.uz", "Sherzod Mirzayev (Baraka buyer, demo)", DEMO_PASSWORD);
  await withSystem((tx) =>
    tx.membership.create({ data: { tenantId, userId: portalUser.id, roleId: ws.roles.CUSTOMER, customerId: out.customers[6].id, jobTitle: "Category buyer" } }),
  );
  users.portal = { id: portalUser.id, name: portalUser.name, email: portalUser.email };

  refs = { tenantId, users, ...out };
}

// ───────────────────────── simulation ─────────────────────────

const shareBySku: Record<string, number> = {};
function computeShares() {
  const wholeShare = 0.3;
  shareBySku["CH-WHOLE"] = wholeShare * 0.85 * WHOLE_YIELD;
  shareBySku["FR-WHOLE"] = wholeShare * 0.15 * WHOLE_YIELD;
  for (const m of CUT_MIX) {
    const fz = m.frozenPct ?? 0;
    shareBySku[m.sku] = (shareBySku[m.sku] ?? 0) + (1 - wholeShare) * m.share * (1 - fz);
    if (m.frozenSku) shareBySku[m.frozenSku] = (shareBySku[m.frozenSku] ?? 0) + (1 - wholeShare) * m.share * fz;
  }
  for (const g of GIBLETS) shareBySku[g.sku] = g.share;
}

function packUnits(sku: string, kg: number) {
  const p = refs.products[sku];
  if (!p.variable && p.net) return { kg: Math.max(p.net, Math.round(kg / p.net) * p.net), units: Math.max(1, Math.round(kg / p.net)) };
  return { kg: round(kg, 2), units: Math.max(1, Math.round(kg / between(0.9, 1.6))) };
}

async function simulateReceipts(key: string, count: number) {
  const farms = await withTenant(ctxBase, (tx) => tx.farm.findMany({ include: { supplier: true } }));
  const batches: string[] = [];
  const slots = ["04:40", "05:20", "06:00", "06:40", "07:20", "08:00"];
  for (let i = 0; i < count; i++) {
    const farm = pick(farms);
    const when = T(key, slots[i]);
    const birds = int(1850, 2450);
    const avg = between(2.3, 2.62);
    const net = birds * avg;
    const tare = int(900, 1400);
    const roll = rnd();
    const doa = int(0, Math.round(birds * 0.004));
    let decision: "ACCEPTED" | "PARTIAL" | "REJECTED" = "ACCEPTED";
    let rejected = 0;
    let reason: string | null = null;
    if (roll < 0.012) {
      decision = "REJECTED";
      reason = "Veterinary certificate missing; elevated mortality in crates";
    } else if (roll < 0.09) {
      decision = "PARTIAL";
      rejected = int(25, 120);
      reason = pick(["Bruising and wing fractures above limit", "Underweight birds (< 1.8 kg) separated", "Wet/soiled plumage on part of the load"]);
    }
    const r = await at(when, "procurement", async (tx, ctx) => {
      const res = await createReceipt(
        tx,
        ctx,
        {
          supplierId: farm.supplierId,
          farmId: farm.id,
          receivedAt: when,
          vehiclePlate: `${pick(["10", "20", "30", "40", "50", "60", "70", "80"])} ${pick(["A", "B", "C", "D"])} ${int(100, 999)} ${pick(["AA", "BA", "CA", "DA"])}`,
          driverName: person(),
          birdsDeclared: birds + int(0, 10),
          birdsReceived: birds,
          birdsDeadOnArrival: doa,
          birdsRejected: decision === "REJECTED" ? 0 : rejected,
          grossWeightKg: round(net + tare, 1),
          tareWeightKg: tare,
          weighingSource: "MANUAL",
          qualityGrade: decision === "ACCEPTED" ? pick(["A", "A", "A", "B"]) : "B",
          bodyTempC: round(between(40.2, 41.8), 1),
          vetCertificateNo: decision === "REJECTED" ? null : `VC-${int(100000, 999999)}`,
          feedWithdrawalHours: round(between(8, 11.5), 1),
          appearanceOk: decision !== "REJECTED",
          bruisingPct: round(between(0.2, decision === "PARTIAL" ? 4.5 : 1.8), 1),
          decision,
          rejectionReason: reason,
          inspectionNotes: null,
        },
        { batchFormat: refs.batchFormat, batchPrefix: refs.batchPrefix },
      );
      await recordQuality(tx, { ...ctx, userId: refs.users.quality.id, userName: refs.users.quality.name }, {
        checklistId: refs.checklists.RECEIVING,
        area: "Live bird receiving",
        entityType: "raw_material_receipt",
        entityId: res.receipt.id,
        batchId: res.batch.id,
        responses: {
          vet: decision === "REJECTED" ? "no" : "yes",
          withdrawal: "yes",
          doa: doa / birds < 0.005 ? "yes" : "no",
          cleanliness: rnd() < 0.97 ? "yes" : "no",
          bodytemp: String(round(between(40.2, 41.8), 1)),
        },
      });
      return res;
    });
    if (r && decision !== "REJECTED") batches.push(r.batch.id);
  }
  return batches;
}

async function simulateShift(key: string, type: "DAY" | "EVENING", batchIds: string[], start: string, end: string, flawed: boolean) {
  if (!batchIds.length) return;
  const startAt = T(key, start);
  const endAt = T(key, end);
  const shift = await at(startAt, "production", async (tx, ctx) => {
    const live = await tx.productionBatch.findMany({ where: { id: { in: batchIds } } });
    const planned = live.reduce((s, b) => s + b.liveWeightKg, 0);
    return createShift(tx, ctx, {
      lineId: refs.lineL1,
      shiftDate: key,
      shiftType: type,
      supervisorName: type === "DAY" ? refs.users.production.name : "Laziz Rahimov (demo)",
      plannedInputKg: round(planned * between(0.97, 1.05), 0),
      plannedBirds: live.reduce((s, b) => s + b.birds, 0),
    });
  });
  if (!shift) return;
  const span = endAt.getTime() - startAt.getTime();
  for (let bi = 0; bi < batchIds.length; bi++) {
    const batchId = batchIds[bi];
    const tIn = new Date(startAt.getTime() + (span * bi) / batchIds.length + 10 * 60000);
    const tOut = new Date(startAt.getTime() + (span * (bi + 0.85)) / batchIds.length);
    const ok = await at(tIn, "production", async (tx, ctx) => {
      const b = await tx.productionBatch.findUniqueOrThrow({ where: { id: batchId } });
      await addShiftInput(tx, ctx, { shiftId: shift.id, batchId, birdsProcessed: b.birds - b.processedBirds, inputWeightKg: round(b.liveWeightKg - b.processedKg, 1) });
      return b;
    });
    if (!ok) continue;
    await at(tOut, "production", async (tx, ctx) => {
      const L = ok.liveWeightKg - ok.processedKg;
      const wholeShare = between(0.26, 0.34);
      const noise = () => between(0.97, 1.03);
      const outs: { sku?: string; waste?: string; kg: number; type: "PRODUCT" | "BYPRODUCT" | "WASTE" }[] = [];
      const whole = L * wholeShare * WHOLE_YIELD * noise();
      outs.push({ sku: "CH-WHOLE", kg: whole * 0.85, type: "PRODUCT" });
      outs.push({ sku: "FR-WHOLE", kg: whole * 0.15, type: "PRODUCT" });
      const Lc = L * (1 - wholeShare);
      for (const m of CUT_MIX) {
        const kg = Lc * m.share * noise();
        const fz = m.frozenPct ?? 0;
        const isBy = m.sku.startsWith("BP-");
        outs.push({ sku: m.sku, kg: kg * (1 - fz), type: isBy ? "BYPRODUCT" : "PRODUCT" });
        if (m.frozenSku && fz) outs.push({ sku: m.frozenSku, kg: kg * fz, type: "PRODUCT" });
      }
      outs.push({ waste: "Other waste", kg: Lc * CUT_BONE_WASTE * noise(), type: "WASTE" });
      for (const g of GIBLETS) outs.push({ sku: g.sku, kg: L * g.share * noise(), type: "BYPRODUCT" });
      for (const w of WASTE) if (!(flawed && w.cat === "Inedible offal")) outs.push({ waste: w.cat, kg: L * w.share * noise(), type: "WASTE" });
      // keep the simulated mass balance physically plausible (1–2.5% moisture/unrecorded loss)
      const total = outs.reduce((s, o) => s + o.kg, 0);
      const targetTotal = L * (flawed ? between(0.9, 0.93) : between(0.975, 0.99));
      const scale = Math.min(1, targetTotal / total);
      for (const o of outs) o.kg *= scale;
      for (const o of outs) {
        if (o.kg < 0.5) continue;
        if (o.sku) {
          const p = refs.products[o.sku];
          const frozen = p.storageType === "FROZEN";
          const packed = packUnits(o.sku, o.kg);
          await addShiftOutput(tx, ctx, {
            shiftId: shift.id,
            batchId,
            outputType: o.type,
            productId: p.id,
            weightKg: packed.kg,
            units: packed.units,
            warehouseId: refs.wh1,
            chamberId: frozen ? refs.chamberF1 : rnd() < 0.6 ? refs.chamberC1 : refs.chamberC2,
          });
        } else {
          await addShiftOutput(tx, ctx, { shiftId: shift.id, batchId, outputType: "WASTE", wasteCategory: o.waste, weightKg: round(o.kg, 1) });
        }
      }
    });
  }
  // quality checks during the shift
  const mid = new Date(startAt.getTime() + span / 2);
  await at(mid, "quality", async (tx, ctx) => {
    const fail = rnd() < 0.02;
    await recordQuality(tx, ctx, {
      checklistId: refs.checklists.HACCP,
      area: `Chiller exit, line L1 (${type})`,
      entityType: "production_shift",
      entityId: shift.id,
      batchId: batchIds[0],
      responses: { core: String(fail ? round(between(4.4, 5.2), 1) : round(between(1.6, 3.8), 1)), chillerwater: String(round(between(0.8, 2.5), 1)), chlorine: "yes" },
      notes: fail ? "Chiller water flow reduced; carcasses re-chilled." : null,
    });
    await recordQuality(tx, ctx, {
      checklistId: refs.checklists["HACCP-METAL"],
      area: "Metal detector MD-1 (packing)",
      entityType: "production_shift",
      entityId: shift.id,
      responses: { fe: "yes", nfe: "yes", ss: "yes" },
    });
    await recordQuality(tx, ctx, {
      checklistId: refs.checklists.PRODUCTION,
      area: "Packing hall",
      entityType: "production_shift",
      entityId: shift.id,
      batchId: batchIds[batchIds.length - 1],
      responses: { appearance: "yes", label: rnd() < 0.985 ? "yes" : "no", seal: "yes", weight: String(round(between(-1.2, 1.4), 1)) },
    });
  });
  await at(endAt, "production", (tx, ctx) => closeShift(tx, ctx, shift.id));
}

async function simulateOrders(key: string) {
  const deliveryKey = addDaysKey(key, 1);
  const wd = weekdayOfKey(deliveryKey);
  const dayFactor = [0.55, 0.9, 1.0, 1.0, 1.05, 1.15, 1.2][wd];
  const target = 13000 * dayFactor * between(0.95, 1.05);
  const expectedLive = 25500;
  const lines: { customer: DemoRefs["customers"][number]; sku: string; w: number }[] = [];
  const orderingCustomers = refs.customers.filter(() => rnd() < (wd === 0 ? 0.35 : 0.82));
  for (const c of orderingCustomers) {
    const basket = shuffle([...CUSTOMER_BASKETS[c.type]]).slice(0, int(3, 6));
    for (const sku of basket) lines.push({ customer: c, sku, w: c.scale * (shareBySku[sku] ?? 0.01) * between(0.7, 1.3) });
  }
  const totalW = lines.reduce((s, l) => s + l.w, 0) || 1;
  const qty = new Map<(typeof lines)[number], number>();
  for (const l of lines) qty.set(l, (target * l.w) / totalW);
  // cap demand per product at ~78% of expected production
  const bySku = new Map<string, number>();
  for (const l of lines) bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + qty.get(l)!);
  for (const [sku, total] of bySku) {
    const cap = expectedLive * (shareBySku[sku] ?? 0.01) * 0.86;
    if (total > cap) for (const l of lines.filter((x) => x.sku === sku)) qty.set(l, (qty.get(l)! * cap) / total);
  }
  let i = 0;
  for (const c of orderingCustomers) {
    const myLines = lines.filter((l) => l.customer === c);
    if (!myLines.length) continue;
    const when = T(key, `${String(9 + Math.floor((i * 8) / orderingCustomers.length)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}`);
    i++;
    const items = myLines
      .map((l) => {
        const p = refs.products[l.sku];
        let q = qty.get(l)!;
        q = p.net ? Math.max(p.net * 10, Math.round(q / p.net) * p.net) : Math.max(5, Math.round(q * 2) / 2);
        return { productId: p.id, quantityKg: round(q, 3) };
      })
      .filter((x) => x.quantityKg > 0);
    const r = rnd();
    const source = r < 0.25 ? "PORTAL" : r < 0.4 ? "IMPORT" : "MANUAL";
    await at(when, source === "PORTAL" && c.id === refs.customers[6].id ? "portal" : "sales", (tx, ctx) =>
      createOrder(tx, ctx, { customerId: c.id, requestedDeliveryDate: deliveryKey, source, items, externalRef: source === "IMPORT" ? `EDI-${int(10000, 99999)}` : null }),
    );
  }
  // confirm in the evening; allocate after the evening shift
  await at(T(key, "18:00"), "sales", async (tx, ctx) => {
    const orders = await tx.order.findMany({ where: { status: "NEW", requestedDeliveryDate: dateOnly(deliveryKey) } });
    for (const o of orders) if (rnd() < 0.985) await confirmOrder(tx, ctx, o.id);
  });
  await at(T(key, "22:30"), "warehouse", async (tx, ctx) => {
    const orders = await tx.order.findMany({ where: { status: { in: ["CONFIRMED", "ALLOCATED"] }, requestedDeliveryDate: { lte: dateOnly(deliveryKey) } }, orderBy: { createdAt: "asc" } });
    for (const o of orders) await allocateOrder(tx, ctx, o.id);
  });
}

async function simulateDispatch(key: string) {
  // picking for orders due today (5% held back → delivered late next day)
  await at(T(key, "04:30"), "warehouse", async (tx, ctx) => {
    const orders = await tx.order.findMany({ where: { status: "ALLOCATED", requestedDeliveryDate: { lte: dateOnly(key) } }, include: { items: true } });
    for (const o of orders) {
      if (o.requestedDeliveryDate.toISOString().slice(0, 10) === key && rnd() < 0.05) continue;
      if (o.items.every((i) => i.allocatedKg <= EPS)) continue;
      await startPicking(tx, ctx, o.id);
      const allocs = await tx.orderAllocation.findMany({ where: { orderItem: { orderId: o.id }, status: "RESERVED" } });
      const picked: Record<string, number> = {};
      for (const a of allocs) picked[a.id] = round(a.quantityKg * between(0.985, 1), 3);
      await completePicking(tx, ctx, o.id, picked);
    }
  });
  // shipments by route
  const plan = await at(T(key, "05:15"), "admin", async (tx, ctx) => {
    const ready = await tx.order.findMany({ where: { status: "READY_FOR_DISPATCH" }, include: { items: true, customer: true } });
    const byRoute = new Map<string, typeof ready>();
    for (const o of ready) {
      const c = refs.customers.find((x) => x.id === o.customerId)!;
      byRoute.set(c.route, [...(byRoute.get(c.route) ?? []), o]);
    }
    // reefers first (largest first), freezers as overflow; each truck may run two trips a day
    const fleet = [...refs.vehicles.filter((v) => v.type === "REFRIGERATED").sort((a, b) => b.cap - a.cap), ...refs.vehicles.filter((v) => v.type === "FREEZER")];
    let vi = 0;
    const shipments: string[] = [];
    let di = 0;
    for (const [route, orders] of byRoute) {
      const queue = [...orders].sort((a, b) => b.items.reduce((s, i) => s + i.pickedKg, 0) - a.items.reduce((s, i) => s + i.pickedKg, 0));
      let misses = 0;
      while (queue.length && misses < fleet.length) {
        const veh = fleet[vi++ % fleet.length];
        const cap = veh.cap * 0.97;
        const batch: typeof ready = [];
        let w = 0;
        for (let i = 0; i < queue.length; ) {
          const ow = queue[i].items.reduce((s, it) => s + it.pickedKg, 0);
          if (w + ow <= cap) {
            batch.push(queue[i]);
            w += ow;
            queue.splice(i, 1);
          } else i++;
        }
        if (!batch.length) {
          misses++; // order larger than this truck — try the next one
          continue;
        }
        misses = 0;
        const sh = await createShipment(tx, ctx, {
          vehicleId: veh.id,
          driverId: refs.drivers[di++ % refs.drivers.length],
          routeId: refs.routes[route],
          plannedDeparture: T(key, "06:00"),
          temperatureMode: "CHILLED",
          orderIds: batch.map((o) => o.id),
        });
        shipments.push(sh.id);
      }
    }
    return shipments;
  });
  if (!plan) return;
  for (const shId of plan) {
    const depart = T(key, `06:${String(int(0, 40)).padStart(2, "0")}`);
    const ok = await at(depart, "driver", async (tx, ctx) => {
      await departShipment(tx, ctx, shId);
      return tx.shipment.findUniqueOrThrow({ where: { id: shId }, include: { stops: { orderBy: { sequence: "asc" } }, vehicle: true } });
    });
    if (!ok) continue;
    let tcur = depart.getTime();
    for (let si = 0; si < ok.stops.length; si++) {
      const stop = ok.stops[si];
      const arrive = new Date(tcur + int(35, 75) * 60000);
      // temperature readings during the leg (demo telemetry)
      for (let tt = tcur + 30 * 60000; tt < arrive.getTime(); tt += 45 * 60000) {
        await at(new Date(tt), "driver", (tx, ctx) =>
          recordTemperature(tx, ctx, {
            sourceType: "VEHICLE",
            shipmentId: shId,
            temperatureC: ok.temperatureMode === "FROZEN" ? round(between(-21, -18.4), 1) : rnd() < 0.012 ? round(between(4.4, 6.8), 1) : round(between(1.2, 3.8), 1),
            recordedAt: new Date(tt),
            dataSource: "DEMO",
            deviceId: ok.vehicle.telematicsDeviceId,
          }),
        );
      }
      await at(arrive, "driver", async (tx, ctx) => {
        const items = await tx.orderItem.findMany({ where: { orderId: stop.orderId } });
        const delivered: Record<string, number> = {};
        const short = rnd() < 0.04;
        for (const it of items) delivered[it.id] = short && it === items[0] ? round(it.pickedKg * 0.9, 3) : it.pickedKg;
        await confirmStop(tx, ctx, { shipmentId: shId, orderId: stop.orderId, receivedBy: person(), delivered, notes: short ? "Part of the first line rejected at receiving (packaging damage)" : null });
      });
      tcur = arrive.getTime() + 15 * 60000;
    }
  }
}

async function simulateReplenishment(key: string) {
  for (const s of refs.stores) {
    await at(T(key, "06:45"), "warehouse", async (tx, ctx) => {
      const lines: { inventoryId: string; quantityKg: number }[] = [];
      for (const sku of shuffle([...STORE_ASSORTMENT]).slice(0, int(9, 13))) {
        const p = refs.products[sku];
        const cands = await fefoCandidates(tx, { productId: p.id, mustBeValidUntil: addHours(ctx.now!, 30), warehouseIds: [refs.wh1] });
        const { picks } = planFefo(cands, round(between(12, 38) * (sku === "CH-WHOLE" ? 1.8 : 1), 1));
        for (const pk of picks) lines.push({ inventoryId: pk.inventoryId, quantityKg: pk.quantityKg });
      }
      if (lines.length) await transferStock(tx, ctx, { toWarehouseId: s.warehouseId, toChamberId: s.chilled, lines, notes: "Daily store replenishment (demo)" });
    });
  }
}

async function simulateRetail(key: string, includeTemps: boolean) {
  for (const s of refs.stores) {
    for (const [hhmm, share] of [["11:00", 0.32], ["15:00", 0.38], ["20:00", 0.42]] as const) {
      await at(T(key, hhmm), "retail", async (tx, ctx) => {
        const stock = await tx.inventory.groupBy({ by: ["productId"], where: { warehouseId: s.warehouseId, status: "AVAILABLE", quantityKg: { gt: EPS }, expiryDate: { gt: ctx.now! } }, _sum: { quantityKg: true } });
        const cashier = pick(["Cashier 1", "Cashier 2", "Cashier 3"]);
        for (const st of stock) {
          const q = round((st._sum.quantityKg ?? 0) * share * between(0.7, 1.15), 2);
          if (q < 0.3) continue;
          await recordSale(tx, ctx, { retailLocationId: s.id, productId: st.productId, quantityKg: Math.min(q, round(st._sum.quantityKg ?? 0, 3)), cashierName: cashier, receiptNo: `Z-${key.replaceAll("-", "")}-${hhmm.replace(":", "")}`, soldAt: ctx.now, source: "MANUAL" });
        }
      });
    }
    if (includeTemps) {
      for (const hhmm of ["02:00", "08:00", "14:00", "20:00"]) {
        await at(T(key, hhmm), "retail", async (tx, ctx) => {
          await recordTemperature(tx, ctx, { sourceType: "CHAMBER", chamberId: s.chilled, temperatureC: rnd() < 0.008 ? round(between(4.3, 6.1), 1) : round(between(1.4, 3.7), 1), recordedAt: ctx.now!, dataSource: "DEMO" });
          await recordTemperature(tx, ctx, { sourceType: "CHAMBER", chamberId: s.freezer, temperatureC: round(between(-21.5, -18.3), 1), recordedAt: ctx.now!, dataSource: "DEMO" });
        });
      }
    }
  }
  if (rnd() < 0.35) {
    const s = pick(refs.stores);
    await at(T(key, "19:30"), "retail", async (tx, ctx) => {
      const sale = await tx.sale.findFirst({ where: { retailLocationId: s.id, type: "SALE" }, orderBy: { soldAt: "desc" } });
      if (sale) await recordReturn(tx, ctx, { source: "RETAIL", retailLocationId: s.id, productId: sale.productId, batchId: sale.batchId, quantityKg: Math.floor(Math.min(1.5, sale.quantityKg) * 100) / 100, reason: pick(["Customer complaint: off odour", "Damaged packaging", "Wrong product weighed"]), action: "WRITE_OFF" });
    });
  }
}

async function simulateTemps(key: string) {
  const chambers = [
    { id: refs.chamberC1, kind: "C" },
    { id: refs.chamberC2, kind: "C" },
    { id: refs.chamberF1, kind: "F" },
    { id: refs.quarantine, kind: "C" },
    { id: refs.wh2Chilled, kind: "C" },
    { id: refs.wh2Freezer, kind: "F" },
  ];
  for (const hhmm of ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]) {
    await at(T(key, hhmm), "warehouse", async (tx, ctx) => {
      for (const c of chambers) {
        const v = c.kind === "F" ? (rnd() < 0.006 ? round(between(-17.6, -15.5), 1) : round(between(-21.5, -18.4), 1)) : rnd() < 0.006 ? round(between(4.2, 6.4), 1) : round(between(0.9, 3.6), 1);
        await recordTemperature(tx, ctx, { sourceType: "CHAMBER", chamberId: c.id, temperatureC: v, recordedAt: ctx.now!, dataSource: "DEMO" });
      }
    });
  }
}

async function simulateHousekeeping(key: string, dayIndex: number) {
  // nightly expiry write-off
  await at(T(key, "23:30"), "warehouse", async (tx, ctx) => {
    const expired = await tx.inventory.findMany({ where: { quantityKg: { gt: EPS }, expiryDate: { lte: ctx.now! }, reservedKg: { lte: EPS } } });
    for (const l of expired) await writeOff(tx, ctx, { inventoryId: l.id, quantityKg: l.quantityKg, type: "EXPIRED", reason: "Shelf life exceeded (nightly FEFO check)" });
  });
  // move older frozen stock from factory freezer to the distribution center every 3 days
  if (dayIndex % 3 === 1) {
    await at(T(key, "10:00"), "warehouse", async (tx, ctx) => {
      const lots = await tx.inventory.findMany({ where: { warehouseId: refs.wh1, chamberId: refs.chamberF1, status: "AVAILABLE", quantityKg: { gt: 5 }, createdAt: { lte: addHours(ctx.now!, -48) } } });
      const lines = lots.map((l) => ({ inventoryId: l.id, quantityKg: round(l.quantityKg - l.reservedKg, 3) })).filter((l) => l.quantityKg > 1);
      if (lines.length) await transferStock(tx, ctx, { toWarehouseId: refs.wh2, toChamberId: refs.wh2Freezer, lines, notes: "Frozen stock to distribution center (demo)" });
    });
  }
  // sanitation and storage checks
  await at(T(key, "05:30"), "quality", async (tx, ctx) => {
    await recordQuality(tx, ctx, { checklistId: refs.checklists.SANITATION, area: "Slaughter & cut-up hall", responses: { surfaces: "yes", atp: String(int(40, rnd() < 0.03 ? 210 : 140)), drains: "yes", handwash: "yes" } });
    await recordQuality(tx, ctx, { checklistId: refs.checklists.TEMPERATURE, area: "Chilled chamber 1", entityType: "storage_chamber", entityId: refs.chamberC1, responses: { temp: String(round(between(1.5, 3.4), 1)), door: "yes" } });
  });
  // invoice payments
  await at(T(key, "17:00"), "admin", async (tx, ctx) => {
    const open = await tx.salesInvoice.findMany({ where: { status: { in: ["UNPAID", "PARTIAL"] } } });
    for (const inv of open) {
      const due = inv.dueAt <= ctx.now!;
      const p = due ? 0.55 : 0.04;
      if (rnd() < p) {
        const outstanding = Number(inv.amount) - Number(inv.paidAmount);
        const amount = rnd() < 0.85 ? outstanding : round(outstanding * 0.5, 0);
        if (amount > 0) await recordInvoicePayment(tx, ctx, { invoiceId: inv.id, amount: round(amount, 2), paidAt: ctx.now!, method: "BANK_TRANSFER", reference: `PP-${int(100000, 999999)}` });
      }
    }
  });
}

async function simulateB2BReturn(key: string) {
  await at(T(key, "16:00"), "sales", async (tx, ctx) => {
    const order = await tx.order.findFirst({
      where: { status: "DELIVERED", deliveredAt: { gte: addHours(ctx.now!, -30) } },
      include: { items: { include: { allocations: { where: { status: "SHIPPED" } } } } },
    });
    const item = order?.items.find((i) => i.allocations.length);
    if (!order || !item) return;
    const a = item.allocations[0];
    await recordReturn(tx, ctx, {
      source: "B2B",
      customerId: order.customerId,
      orderId: order.id,
      productId: item.productId,
      batchId: a.batchId,
      quantityKg: Math.floor(Math.min(a.quantityKg, between(3, 12)) * 100) / 100,
      reason: pick(["Temperature on arrival +6 °C (customer measurement)", "Packaging leaking", "Short shelf life on arrival"]),
      action: "WRITE_OFF",
    });
  });
}

export async function seedDemo() {
  computeShares();
  const todayKey = localDateKey(REAL_NOW, TZ);
  const startKey = addDaysKey(todayKey, -DAYS);
  console.log(`Seeding SAFI Demo: ${startKey} … ${todayKey}`);
  await withSystem(async (tx) => {
    const old = await tx.tenant.findMany({ where: { slug: { startsWith: "safi-demo" }, isDemo: true } });
    for (const o of old) await tx.tenant.delete({ where: { id: o.id } });
  });
  await createMasterData(T(startKey, "00:00"));
  const t0 = Date.now();
  for (let d = 0; d <= DAYS; d++) {
    const key = addDaysKey(startKey, d);
    const wd = weekdayOfKey(key);
    await simulateTemps(key);
    await simulateDispatch(key);
    const receipts = await simulateReceipts(key, wd === 0 ? 4 : 5);
    await simulateReplenishment(key);
    const flawed = rnd() < 0.06;
    await simulateShift(key, "DAY", receipts.slice(0, 3), "06:00", "14:00", flawed);
    await simulateShift(key, "EVENING", receipts.slice(3), "14:30", "22:00", false);
    await simulateRetail(key, d >= DAYS - 14);
    await simulateOrders(key);
    if (rnd() < 0.3) await simulateB2BReturn(key);
    await simulateHousekeeping(key, d);
    if (d >= DAYS - 14) {
      await at(T(addDaysKey(key, -1), "20:00"), "production", (tx, ctx) => savePlan(tx, ctx, key, {}, true));
    }
    process.stdout.write(`  day ${d + 1}/${DAYS + 1} (${key}) ${Math.round((Date.now() - t0) / 1000)}s\n`);
  }
  await finalTouches(todayKey);
  return refs;
}

async function finalTouches(todayKey: string) {
  const now = new Date(Math.min(REAL_NOW.getTime(), T(todayKey, "23:00").getTime()));
  // plan for tomorrow (draft, editable)
  await at(now, "production", (tx, ctx) => savePlan(tx, ctx, addDaysKey(todayKey, 1), {}, false));

  // customer complaint → non-conformity → recall (closed) on a batch from ~12 days ago
  const recallDay = addDaysKey(todayKey, -12);
  await at(T(recallDay, "15:00"), "quality", async (tx, ctx) => {
    const batch = await tx.productionBatch.findFirst({ where: { createdAt: { gte: T(addDaysKey(recallDay, -2), "00:00"), lt: T(addDaysKey(recallDay, -1), "00:00") }, status: { in: ["COMPLETED", "IN_PRODUCTION"] } } });
    if (!batch) return;
    const customer = refs.customers[1];
    const nc = await createNonconformity(tx, ctx, {
      title: "Customer complaint: foreign body (plastic fragment) in breast fillet",
      description: `Silk Road Catering reported a blue plastic fragment in a breast fillet tray from batch ${batch.code}.`,
      severity: "CRITICAL",
      source: "CUSTOMER_COMPLAINT",
      batchId: batch.id,
      customerId: customer.id,
      responsibleName: refs.users.quality.name,
      dueDate: T(addDaysKey(recallDay, 5), "18:00"),
    });
    const recall = await initiateRecall(tx, ctx, { batchId: batch.id, reason: "Precautionary recall — potential foreign body (plastic) contamination reported by customer." });
    await addRecallAction(tx, ctx, { recallId: recall.id, actionType: "NOTIFY_CUSTOMER", description: "All customers who received the batch were notified by phone and e-mail (demo)." });
    await addRecallAction(tx, ctx, { recallId: recall.id, actionType: "RETRIEVE", description: "Remaining product retrieved from customers and stores and quarantined (demo)." });
    await addRecallAction(tx, ctx, { recallId: recall.id, actionType: "DESTROY", description: "Retrieved product destroyed via licensed rendering contractor (demo)." });
    await addCapa(tx, ctx, { nonconformityId: nc.id, type: "CORRECTIVE", description: "Replaced cracked blue crate lids on line L1; inspected all crates.", responsibleName: refs.users.production.name });
    await addCapa(tx, ctx, { nonconformityId: nc.id, type: "PREVENTIVE", description: "Added daily crate integrity check to pre-op sanitation checklist.", responsibleName: refs.users.quality.name });
    const actions = await tx.capaAction.findMany({ where: { nonconformityId: nc.id } });
    for (const a of actions) await completeCapa(tx, ctx, a.id);
    await updateNonconformity(tx, ctx, { id: nc.id, status: "CLOSED", rootCause: "Cracked plastic crate lid fragment entered the deboning area." });
    await closeRecall(tx, ctx, { recallId: recall.id, summary: "All affected stock blocked, retrieved and destroyed; no consumer injuries reported (demo)." });
  });

  // supplier non-conformity (open)
  await at(T(addDaysKey(todayKey, -3), "10:00"), "quality", async (tx, ctx) => {
    const rec = await tx.rawMaterialReceipt.findFirst({ where: { status: { in: ["PARTIAL", "REJECTED"] } }, orderBy: { receivedAt: "desc" }, include: { batch: true, supplier: true } });
    if (!rec) return;
    const nc = await createNonconformity(tx, ctx, {
      title: `Supplier quality deviation: ${rec.supplier.name}`,
      description: `Delivery ${rec.number}: ${rec.rejectionReason}`,
      severity: "MAJOR",
      source: "SUPPLIER",
      batchId: rec.batch?.id ?? null,
      responsibleName: refs.users.procurement.name,
      dueDate: T(addDaysKey(todayKey, 7), "18:00"),
    });
    await addCapa(tx, ctx, { nonconformityId: nc.id, type: "CORRECTIVE", description: "Supplier audit scheduled; catching-crew training requested.", responsibleName: refs.users.procurement.name, dueDate: T(addDaysKey(todayKey, 5), "18:00") });
  });

  // stocktake (completed) a week ago in the distribution center
  await at(T(addDaysKey(todayKey, -7), "21:00"), "warehouse", async (tx, ctx) => {
    const st = await createStocktake(tx, ctx, { warehouseId: refs.wh2, notes: "Weekly freezer count (demo)" });
    const lines = await tx.stocktakeLine.findMany({ where: { stocktakeId: st.id } });
    const counts: Record<string, number> = {};
    for (const l of lines) counts[l.id] = round(l.systemKg * (rnd() < 0.15 ? between(0.985, 1.005) : 1), 3);
    await saveStocktakeCounts(tx, ctx, st.id, counts);
    await completeStocktake(tx, ctx, st.id);
  });

  // labels for a few current lots
  await at(now, "warehouse", async (tx, ctx) => {
    const lots = await tx.inventory.findMany({ where: { warehouseId: refs.wh1, status: "AVAILABLE", quantityKg: { gt: 30 }, product: { isVariableWeight: true, storageType: "CHILLED" } }, orderBy: { createdAt: "desc" }, take: 3 });
    const tpl = await tx.labelTemplate.findFirst({ where: { isDefault: true } });
    for (const l of lots) await createLabels(tx, ctx, { inventoryId: l.id, templateId: tpl?.id, weights: Array.from({ length: 8 }, () => round(between(0.85, 1.6), 3)) });
  });

  // a public certificate document record (metadata only; demo)
  await withTenant(ctxBase, async (tx) => {
    await tx.document.create({
      data: {
        tenantId: refs.tenantId,
        type: "CERTIFICATE",
        title: "Halal certificate (demo placeholder)",
        fileName: "halal-certificate-demo.txt",
        mimeType: "text/plain",
        sizeBytes: 64,
        storageKey: "demo/halal-certificate-demo.txt",
        isPublic: true,
        entityType: "tenant",
        entityId: refs.tenantId,
      },
    });
  });

  await at(now, "admin", (tx, ctx) => runChecks(tx, ctx));
  await withTenant(ctxBase, (tx) => tx.auditLog.create({ data: { tenantId: refs.tenantId, action: "demo.seeded", entityType: "tenant", entityId: refs.tenantId, summary: "SAFI Demo data generated by seed simulation (all records are demonstration data)", changes: Prisma.JsonNull } }));
}
