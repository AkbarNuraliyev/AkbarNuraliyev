import type { Tx } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ROLE_TEMPLATES, DEFAULT_DEPARTMENTS } from "@/lib/roles";
import { allPermissionKeys, EXTRA_PERMISSIONS, MODULES, PERMISSION_DESCRIPTIONS } from "@/lib/modules";
import { INTEGRATION_PROVIDERS } from "@/lib/integrations-catalog";
import { DEFAULT_SETTINGS, type TenantSettings } from "@/lib/settings";
import { AppError } from "@/lib/errors";
import { addDays } from "@/lib/tz";

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40) || "org"
  );
}

/** Ensure the global permission catalogue exists (idempotent). */
export async function syncPermissions(tx: Tx) {
  const keys = allPermissionKeys();
  for (const key of keys) {
    const [module, action] = key.split(".");
    const extra = EXTRA_PERMISSIONS.find((e) => e.key === key);
    const desc =
      extra?.description ??
      `${MODULES.find((m) => m.key === module)?.label ?? module}: ${PERMISSION_DESCRIPTIONS[action as "view"] ?? action}`;
    await tx.permission.upsert({ where: { key }, update: { module, action, description: desc }, create: { key, module, action, description: desc } });
  }
}

export const DEFAULT_CATEGORIES = [
  { code: "CHILLED", name: "Chilled poultry", storageType: "CHILLED", defaultShelfLifeHours: 72, sortOrder: 1 },
  { code: "FROZEN", name: "Frozen poultry", storageType: "FROZEN", defaultShelfLifeHours: 180 * 24, sortOrder: 2 },
  { code: "SEMI", name: "Semi-finished products", storageType: "CHILLED", defaultShelfLifeHours: 120, sortOrder: 3 },
  { code: "RTC", name: "Ready-to-cook products", storageType: "CHILLED", defaultShelfLifeHours: 96, sortOrder: 4 },
  { code: "PROCESSED", name: "Processed products", storageType: "CHILLED", defaultShelfLifeHours: 240, sortOrder: 5 },
  { code: "BYPRODUCT", name: "By-products & offal", storageType: "CHILLED", defaultShelfLifeHours: 48, sortOrder: 6 },
] as const;

export const DEFAULT_CHECKLISTS = [
  {
    name: "Live bird receiving inspection",
    type: "RECEIVING",
    description: "Performed on every delivery before acceptance (HACCP prerequisite programme).",
    items: [
      { id: "vet", label: "Veterinary certificate present and valid", kind: "bool", critical: true },
      { id: "withdrawal", label: "Feed withdrawal 8–12 h confirmed", kind: "bool", critical: false },
      { id: "doa", label: "Dead-on-arrival rate below 0.5%", kind: "bool", critical: false },
      { id: "cleanliness", label: "Crates and vehicle clean", kind: "bool", critical: false },
      { id: "bodytemp", label: "Body temperature (°C)", kind: "number", min: 39, max: 42.5, critical: false },
    ],
  },
  {
    name: "CCP-1 Carcass chilling temperature",
    type: "HACCP",
    description: "Critical control point: carcass core temperature after chilling must be ≤ +4 °C.",
    items: [
      { id: "core", label: "Carcass core temperature (°C)", kind: "number", max: 4, critical: true },
      { id: "chillerwater", label: "Chiller water temperature (°C)", kind: "number", max: 4, critical: false },
      { id: "chlorine", label: "Chlorine concentration within limits", kind: "bool", critical: false },
    ],
  },
  {
    name: "CCP-2 Metal detection",
    type: "HACCP",
    description: "Metal detector verification with test pieces (Fe, non-Fe, SS).",
    items: [
      { id: "fe", label: "Fe 2.0 mm test piece rejected", kind: "bool", critical: true },
      { id: "nfe", label: "Non-Fe 2.5 mm test piece rejected", kind: "bool", critical: true },
      { id: "ss", label: "SS 3.0 mm test piece rejected", kind: "bool", critical: true },
    ],
  },
  {
    name: "Pre-operational sanitation",
    type: "SANITATION",
    description: "Sanitation standard operating procedure check before shift start.",
    items: [
      { id: "surfaces", label: "Food-contact surfaces visually clean", kind: "bool", critical: true },
      { id: "atp", label: "ATP swab result (RLU)", kind: "number", max: 150, critical: false },
      { id: "drains", label: "Drains clean and covered", kind: "bool", critical: false },
      { id: "handwash", label: "Hand-wash stations stocked", kind: "bool", critical: false },
    ],
  },
  {
    name: "Storage temperature check",
    type: "TEMPERATURE",
    description: "Manual verification of chamber thermometers twice per shift.",
    items: [
      { id: "temp", label: "Chamber temperature (°C)", kind: "number", critical: true },
      { id: "door", label: "Door seals intact, no ice build-up", kind: "bool", critical: false },
    ],
  },
  {
    name: "Finished product inspection",
    type: "PRODUCTION",
    description: "Organoleptic and labelling check of packed product.",
    items: [
      { id: "appearance", label: "Colour, odour and texture acceptable", kind: "bool", critical: true },
      { id: "label", label: "Label data correct (batch, dates, weight)", kind: "bool", critical: true },
      { id: "seal", label: "Pack seal integrity", kind: "bool", critical: false },
      { id: "weight", label: "Net weight deviation (%)", kind: "number", min: -2, max: 2, critical: false },
    ],
  },
] as const;

