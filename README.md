# PoultryOS

Multi-tenant SaaS for poultry farms, processors and distributors: procurement → live-bird receiving → production (MES) → labels → inventory (FEFO) → B2B orders → logistics & cold chain → retail → quality/HACCP → traceability & recall → reports.

The **SAFI Demo** organization (Uzbekistan) is seeded with clearly marked demonstration data. Every company setting (batch ID format, expiry thresholds, temperature limits, currency, language, time zone) is configurable per tenant.

## Stack

- Next.js 15 (App Router, server actions), React 19, TypeScript, Tailwind CSS v4
- PostgreSQL 16 + Prisma 6, **row-level security on every tenant table**
- zod validation, recharts, QR (qrcode) and barcodes (bwip-js), ExcelJS / PapaParse for import/export
- Vitest integration tests against a real database, Playwright browser smoke test

## Quick start

```bash
# 1. PostgreSQL: an app role that is NOT a superuser (superusers bypass RLS)
sudo -u postgres psql -c "CREATE ROLE poultryos LOGIN PASSWORD 'poultryos';"
sudo -u postgres psql -c "CREATE DATABASE poultryos OWNER poultryos;"
sudo -u postgres psql -c "CREATE DATABASE poultryos_test OWNER poultryos;"

# 2. Configuration
cp .env.example .env   # set DATABASE_URL, APP_ENCRYPTION_KEY, CRON_SECRET; SMTP_* optional (without it emails stay in the outbox)

# 3. Install, migrate, seed (the demo simulation takes several minutes)
npm install
npm run db:migrate
npm run db:seed        # SEED_SKIP_DEMO=1 npm run db:seed → plans + super admin only

# 4. Run
npm run dev            # http://localhost:3000
```

Production: `npm run build && npm start`. Schedule `GET /api/cron/checks` (header `Authorization: Bearer $CRON_SECRET`) every 10–15 minutes — it raises operational alerts (expiry, low stock, overdue orders, cold chain), sends queued webhooks and updates subscription states.

## Accounts

| Account | Email | Password |
|---|---|---|
| Platform Super Admin | admin@poultryos.local | `Admin#2026!` |
| SAFI Demo — Tenant Owner | owner@safi-demo.uz | `Demo#2026!` |
| SAFI Demo — Company Admin | admin@safi-demo.uz | `Demo#2026!` |
| Department managers / employees | production@, quality@, warehouse@, sales@, procurement@, retail@, driver@safi-demo.uz | `Demo#2026!` |
| B2B customer portal (Baraka) | buyer@baraka-demo.uz | `Demo#2026!` |

Change these passwords before exposing any deployment.

## Architecture

- **Tenant isolation.** Every business table has `tenantId`, `ENABLE` + `FORCE ROW LEVEL SECURITY` and the policy `"tenantId" = current_setting('app.tenant_id')`. Application queries run through `withTenant(scope, fn)` which sets the tenant in a transaction-local setting; a query that forgets a filter still cannot read another tenant. `withSystem()` (RLS bypass) is used only for authentication, the Super Admin console, API-key lookup, the public QR page and seeding. See `prisma/migrations/*_row_level_security` and `src/lib/db.ts`.
- **Auth.** scrypt password hashes, random session tokens stored as SHA-256 hashes, HTTP-only cookie, lockout after 5 failed attempts, single-use reset/invite tokens.
- **RBAC.** Roles: Super Admin, Tenant Owner, Company Admin, Department Manager, Employee (+ portal customer). Permissions are `module.view|operate|manage`; department roles are limited to their department's modules; plan features gate modules. All checks are enforced server-side in `requireApp()` / `defineAction()` (`src/lib/auth.ts`, `src/lib/action.ts`).
- **Services.** Business rules live in `src/server/services/*` (receiving, production mass balance, FEFO allocation, logistics, traceability…), each writes audit logs and trace events. UI pages and the REST API share them.
- **i18n.** Russian, Uzbek (Latin) and English with a header switcher; dictionaries in `src/lib/i18n/` are generated from `scripts/i18n_core.tsv`. Strings without a translation fall back to English.
- **Formats.** Asia/Tashkent, UZS, DD.MM.YYYY, kg / tonnes.

## Key formulas

- Live net weight = gross − tare; average bird weight = accepted weight / accepted birds
- Product yield % = product output kg / live input kg × 100; total yield = saleable output / input
- Mass balance: outputs + by-products + waste + unexplained = input (outputs above input are rejected)
- FEFO: allocation and picking always take the lot with the earliest expiry that is available and not blocked
- Forecast: recent 14-day average × day-of-week index × monthly seasonal factor × holiday factor, never below orders already booked; no machine learning. Planners can override every figure and the assumptions are shown on the page.

## Integrations — honest status

Didox, Faktura.uz, 1C, Smartup, Wialon, BILLZ and FoodMate/Marel appear as **Not connected** connectors. Credentials can be stored (encrypted with AES-256-GCM, never sent to the browser) and adapters are prepared, but no live calls are made to these vendors. Data exchange today works through:

- CSV/Excel export of every report and list, spreadsheet import of B2B orders
- REST API `/api/v1/*` with scoped API keys (OpenAPI at `/api/v1/openapi.json`), including temperature-telemetry and scale-reading ingestion endpoints
- Signed outbound webhooks

Subscription payments are recorded as invoices and are activated only when a Super Admin confirms a bank transfer with its reference — no payment gateway is connected and no payment is ever marked paid automatically. Demo temperature readings are labelled as demo data, not live telemetry. Quality and HACCP features support record-keeping; they do not imply any certification.

## Video guides

Russian video tutorials for every role (owner, company admin, department manager, warehouse
employee, driver, B2B customer, super admin) are produced from the running app — see
[`video/README.md`](video/README.md) for the capture → narration → render pipeline.

## Tests

```bash
npm run typecheck
npm test               # integration tests on poultryos_test (migrates + seeds it on first run)
npm run test:e2e       # browser smoke test across roles; needs `npm run dev` running and the seeded demo
```
