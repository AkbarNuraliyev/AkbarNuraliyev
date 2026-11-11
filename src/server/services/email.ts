import nodemailer from "nodemailer";
import { withSystem } from "@/lib/db";

/**
 * Transactional e-mail. Every message is written to the platform outbox.
 * It is only sent when SMTP is configured; otherwise it is stored with status
 * NOT_SENT (and, outside production, the body is printed to the server log so
 * links can be tested locally). Nothing is reported as sent unless the SMTP
 * server accepted it.
 */
export async function sendEmail(input: { to: string; subject: string; body: string; tenantId?: string | null }) {
  const row = await withSystem((tx) => tx.emailOutbox.create({ data: { to: input.to, subject: input.subject, body: input.body, tenantId: input.tenantId ?? null } }));
  const host = process.env.SMTP_HOST;
  if (!host) {
    await withSystem((tx) => tx.emailOutbox.update({ where: { id: row.id }, data: { status: "NOT_SENT", error: "SMTP is not configured" } }));
    if (process.env.NODE_ENV !== "production") console.info(`[email:not-sent] to=${input.to} subject="${input.subject}"\n${input.body}\n`);
    return { sent: false };
  }
  try {
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
    await transport.sendMail({ from: process.env.SMTP_FROM || "PoultryOS <no-reply@poultryos.local>", to: input.to, subject: input.subject, text: input.body });
    await withSystem((tx) => tx.emailOutbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date() } }));
    return { sent: true };
  } catch (e) {
    await withSystem((tx) => tx.emailOutbox.update({ where: { id: row.id }, data: { status: "FAILED", error: e instanceof Error ? e.message.slice(0, 300) : "Send failed" } }));
    return { sent: false };
  }
}

export function appUrl(path = "") {
  return `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}${path}`;
}