export const UZ_HOLIDAYS_2026 = [
  { date: "2026-01-01", name: "New Year", demandFactor: 1.3 },
  { date: "2026-03-08", name: "International Women's Day", demandFactor: 1.2 },
  { date: "2026-03-20", name: "Ramadan Hayit (Eid al-Fitr)", demandFactor: 1.4 },
  { date: "2026-03-21", name: "Navruz", demandFactor: 1.4 },
  { date: "2026-05-09", name: "Day of Remembrance and Honour", demandFactor: 1.1 },
  { date: "2026-05-27", name: "Qurbon Hayit (Eid al-Adha)", demandFactor: 1.3 },
  { date: "2026-09-01", name: "Independence Day", demandFactor: 1.2 },
  { date: "2026-10-01", name: "Teachers' Day", demandFactor: 1.05 },
  { date: "2026-12-08", name: "Constitution Day", demandFactor: 1.1 },
  { date: "2026-12-31", name: "New Year's Eve", demandFactor: 1.5 },
  { date: "2027-01-01", name: "New Year", demandFactor: 1.3 },
];

export interface CreateWorkspaceInput {
  name: string;
  legalName?: string | null;
  taxId?: string | null;
  phone?: string | null;
  ownerUserId: string;
  planCode: string;
  isDemo?: boolean;
  locale?: string;
  batchPrefix?: string;
  settings?: Partial<TenantSettings>;
  now?: Date;
  billingCycle?: "MONTHLY" | "YEARLY";
  activeSubscription?: boolean;
}

