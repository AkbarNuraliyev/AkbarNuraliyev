"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { useT } from "@/lib/i18n/client";
import { buttonClass, cx, type ButtonVariant, type ButtonSize } from "./basic";
import { toast } from "./toast";
import { useModal } from "./dialog";

export type ServerAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

const FormCtx = createContext<{ state: ActionResult | null; pending: boolean }>({ state: null, pending: false });

export function useFormState() {
  return useContext(FormCtx);
}

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  closeOnSuccess = true,
  refreshOnSuccess = false,
  id,
}: {
  action: ServerAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  closeOnSuccess?: boolean;
  refreshOnSuccess?: boolean;
  id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const modal = useModal();
  useEffect(() => {
    if (!state) return;
    if (state.message) toast(state.ok ? "success" : "error", state.message);
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      if (closeOnSuccess) modal?.close();
      if (state.redirectTo) router.push(state.redirectTo);
      else if (refreshOnSuccess) router.refresh();
    } else if (state.errors) {
      const first = Object.keys(state.errors)[0];
      const el = ref.current?.querySelector<HTMLElement>(`[name="${first}"]`);
      el?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <FormCtx.Provider value={{ state, pending }}>
      <form
        id={id}
        ref={ref}
        className={className}
        // Progressive enhancement: before hydration the browser POSTs to the server action
        // (never a GET that would put field values such as passwords in the URL).
        action={formAction}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          if (submitter?.name) fd.set(submitter.name, submitter.value);
          startTransition(() => formAction(fd));
        }}
      >
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const { state } = useFormState();
  const err = state?.errors?.[name];
  if (!err) return null;
  return <p className="mt-1 text-[12.5px] text-red-600">{err}</p>;
}

export function Field({ label, name, hint, required, children, className }: { label?: string; name: string; hint?: string; required?: boolean; children: ReactNode; className?: string }) {
  const t = useT();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={`f-${name}`} className="label">
          {t(label)}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children}
      {hint && <p className="mt-1 text-[12px] text-ink-3">{t(hint)}</p>}
      <FieldError name={name} />
    </div>
  );
}

type InputProps = {
  name: string;
  label?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  type?: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  step?: string | number;
  min?: string | number;
  max?: string | number;
  autoComplete?: string;
  inputMode?: "decimal" | "numeric" | "text" | "email" | "tel";
  readOnly?: boolean;
  autoFocus?: boolean;
  suffix?: string;
  maxLength?: number;
};

export function TextInput({ name, label, hint, required, className, defaultValue, placeholder, suffix, ...rest }: InputProps) {
  const t = useT();
  const { state } = useFormState();
  const err = state?.errors?.[name];
  return (
    <Field label={label} name={name} hint={hint} required={required} className={className}>
      <div className="relative">
        <input
          id={`f-${name}`}
          name={name}
          defaultValue={defaultValue ?? undefined}
          placeholder={placeholder ? t(placeholder) : undefined}
          aria-invalid={!!err}
          className={cx("input", err && "input-error", suffix && "pr-12")}
          {...rest}
          type={rest.type ?? "text"}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-ink-3">{suffix}</span>}
      </div>
    </Field>
  );
}

export function NumberInput(props: Omit<InputProps, "type">) {
  return <TextInput type="number" inputMode="decimal" step={props.step ?? "any"} {...props} />;
}

export function TextArea({ name, label, hint, required, className, defaultValue, placeholder, rows = 3 }: InputProps & { rows?: number }) {
  const t = useT();
  const { state } = useFormState();
  const err = state?.errors?.[name];
  return (
    <Field label={label} name={name} hint={hint} required={required} className={className}>
      <textarea
        id={`f-${name}`}
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder ? t(placeholder) : undefined}
        aria-invalid={!!err}
        className={cx("input", err && "input-error")}
      />
    </Field>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectInput({
  name,
  label,
  hint,
  required,
  className,
  options,
  defaultValue,
  placeholder,
  translateOptions = false,
  onChange,
}: {
  name: string;
  label?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  options: Option[];
  defaultValue?: string | null;
  placeholder?: string;
  translateOptions?: boolean;
  onChange?: (v: string) => void;
}) {
  const t = useT();
  const { state } = useFormState();
  const err = state?.errors?.[name];
  return (
    <Field label={label} name={name} hint={hint} required={required} className={className}>
      <select
        id={`f-${name}`}
        name={name}
        defaultValue={defaultValue ?? ""}
        aria-invalid={!!err}
        className={cx("input pr-8", err && "input-error")}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      >
        {placeholder !== undefined && <option value="">{t(placeholder || "Select…")}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {translateOptions ? t(o.label) : o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Checkbox({ name, label, defaultChecked, hint, value }: { name: string; label: string; defaultChecked?: boolean; hint?: string; value?: string }) {
  const t = useT();
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
      <input type="checkbox" name={name} value={value ?? "on"} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-brand-600" />
      <span>
        {t(label)}
        {hint && <span className="block text-[12px] text-ink-3">{t(hint)}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  name?: string;
  value?: string;
}) {
  const t = useT();
  const { pending } = useFormState();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size, className)} name={name} value={value}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {typeof children === "string" ? t(children) : children}
    </button>
  );
}

export function FormError() {
  const { state } = useFormState();
  if (!state || state.ok || !state.message) return null;
  return <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">{state.message}</div>;
}

export function Hidden({ name, value }: { name: string; value: string | number | null | undefined }) {
  return <input type="hidden" name={name} value={value ?? ""} />;
}

export function FormGrid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  return (
    <div className={cx("grid gap-4", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4", className)}>
      {children}
    </div>
  );
}

export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-wrap items-center justify-end gap-2 pt-2", className)}>{children}</div>;
}

/** Shows a one-time link returned by an action (e.g. an invitation link when e-mail is not configured). */
export function ResultLink() {
  const t = useT();
  const { state } = useFormState();
  const link = (state?.data as { link?: string } | undefined)?.link;
  if (!state?.ok || !link) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
      <div className="font-medium">{t("Shown only once — copy it now:")}</div>
      <div className="mt-1 flex gap-2">
        <input readOnly value={link} className="input h-8 flex-1 font-mono text-[11.5px]" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="h-8 rounded-md border border-line bg-white px-2.5 text-[12px] font-medium" onClick={() => navigator.clipboard?.writeText(link)}>
          {t("Copy")}
        </button>
      </div>
    </div>
  );
}
