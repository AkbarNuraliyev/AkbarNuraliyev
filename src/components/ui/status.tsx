"use client";

import { useT } from "@/lib/i18n/client";
import { Pill, type Tone } from "./basic";
import { statusLabel } from "@/lib/status";

const TONE_MAP: Record<string, Tone> = {
  // generic
  ACTIVE: "green",
  INACTIVE: "gray",
  SUSPENDED: "red",
  TRIALING: "blue",
  TRIAL_EXPIRED: "red",
  PAST_DUE: "amber",
  CANCELED: "gray",
  // receipts / batches
  ACCEPTED: "green",
  PARTIAL: "amber",
  REJECTED: "red",
  RECEIVED: "blue",
  IN_PRODUCTION: "violet",
  COMPLETED: "green",
  BLOCKED: "red",
  RECALLED: "red",
  // shifts
  PLANNED: "gray",
  OPEN: "blue",
  CLOSED: "gray",
  // inventory
  AVAILABLE: "green",
  QUARANTINE: "amber",
  EXPIRED: "red",
  // orders
  NEW: "blue",
  CONFIRMED: "violet",
  ALLOCATED: "orange",
  PICKING: "amber",
  READY_FOR_DISPATCH: "navy",
  IN_DELIVERY: "blue",
  DELIVERED: "green",
  PARTIALLY_DELIVERED: "amber",
  CANCELLED: "gray",
  // invoices
  UNPAID: "amber",
  PAID: "green",
  VOID: "gray",
  // shipments
  LOADING: "amber",
  IN_TRANSIT: "blue",
  PENDING: "gray",
  FAILED: "red",
  // quality
  PASS: "green",
  FAIL: "red",
  INVESTIGATING: "amber",
  ACTION: "violet",
  MINOR: "amber",
  MAJOR: "orange",
  CRITICAL: "red",
  DONE: "green",
  IN_PROGRESS: "amber",
  // integrations
  NOT_CONNECTED: "gray",
  CONFIGURED: "amber",
  CONNECTED: "green",
  ERROR: "red",
  DRAFT: "gray",
  APPROVED: "green",
  SENT: "green",
  NOT_SENT: "amber",
  QUEUED: "gray",
  WARNING: "amber",
  INFO: "blue",
  ACKNOWLEDGED: "gray",
  RESOLVED: "green",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const t = useT();
  return <Pill tone={TONE_MAP[status] ?? "gray"}>{t(label ?? statusLabel(status))}</Pill>;
}
