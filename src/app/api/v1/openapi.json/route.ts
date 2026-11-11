import { NextResponse } from "next/server";
import { appUrl } from "@/server/services/email";

export const dynamic = "force-static";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });

export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: { title: "PoultryOS API", version: "1.0.0", description: "Tenant-scoped REST API. Authenticate with `Authorization: Bearer pos_live_…`. Each key has explicit scopes." },
    servers: [{ url: appUrl("/api/v1") }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: {
        OrderInput: {
          type: "object",
          required: ["customer_code", "delivery_date", "items"],
          properties: {
            customer_code: { type: "string" },
            delivery_date: { type: "string", format: "date" },
            external_ref: { type: "string", description: "Idempotency: an existing non-cancelled order with the same customer and external_ref is returned instead of a duplicate" },
            notes: { type: "string" },
            items: { type: "array", items: { type: "object", required: ["sku", "quantity_kg"], properties: { sku: { type: "string" }, quantity_kg: { type: "number" } } } },
          },
        },
        TemperatureInput: {
          type: "object",
          properties: {
            readings: {
              type: "array",
              items: { type: "object", required: ["temperature_c", "recorded_at"], properties: { chamber_code: { type: "string" }, shipment_number: { type: "string" }, vehicle_plate: { type: "string" }, temperature_c: { type: "number" }, recorded_at: { type: "string", format: "date-time" }, device_id: { type: "string" } } },
            },
          },
        },
        ScaleInput: { type: "object", required: ["device_id", "weight_kg"], properties: { device_id: { type: "string" }, weight_kg: { type: "number" }, stable: { type: "boolean" }, read_at: { type: "string", format: "date-time" } } },
        Error: { type: "object", properties: { error: { type: "object", properties: { status: { type: "integer" }, message: { type: "string" } } } } },
      },
    },
    security: [{ bearer: [] }],
    paths: {
      "/products": { get: { summary: "List products (scope products:read)", responses: { "200": { description: "OK" } } } },
      "/inventory": { get: { summary: "Available stock by batch, FEFO order (scope inventory:read)", parameters: [{ name: "sku", in: "query", schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/orders": {
        get: { summary: "List orders (scope orders:read)", parameters: [{ name: "status", in: "query", schema: { type: "string" } }, { name: "since", in: "query", schema: { type: "string", format: "date-time" } }], responses: { "200": { description: "OK" } } },
        post: { summary: "Create order (scope orders:write)", requestBody: { content: json(ref("OrderInput")) }, responses: { "201": { description: "Created" }, "422": { description: "Business rule violation", content: json(ref("Error")) } } },
      },
      "/orders/{number}": { get: { summary: "Order detail with batches (scope orders:read)", parameters: [{ name: "number", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/batches/{code}/trace": { get: { summary: "Batch trace summary (scope trace:read)", parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
      "/telemetry/temperature": { post: { summary: "Ingest temperature readings (scope telemetry:write)", requestBody: { content: json(ref("TemperatureInput")) }, responses: { "201": { description: "Accepted" } } } },
      "/scale-readings": { post: { summary: "Ingest a scale weight (scope scales:write)", requestBody: { content: json(ref("ScaleInput")) }, responses: { "201": { description: "Stored" } } } },
    },
  };
  return NextResponse.json(spec);
}
