import QRCode from "qrcode";
import { appUrl } from "./services/email";

export async function qrSvg(text: string, size = 160): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, width: size, errorCorrectionLevel: "M", color: { dark: "#0b1a30", light: "#ffffff" } });
}

export async function barcodeSvg(code: string, bcid: "ean13" | "code128" = "ean13", height = 10): Promise<string> {
  const bwip = await import("bwip-js");
  const mod = (bwip as unknown as { default?: typeof bwip }).default ?? bwip;
  return (mod as unknown as { toSVG: (o: Record<string, unknown>) => string }).toSVG({ bcid, text: code, scale: 2, height, includetext: true, textxalign: "center", textsize: 9 });
}

export const batchScanUrl = (code: string) => appUrl(`/app/traceability?q=${encodeURIComponent(code)}`);
export const publicTraceUrl = (token: string) => appUrl(`/t/${token}`);
