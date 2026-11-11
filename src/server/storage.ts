import { promises as fs } from "node:fs";
import path from "node:path";
import { randomToken } from "@/lib/crypto";
import { AppError } from "@/lib/errors";

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; check: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", check: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", check: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** Validates by size and magic bytes (never trusts the client MIME type) and stores the file under the tenant's folder. */
export async function storeUpload(tenantId: string, file: File, allowed: string[] = SIGNATURES.map((s) => s.mime)) {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new AppError("Select a file to upload", {}, "file");
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("File is too large (max 5 MB)", {}, "file");
  const buf = Buffer.from(await file.arrayBuffer());
  const sig = SIGNATURES.find((s) => allowed.includes(s.mime) && s.check(buf));
  if (!sig) throw new AppError("Unsupported file type. Allowed: PDF, PNG, JPEG, WEBP.", {}, "file");
  const key = `${tenantId}/${new Date().toISOString().slice(0, 7)}/${randomToken(18)}.${sig.ext}`;
  const full = path.join(UPLOAD_ROOT, key);
  if (!full.startsWith(UPLOAD_ROOT + path.sep)) throw new AppError("Invalid storage path");
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf, { mode: 0o600 });
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || `file.${sig.ext}`;
  return { storageKey: key, mimeType: sig.mime, sizeBytes: buf.length, fileName: safeName };
}

export async function readUpload(storageKey: string): Promise<Buffer | null> {
  const full = path.join(UPLOAD_ROOT, storageKey);
  if (!full.startsWith(UPLOAD_ROOT + path.sep)) return null;
  try {
    return await fs.readFile(full);
  } catch {
    return null;
  }
}
