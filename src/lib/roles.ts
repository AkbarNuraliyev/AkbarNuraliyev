import { allPermissionKeys, ACTIONS, MODULES } from "./modules";

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  departmentScoped: boolean;
  isPortal: boolean;
  permissions: string[];
}

const all = allPermissionKeys();
const opModules = MODULES.filter((m) => m.key !== "overview").map((m) => m.key);

const RAW_TEMPLATES: RoleTemplate[] = [
  {
    key: "OWNER",
    name: "Tenant Owner",
    description: "Owns the workspace and subscription. Full access.",
    departmentScoped: false,
    isPortal: false,
    permissions: all,
  },
  {
    key: "ADMIN",
    name: "Company Admin",
    description: "Configures company operations, users and master data.",
    departmentScoped: false,
    isPortal: false,
    permissions: all.filter((p) => p !== "settings.billing"),
  },
  {
    key: "MANAGER",
    name: "Department Manager",
    description: "Manages the modules of the assigned department; read access to overview, reports and traceability.",
    departmentScoped: true,
    isPortal: false,
    permissions: [
      "overview.view",
      "reports.view",
      "traceability.view",
      "traceability.recall",
      ...opModules.filter((m) => m !== "settings" && m !== "integrations").flatMap((m) => ACTIONS.map((a) => `${m}.${a}`)),
    ],
  },
  {
    key: "EMPLOYEE",
    name: "Employee",
    description: "Works with the operational modules of the assigned department.",
    departmentScoped: true,
    isPortal: false,
    permissions: [
      "overview.view",
      "traceability.view",
      ...opModules
        .filter((m) => !["settings", "integrations", "reports", "employees"].includes(m))
        .flatMap((m) => [`${m}.view`, `${m}.operate`]),
    ],
  },
  {
    key: "CUSTOMER",
    name: "B2B Customer (portal)",
    description: "External customer user with access to the B2B ordering portal only.",
    departmentScoped: false,
    isPortal: true,
    permissions: [],
  },
];

export const ROLE_TEMPLATES: RoleTemplate[] = RAW_TEMPLATES.map((r) => ({ ...r, permissions: [...new Set(r.permissions)] }));

export const DEFAULT_DEPARTMENTS: { name: string; modules: string[] }[] = [
  { name: "Procurement", modules: ["procurement", "receiving"] },
  { name: "Production", modules: ["production", "products", "receiving"] },
  { name: "Warehouse", modules: ["inventory", "products"] },
  { name: "Sales", modules: ["orders", "sales"] },
  { name: "Logistics", modules: ["logistics", "orders"] },
  { name: "Quality", modules: ["quality", "receiving", "traceability"] },
  { name: "Retail", modules: ["retail", "inventory"] },
  { name: "Finance", modules: ["sales", "reports"] },
];

/** Permissions that department-scoped roles keep regardless of department. */
const GLOBAL_FOR_SCOPED = new Set(["overview.view", "traceability.view", "reports.view"]);

export function effectivePermissions(
  rolePermissions: string[],
  departmentScoped: boolean,
  departmentModules: string[] | null | undefined,
): Set<string> {
  if (!departmentScoped) return new Set(rolePermissions);
  const allowed = new Set(departmentModules ?? []);
  return new Set(rolePermissions.filter((p) => GLOBAL_FOR_SCOPED.has(p) || allowed.has(p.split(".")[0])));
}
