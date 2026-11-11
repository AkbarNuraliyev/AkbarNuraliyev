/* eslint-disable no-console */
import { withSystem } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { PLAN_DEFAULT_FEATURES } from "@/lib/modules";
import { syncPermissions } from "@/server/services/tenants";
import { seedDemo, DEMO_PASSWORD } from "./seed/demo";

export const PLANS = [
  {
    code: "STARTER",
    name: "Starter",
    description: "One production facility, basic inventory, supplier management and basic batch traceability.",
    priceMonthly: 1_500_000,
    priceYearly: 15_000_000,
    maxUsers: 5,
    maxFacilities: 1,
    maxWarehouses: 1,
    maxRetailLocations: 0,
    sortOrder: 1,
  },
  {
    code: "GROWTH",
    name: "Growth",
    description: "Multiple warehouses, production management (MES), B2B portal, logistics, quality and analytics.",
    priceMonthly: 4_500_000,
    priceYearly: 45_000_000,
    maxUsers: 25,
    maxFacilities: 2,
    maxWarehouses: 10,
    maxRetailLocations: 15,
    sortOrder: 2,
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Multiple facilities, advanced production, full traceability, API access, webhooks and custom integrations.",
    priceMonthly: 12_000_000,
    priceYearly: 120_000_000,
    maxUsers: null,
    maxFacilities: null,
    maxWarehouses: null,
    maxRetailLocations: null,
    sortOrder: 3,
  },
];

export async function seedPlatform() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@poultryos.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin#2026!";
  const passwordHash = await hashPassword(adminPassword);
  await withSystem(async (tx) => {
    await syncPermissions(tx);
    for (const p of PLANS) {
      await tx.plan.upsert({
        where: { code: p.code },
        update: {},
        create: { ...p, features: PLAN_DEFAULT_FEATURES[p.code], currency: "UZS", trialDays: 14 },
      });
    }
    await tx.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash, isSuperAdmin: true, isActive: true },
      create: { email: adminEmail, name: "Platform Super Admin", passwordHash, isSuperAdmin: true, locale: "en" },
    });
  });
  return { adminEmail, adminPassword };
}

async function main() {
  const t0 = Date.now();
  const admin = await seedPlatform();
  if (process.env.SEED_SKIP_DEMO !== "1") await seedDemo();
  console.log(`\nSeed complete in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`  Super Admin:   ${admin.adminEmail} / ${admin.adminPassword}`);
  console.log(`  SAFI Demo:     owner@safi-demo.uz / ${DEMO_PASSWORD} (also admin@, production@, quality@, warehouse@, sales@, driver@, retail@, procurement@safi-demo.uz)`);
  console.log(`  B2B portal:    buyer@baraka-demo.uz / ${DEMO_PASSWORD}`);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
