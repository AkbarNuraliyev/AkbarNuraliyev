/**
 * Navigation modules, permission keys and plan features.
 * Kept free of server-only imports so it can be shared by client components.
 */

export type ModuleKey =
  | "overview"
  | "procurement"
  | "receiving"
  | "production"
  | "products"
  | "inventory"
  | "orders"
  | "sales"
  | "logistics"
  | "retail"
  | "quality"
  | "traceability"
  | "reports"
  | "employees"
  | "integrations"
  | "settings";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  path: string;
  icon: string;
  feature: string | null;
  phase: 1 | 2 | 3;
}

export const MODULES: ModuleDef[] = [
  { key: "overview", label: "Overview", path: "/app", icon: "LayoutDashboard", feature: null, phase: 1 },
  { key: "procurement", label: "Procurement & Farms", path: "/app/procurement", icon: "Wheat", feature: "procurement", phase: 1 },
  { key: "receiving", label: "Raw Material Receiving", path: "/app/receiving", icon: "PackageCheck", feature: "receiving", phase: 1 },
  { key: "production", label: "Production / MES", path: "/app/production", icon: "Factory", feature: "production", phase: 1 },
  { key: "products", label: "Products & Labels", path: "/app/products", icon: "Tags", feature: "products", phase: 1 },
  { key: "inventory", label: "Inventory & Warehouses", path: "/app/inventory", icon: "Warehouse", feature: "inventory", phase: 1 },
  { key: "orders", label: "B2B Orders", path: "/app/orders", icon: "ClipboardList", feature: "orders", phase: 1 },
  { key: "sales", label: "Sales & Customers", path: "/app/sales", icon: "Users", feature: "sales", phase: 1 },
  { key: "logistics", label: "Logistics & Fleet", path: "/app/logistics", icon: "Truck", feature: "logistics", phase: 2 },
  { key: "retail", label: "Retail Locations", path: "/app/retail", icon: "Store", feature: "retail", phase: 2 },
  { key: "quality", label: "Quality Control", path: "/app/quality", icon: "ShieldCheck", feature: "quality", phase: 2 },
  { key: "traceability", label: "Traceability", path: "/app/traceability", icon: "Route", feature: "traceability", phase: 1 },
  { key: "reports", label: "Reports & Analytics", path: "/app/reports", icon: "BarChart3", feature: "reports", phase: 2 },
  { key: "employees", label: "Employees & Training", path: "/app/employees", icon: "GraduationCap", feature: "employees", phase: 3 },
  { key: "integrations", label: "Integrations", path: "/app/integrations", icon: "Plug", feature: "integrations", phase: 3 },
  { key: "settings", label: "Settings & Subscription", path: "/app/settings", icon: "Settings", feature: null, phase: 1 },
];

export const ACTIONS = ["view", "operate", "manage"] as const;
export type PermAction = (typeof ACTIONS)[number];

export const EXTRA_PERMISSIONS = [
  { key: "traceability.recall", module: "traceability", action: "recall", description: "Initiate recalls and block affected inventory" },
  { key: "settings.billing", module: "settings", action: "billing", description: "Manage subscription, plan and billing" },
  { key: "employees.users", module: "employees", action: "users", description: "Invite users, assign roles and permissions" },
];

export const PERMISSION_DESCRIPTIONS: Record<PermAction, string> = {
  view: "View records and dashboards",
  operate: "Record day-to-day operations",
  manage: "Configure master data, approve, adjust and delete",
};

export function allPermissionKeys(): string[] {
  const keys: string[] = [];
  for (const m of MODULES) {
    if (m.key === "overview") {
      keys.push("overview.view");
      continue;
    }
    for (const a of ACTIONS) keys.push(`${m.key}.${a}`);
  }
  for (const e of EXTRA_PERMISSIONS) keys.push(e.key);
  return keys;
}

export function moduleOfPermission(key: string): string {
  return key.split(".")[0];
}

/** Feature catalogue used by plans (editable in Super Admin). */
export const FEATURES: { key: string; label: string; group: string }[] = [
  { key: "procurement", label: "Supplier & farm management", group: "Core" },
  { key: "receiving", label: "Raw material receiving & batch IDs", group: "Core" },
  { key: "products", label: "Product catalog & labels", group: "Core" },
  { key: "inventory", label: "Inventory & FEFO", group: "Core" },
  { key: "orders", label: "Order management", group: "Core" },
  { key: "sales", label: "Customers & receivables", group: "Core" },
  { key: "traceability", label: "Batch traceability (backward)", group: "Core" },
  { key: "employees", label: "Employees directory", group: "Core" },
  { key: "production", label: "Production management / MES", group: "Operations" },
  { key: "multi_warehouse", label: "Multiple warehouses", group: "Operations" },
  { key: "b2b_portal", label: "B2B customer portal", group: "Operations" },
  { key: "logistics", label: "Logistics, fleet & cold chain", group: "Operations" },
  { key: "retail", label: "Retail locations", group: "Operations" },
  { key: "quality", label: "Quality control & HACCP", group: "Operations" },
  { key: "full_traceability", label: "Full forward traceability", group: "Operations" },
  { key: "recall", label: "Recall workflow", group: "Operations" },
  { key: "qr_public", label: "Customer QR traceability page", group: "Operations" },
  { key: "reports", label: "Reports & analytics", group: "Analytics" },
  { key: "forecasting", label: "Demand forecasting & planning", group: "Analytics" },
  { key: "advanced_analytics", label: "Advanced analytics", group: "Analytics" },
  { key: "integrations", label: "Integration settings & CSV exchange", group: "Platform" },
  { key: "api", label: "REST API access", group: "Platform" },
  { key: "webhooks", label: "Webhooks", group: "Platform" },
  { key: "training", label: "Training records", group: "Platform" },
];

export const PLAN_DEFAULT_FEATURES: Record<string, string[]> = {
  STARTER: ["procurement", "receiving", "products", "inventory", "orders", "sales", "traceability", "employees"],
  GROWTH: [
    "procurement", "receiving", "products", "inventory", "orders", "sales", "traceability", "employees",
    "production", "multi_warehouse", "b2b_portal", "logistics", "retail", "quality", "full_traceability",
    "recall", "qr_public", "reports", "forecasting", "integrations",
  ],
  ENTERPRISE: FEATURES.map((f) => f.key),
};

/** Modules that are always reachable regardless of plan. */
export const ALWAYS_ON_FEATURES = new Set(["overview", "settings"]);
