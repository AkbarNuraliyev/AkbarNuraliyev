import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withSystem, withTenant } from "@/lib/db";
import { readUpload } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Serves a document to members of the owning tenant, or publicly if it is a published certificate/product image. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  let doc = s?.tenant ? await withTenant({ tenantId: s.tenant.id }, (tx) => tx.document.findUnique({ where: { id } })) : null;
  if (!doc) {
    // public access only for documents explicitly marked public or product images
    const pub = await withSystem((tx) => tx.document.findUnique({ where: { id } }));
    if (pub && (pub.isPublic || pub.type === "IMAGE")) doc = pub;
  }
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await readUpload(doc.storageKey);
  if (!buf) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });
  const inline = doc.mimeType.startsWith("image/") || doc.mimeType === "application/pdf";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": doc.mimeType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${doc.fileName.replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "cache-control": "private, max-age=300",
    },
  });
}
