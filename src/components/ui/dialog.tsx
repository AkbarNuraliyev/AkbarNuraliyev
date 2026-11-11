"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, X, AlertTriangle } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { useT } from "@/lib/i18n/client";
import { buttonClass, cx, type ButtonVariant, type ButtonSize } from "./basic";
import { toast } from "./toast";

const ModalCtx = createContext<{ close: () => void } | null>(null);
export const useModal = () => useContext(ModalCtx);

export function Modal({
  trigger,
  title,
  description,
  children,
  size = "md",
  triggerVariant = "secondary",
  triggerSize = "md",
  triggerClassName,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerClassName?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, triggerSize, triggerClassName)} onClick={() => setOpen(true)}>
        {typeof trigger === "string" ? t(trigger) : trigger}
      </button>
      {open &&
        mounted &&
        createPortal(
          <ModalCtx.Provider value={{ close: () => setOpen(false) }}>
            <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
              <div
                role="dialog"
                aria-modal="true"
                className={cx(
                  "max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-xl",
                  size === "sm" && "sm:max-w-md",
                  size === "md" && "sm:max-w-lg",
                  size === "lg" && "sm:max-w-2xl",
                  size === "xl" && "sm:max-w-4xl",
                )}
              >
                <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
                  <div>
                    <h3 className="text-base font-semibold text-ink">{t(title)}</h3>
                    {description && <p className="mt-0.5 text-[13px] text-ink-3">{t(description)}</p>}
                  </div>
                  <button type="button" className="rounded p-1 text-ink-3 hover:bg-slate-100 hover:text-ink" onClick={() => setOpen(false)} aria-label="Close">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="px-5 py-4">{children}</div>
              </div>
            </div>
          </ModalCtx.Provider>,
          document.body,
        )}
    </>
  );
}

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * A button that runs a server action with hidden fields, optionally after a
 * confirmation dialog (used for every destructive or irreversible operation).
 */
export function ActionButton({
  action,
  fields = {},
  children,
  variant = "secondary",
  size = "sm",
  confirm,
  confirmText,
  confirmVariant = "danger",
  reasonLabel,
  className,
  disabled,
}: {
  action: Action;
  fields?: Record<string, string | number>;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  confirm?: string;
  confirmText?: string;
  confirmVariant?: ButtonVariant;
  reasonLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!state) return;
    if (state.message) toast(state.ok ? "success" : "error", state.message);
    if (state.ok) {
      setOpen(false);
      setReason("");
      if (state.redirectTo) router.push(state.redirectTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const run = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    if (reasonLabel) fd.set("reason", reason);
    startTransition(() => formAction(fd));
  };
  return (
    <>
      <button
        type="button"
        disabled={pending || disabled}
        className={buttonClass(variant, size, className)}
        onClick={() => (confirm || reasonLabel ? setOpen(true) : run())}
      >
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {typeof children === "string" ? t(children) : children}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
            <div role="alertdialog" aria-modal="true" className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-xl">
              <div className="flex gap-3">
                {confirmVariant === "danger" && (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50">
                    <AlertTriangle className="h-4.5 w-4.5 text-red-600" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-semibold text-ink">{t(confirm ?? "Please confirm")}</h3>
                  {confirmText && <p className="mt-1 text-[13px] text-ink-3">{t(confirmText)}</p>}
                  {reasonLabel && (
                    <div className="mt-3">
                      <label className="label">{t(reasonLabel)}</label>
                      <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                      {state && !state.ok && state.message && <p className="mt-1 text-[12.5px] text-red-600">{state.message}</p>}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className={buttonClass("secondary", "md")} onClick={() => setOpen(false)}>
                  {t("Cancel")}
                </button>
                <button type="button" disabled={pending} className={buttonClass(confirmVariant, "md")} onClick={run}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {typeof children === "string" ? t(children) : t("Confirm")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