/** Creates an isolated workspace with default roles, departments and configuration. Runs in system context. */
export async function createWorkspace(tx: Tx, input: CreateWorkspaceInput) {
  const now = input.now ?? new Date();
  const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
  if (!plan || !plan.isActive) throw new AppError("Selected plan is not available");

  let slug = slugify(input.name);
  for (let i = 2; await tx.tenant.findUnique({ where: { slug }, select: { id: true } }); i++) slug = `${slugify(input.name)}-${i}`;

  const prefix = (input.batchPrefix || input.name.replace(/[^A-Za-z]/g, "").slice(0, 4) || "LOT").toUpperCase();

  const tenant = await tx.tenant.create({
    data: {
      name: input.name,
      slug,
      legalName: input.legalName ?? null,
      taxId: input.taxId ?? null,
      phone: input.phone ?? null,
      isDemo: input.isDemo ?? false,
      locale: input.locale ?? "ru",
      batchPrefix: prefix,
      settings: { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) } as unknown as Prisma.InputJsonValue,
      createdAt: now,
    },
  });
  const tenantId = tenant.id;

  const trialEnds = addDays(now, plan.trialDays);
  const periodEnd = input.billingCycle === "YEARLY" ? addDays(now, 365) : addDays(now, 30);
  await tx.subscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: input.activeSubscription ? "ACTIVE" : "TRIALING",
      billingCycle: input.billingCycle ?? "MONTHLY",
      trialEndsAt: input.activeSubscription ? null : trialEnds,
      currentPeriodStart: now,
      currentPeriodEnd: input.activeSubscription ? periodEnd : trialEnds,
    },
  });

  const roles: Record<string, string> = {};
  for (const tpl of ROLE_TEMPLATES) {
    const role = await tx.role.create({
      data: {
        tenantId,
        key: tpl.key,
        name: tpl.name,
        description: tpl.description,
        isSystem: true,
        departmentScoped: tpl.departmentScoped,
        isPortal: tpl.isPortal,
      },
    });
    roles[tpl.key] = role.id;
    if (tpl.permissions.length) {
      await tx.rolePermission.createMany({
        data: tpl.permissions.map((p) => ({ tenantId, roleId: role.id, permissionKey: p })),
      });
    }
  }

  const departments: Record<string, string> = {};
  for (const d of DEFAULT_DEPARTMENTS) {
    const dep = await tx.department.create({ data: { tenantId, name: d.name, modules: d.modules } });
    departments[d.name] = dep.id;
  }

  await tx.membership.create({
    data: { tenantId, userId: input.ownerUserId, roleId: roles.OWNER, jobTitle: "Owner" },
  });

  const facility = await tx.facility.create({ data: { tenantId, code: "PLANT1", name: "Main processing plant" } });
  await tx.productionLine.create({ data: { tenantId, facilityId: facility.id, code: "L1", name: "Slaughter & cut-up line 1", capacityKgPerHour: 2000 } });
  const wh = await tx.warehouse.create({
    data: { tenantId, facilityId: facility.id, code: "WH1", name: "Factory cold store", type: "FACTORY" },
  });
  const s = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
  await tx.storageChamber.createMany({
    data: [
      { tenantId, warehouseId: wh.id, code: "WH1-C1", name: "Chilled chamber 1", type: "CHILLED", minTempC: s.chilledMinTempC, maxTempC: s.chilledMaxTempC, capacityKg: 30000 },
      { tenantId, warehouseId: wh.id, code: "WH1-F1", name: "Freezer 1", type: "FROZEN", maxTempC: s.frozenMaxTempC, capacityKg: 60000 },
      { tenantId, warehouseId: wh.id, code: "WH1-Q", name: "Quarantine", type: "QUARANTINE", minTempC: s.chilledMinTempC, maxTempC: s.chilledMaxTempC, capacityKg: 5000 },
    ],
  });

  for (const c of DEFAULT_CATEGORIES) {
    await tx.productCategory.create({ data: { tenantId, ...c, storageType: c.storageType } });
  }

  await tx.labelTemplate.createMany({
    data: [
      { tenantId, name: "Retail tray label 58×40", widthMm: 58, heightMm: 40, layout: "COMPACT", isDefault: true },
      { tenantId, name: "Carton label 100×70", widthMm: 100, heightMm: 70, layout: "STANDARD" },
      { tenantId, name: "Pallet / crate label 100×150", widthMm: 100, heightMm: 150, layout: "LARGE", showPrice: false },
    ],
  });

  for (const c of DEFAULT_CHECKLISTS) {
    await tx.qualityChecklist.create({
      data: { tenantId, name: c.name, type: c.type, description: c.description, items: c.items as unknown as Prisma.InputJsonValue },
    });
  }

  await tx.integration.createMany({
    data: INTEGRATION_PROVIDERS.map((p) => ({ tenantId, provider: p.key, status: "NOT_CONNECTED" as const })),
  });

  await tx.holiday.createMany({
    data: UZ_HOLIDAYS_2026.map((h) => ({ tenantId, date: new Date(`${h.date}T00:00:00Z`), name: h.name, demandFactor: h.demandFactor })),
  });

  await tx.priceList.create({ data: { tenantId, name: "Base wholesale" } });

  await tx.trainingCourse.createMany({
    data: [
      { tenantId, title: "HACCP basics for food handlers", category: "Food safety", validityMonths: 12, mandatory: true },
      { tenantId, title: "Personal hygiene & GMP", category: "Food safety", validityMonths: 12, mandatory: true },
      { tenantId, title: "Knife handling & cut-resistant PPE", category: "Occupational safety", validityMonths: 24, mandatory: true },
      { tenantId, title: "Cold-chain handling for drivers", category: "Logistics", validityMonths: 12, mandatory: false },
    ],
  });

  // First billing invoice is issued when the trial ends or immediately for active subscriptions.
  if (input.activeSubscription && !input.isDemo) {
    const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
    const amount = input.billingCycle === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
    await tx.billingInvoice.create({
      data: {
        tenantId,
        subscriptionId: sub.id,
        number: `INV-${slug.toUpperCase().slice(0, 6)}-${Date.now().toString().slice(-6)}`,
        description: `${plan.name} plan — ${input.billingCycle === "YEARLY" ? "yearly" : "monthly"}`,
        amount,
        periodStart: now,
        periodEnd,
        dueAt: addDays(now, 7),
      },
    });
  }

  return { tenant, roles, departments, facility, warehouse: wh };
}
