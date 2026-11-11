import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { apiAuth } from "@/server/api";
import { createApiKey } from "@/server/services/integrations";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { makeTenant, type TestTenant } from "./helpers";

let ENT: TestTenant;
let GROW: TestTenant;
let key: string;

const req = (k?: string) => new NextRequest("http://localhost/api/v1/products", { headers: k ? { authorization: `Bearer ${k}` } : {} });

beforeAll(async () => {
  ENT = await makeTenant("API Enterprise");
  GROW = await makeTenant("API Growth", "GROWTH");
  key = (await withTenant(ENT.ctx, (tx) => createApiKey(tx, ENT.ctx, { name: "test", scopes: ["products:read"] }))).raw;
});

describe("REST API authentication", () => {
  it("rejects missing and unknown keys", async () => {
    expect(((await apiAuth(req(), "products:read")) as NextResponse).status).toBe(401);
    expect(((await apiAuth(req("pos_live_invalid"), "products:read")) as NextResponse).status).toBe(401);
  });

  it("accepts a valid key, resolves its tenant and enforces scopes", async () => {
    const ok = await apiAuth(req(key), "products:read");
    expect(ok).not.toBeInstanceOf(NextResponse);
    expect((ok as { tenantId: string }).tenantId).toBe(ENT.tenantId);
    expect(((await apiAuth(req(key), "orders:write")) as NextResponse).status).toBe(403);
  });

  it("is refused on plans without API access, and after revocation", async () => {
    const growKey = (await withTenant(GROW.ctx, (tx) => createApiKey(tx, GROW.ctx, { name: "g", scopes: ["products:read"] }))).raw;
    expect(((await apiAuth(req(growKey), "products:read")) as NextResponse).status).toBe(403);
    await withTenant(ENT.ctx, (tx) => tx.apiKey.updateMany({ data: { revokedAt: new Date() } }));
    expect(((await apiAuth(req(key), "products:read")) as NextResponse).status).toBe(401);
  });

  it("stores only a hash of the key and encrypts integration secrets", async () => {
    const rows = await withTenant(ENT.ctx, (tx) => tx.apiKey.findMany());
    expect(rows.every((r) => !r.keyHash.includes(key) && r.keyHash.length === 64)).toBe(true);
    const enc = encryptSecret("s3cret");
    expect(enc).not.toContain("s3cret");
    expect(decryptSecret(enc)).toBe("s3cret");
  });
});
