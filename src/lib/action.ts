import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AppError, type ActionResult } from "./errors";
import { actionCtx, type AppCtx } from "./auth";
import { getI18n } from "./i18n/server";
import { dispatchPendingWebhooks } from "@/server/services/webhooks";

export function isNextControlError(e: unknown): boolean {
  const digest = (e as { digest?: string })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_HTTP_ERROR"));
}

/** Converts FormData into a plain object. Keys ending in [] become arrays; empty strings become undefined. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of fd.entries()) {
    if (rawKey.startsWith("$ACTION")) continue;
    if (value instanceof File) {
      out[rawKey] = value;
      continue;
    }
    const v = typeof value === "string" ? value.trim() : value;
    if (rawKey.endsWith("[]")) {
      const key = rawKey.slice(0, -2);
      (out[key] as unknown[] | undefined) ? (out[key] as unknown[]).push(v) : (out[key] = [v]);
    } else {
      out[rawKey] = v === "" ? undefined : v;
    }
  }
  return out;
}

export function zodErrors(err: z.ZodError, t: (k: string) => string): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (!errors[key]) errors[key] = t(issue.message);
  }
  return errors;
}

type Handler<S extends z.ZodTypeAny> = (ctx: AppCtx, input: z.infer<S>, fd: FormData) => Promise<ActionResult | void>;

export interface ActionOptions<S extends z.ZodTypeAny> {
  permission?: string;
  feature?: string;
  schema?: S;
  allowReadOnly?: boolean;
  portal?: boolean;
}

/** Standard server-action wrapper: authorization → validation → handler → translated result. */
export function defineAction<S extends z.ZodTypeAny>(opts: ActionOptions<S>, handler: Handler<S>) {
  return async (_prev: ActionResult | null, fd: FormData): Promise<ActionResult> => {
    const { t } = await getI18n();
    try {
      const ctx = await actionCtx({ permission: opts.permission, feature: opts.feature, allowReadOnly: opts.allowReadOnly, portal: opts.portal });
      let input: unknown = undefined;
      if (opts.schema) {
        const parsed = opts.schema.safeParse(formToObject(fd));
        if (!parsed.success) return { ok: false, message: t("Please correct the highlighted fields."), errors: zodErrors(parsed.error, t) };
        input = parsed.data;
      }
      const result = (await handler(ctx, input as z.infer<S>, fd)) ?? { ok: true };
      if (result.message) result.message = t(result.message, result.params);
      delete result.params;
      if (result.ok) {
        revalidatePath("/", "layout");
        void dispatchPendingWebhooks(ctx.tenantId).catch(() => undefined);
      }
      return result;
    } catch (e) {
      if (isNextControlError(e)) throw e;
      if (e instanceof AppError) {
        return { ok: false, message: t(e.template, e.params), errors: e.field ? { [e.field]: t(e.template, e.params) } : undefined };
      }
      console.error("[action error]", e);
      return { ok: false, message: t("Something went wrong. The operation was not saved.") };
    }
  };
}

/** Wrapper for unauthenticated actions (sign-in, registration, password reset). */
export function definePublicAction<S extends z.ZodTypeAny>(schema: S, handler: (input: z.infer<S>, fd: FormData) => Promise<ActionResult | void>) {
  return async (_prev: ActionResult | null, fd: FormData): Promise<ActionResult> => {
    const { t } = await getI18n();
    try {
      const parsed = schema.safeParse(formToObject(fd));
      if (!parsed.success) return { ok: false, message: t("Please correct the highlighted fields."), errors: zodErrors(parsed.error, t) };
      const result = (await handler(parsed.data, fd)) ?? { ok: true };
      if (result.message) result.message = t(result.message, result.params);
      delete result.params;
      return result;
    } catch (e) {
      if (isNextControlError(e)) throw e;
      if (e instanceof AppError) return { ok: false, message: t(e.template, e.params), errors: e.field ? { [e.field]: t(e.template, e.params) } : undefined };
      console.error("[public action error]", e);
      return { ok: false, message: t("Something went wrong. Please try again.") };
    }
  };
}

// Common zod helpers -------------------------------------------------------

export const zStr = (max = 200) => z.string({ required_error: "This field is required" }).trim().min(1, "This field is required").max(max, "Too long");
export const zOptStr = (max = 500) => z.string().trim().max(max, "Too long").optional().nullable().transform((v) => (v ? v : null));
export const zNum = (opts: { min?: number; max?: number; int?: boolean } = {}) => {
  let s = z.coerce.number({ invalid_type_error: "Enter a valid number", required_error: "This field is required" });
  if (opts.int) s = s.int("Enter a whole number");
  if (opts.min !== undefined) s = s.min(opts.min, `Must be at least ${opts.min}`);
  if (opts.max !== undefined) s = s.max(opts.max, `Must be at most ${opts.max}`);
  return s;
};
export const zOptNum = (opts: { min?: number; max?: number; int?: boolean } = {}) =>
  z.preprocess((v) => (v === undefined || v === null || v === "" ? undefined : v), zNum(opts).optional());
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === true || v === "1", z.boolean());
export const zId = z.string({ required_error: "Please select a value" }).min(1, "Please select a value");
export const zOptId = z.string().optional().nullable().transform((v) => (v ? v : null));
export const zDate = z
  .string({ required_error: "This field is required" })
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
export const zDateTime = z
  .string({ required_error: "This field is required" })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "Enter a valid date and time");
export const zEmail = z.string({ required_error: "This field is required" }).trim().toLowerCase().email("Enter a valid email address").max(200);
export const zJson = <T extends z.ZodTypeAny>(schema: T) =>
  z.string({ required_error: "This field is required" }).transform((s, ctx) => {
    try {
      return JSON.parse(s);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid data" });
      return z.NEVER;
    }
  }).pipe(schema);
