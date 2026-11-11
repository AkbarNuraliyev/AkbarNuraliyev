/** Human-readable labels for enum statuses (shared by server and client components). */
export const STATUS_LABELS: Record<string, string> = {
  ALLOCATED: "In Production / Allocated",
  READY_FOR_DISPATCH: "Ready for Dispatch",
  IN_DELIVERY: "In Delivery",
  PARTIALLY_DELIVERED: "Partially Delivered",
  IN_PRODUCTION: "In production",
  NOT_CONNECTED: "Not connected",
  TRIAL_EXPIRED: "Trial expired",
  PAST_DUE: "Past due",
  IN_TRANSIT: "In transit",
  IN_PROGRESS: "In progress",
};

export function statusLabel(s: string) {
  return STATUS_LABELS[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replaceAll("_", " ");
}
