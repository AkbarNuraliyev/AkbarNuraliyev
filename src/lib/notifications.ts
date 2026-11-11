/** Notification title/message are English templates; `params` fills their {placeholders}. */
export function notificationParams(p: unknown): Record<string, string | number> | undefined {
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, string | number>) : undefined;
}
