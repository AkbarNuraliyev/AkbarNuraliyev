export interface IntegrationField {
  key: string;
  label: string;
  type: "text" | "url" | "secret";
  placeholder?: string;
}

export interface IntegrationProvider {
  key: string;
  name: string;
  category: "E-invoicing" | "Accounting / ERP" | "Telematics" | "Retail POS" | "Production equipment" | "Weighing";
  description: string;
  requirements: string[];
  fields: IntegrationField[];
  /** True when the adapter can perform a real connection test with the given credentials. */
  testable: boolean;
  dataFlows: string[];
}

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    key: "didox",
    name: "Didox",
    category: "E-invoicing",
    description: "Electronic invoices (ESF), delivery notes and e-signature document exchange in Uzbekistan.",
    requirements: [
      "Partner API access agreement with Didox",
      "Company TIN and an e-signature (EIMZO) key for signing",
      "Partner API documentation and sandbox credentials",
    ],
    fields: [
      { key: "baseUrl", label: "API base URL", type: "url", placeholder: "Provided by Didox" },
      { key: "tin", label: "Company TIN", type: "text" },
      { key: "partnerToken", label: "Partner token", type: "secret" },
    ],
    testable: false,
    dataFlows: ["Sales invoices → e-invoice drafts", "Signed status ← Didox"],
  },
  {
    key: "faktura",
    name: "Faktura.uz",
    category: "E-invoicing",
    description: "Electronic invoices and acts through the Faktura.uz operator.",
    requirements: ["Faktura.uz API account", "Company TIN and e-signature", "API documentation from the operator"],
    fields: [
      { key: "baseUrl", label: "API base URL", type: "url" },
      { key: "login", label: "API login", type: "text" },
      { key: "password", label: "API password", type: "secret" },
    ],
    testable: false,
    dataFlows: ["Sales invoices → e-invoice drafts", "Document statuses ← Faktura.uz"],
  },
  {
    key: "1c",
    name: "1C:Enterprise",
    category: "Accounting / ERP",
    description: "Exchange of products, customers, sales invoices and payments with 1C accounting via HTTP services or CSV.",
    requirements: ["Published 1C HTTP service (or OData) reachable from the internet", "Service user credentials", "Agreed exchange mapping"],
    fields: [
      { key: "baseUrl", label: "1C HTTP service URL", type: "url" },
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "secret" },
    ],
    testable: true,
    dataFlows: ["Products, customers ↔ 1C", "Sales invoices → 1C", "Payments ← 1C"],
  },
  {
    key: "smartup",
    name: "Smartup ERP",
    category: "Accounting / ERP",
    description: "Distribution ERP — orders, customers and stock synchronization.",
    requirements: ["Smartup API credentials", "Filial / project identifiers", "API documentation from Smartup"],
    fields: [
      { key: "baseUrl", label: "API base URL", type: "url" },
      { key: "clientId", label: "Client ID", type: "text" },
      { key: "clientSecret", label: "Client secret", type: "secret" },
    ],
    testable: false,
    dataFlows: ["Orders ← Smartup", "Stock levels → Smartup"],
  },
  {
    key: "wialon",
    name: "Wialon",
    category: "Telematics",
    description: "GPS tracking and refrigerated-body temperature sensors from Wialon-compatible trackers.",
    requirements: ["Wialon Hosting or Local account", "API token with access to units", "Units mapped to vehicles (telematics device ID)"],
    fields: [
      { key: "baseUrl", label: "Wialon API host", type: "url", placeholder: "https://hst-api.wialon.com" },
      { key: "token", label: "API token", type: "secret" },
    ],
    testable: true,
    dataFlows: ["Vehicle positions ← Wialon", "Body temperature sensor values ← Wialon"],
  },
  {
    key: "billz",
    name: "BILLZ",
    category: "Retail POS",
    description: "Cloud POS for retail locations — daily sales, receipts and store stock.",
    requirements: ["BILLZ API secret token", "Shop IDs mapped to retail locations"],
    fields: [
      { key: "baseUrl", label: "API base URL", type: "url", placeholder: "https://api-admin.billz.ai" },
      { key: "secretToken", label: "Secret token", type: "secret" },
    ],
    testable: false,
    dataFlows: ["Sales receipts ← BILLZ", "Product catalog → BILLZ"],
  },
  {
    key: "foodmate",
    name: "FoodMate",
    category: "Production equipment",
    description: "Deboning / cut-up line data (throughput, cut weights) from FoodMate equipment.",
    requirements: ["Line controller / SCADA export access", "Data format specification from the vendor"],
    fields: [{ key: "endpoint", label: "Data endpoint", type: "url" }],
    testable: false,
    dataFlows: ["Line throughput and cut weights ← line controller"],
  },
  {
    key: "marel",
    name: "Marel Innova",
    category: "Production equipment",
    description: "Production data from Marel Innova food-processing software.",
    requirements: ["Innova integration license / API", "Network access to the Innova server"],
    fields: [
      { key: "endpoint", label: "Innova API endpoint", type: "url" },
      { key: "apiKey", label: "API key", type: "secret" },
    ],
    testable: false,
    dataFlows: ["Batch & weighing records ← Innova"],
  },
  {
    key: "scales",
    name: "Industrial weighing scales",
    category: "Weighing",
    description:
      "Platform and hanging scales push readings to PoultryOS through a local gateway using the /api/v1/scale-readings endpoint (API key).",
    requirements: ["Scale gateway (RS-232/TCP to HTTPS)", "API key with the scales:write scope", "Device IDs configured in the gateway"],
    fields: [{ key: "deviceIds", label: "Device IDs (comma separated)", type: "text", placeholder: "SCALE-RCV-1, SCALE-LINE-1" }],
    testable: false,
    dataFlows: ["Weight readings ← scale gateway"],
  },
];

export function providerByKey(key: string) {
  return INTEGRATION_PROVIDERS.find((p) => p.key === key);
}
