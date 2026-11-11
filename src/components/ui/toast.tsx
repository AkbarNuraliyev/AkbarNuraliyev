"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X, Info } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let listeners: ((t: ToastItem[]) => void)[] = [];
let items: ToastItem[] = [];
let seq = 0;

function emit() {
  for (const l of listeners) l(items);
}

export function toast(kind: ToastKind, message: string) {
  const item = { id: ++seq, kind, message };
  items = [...items, item].slice(-4);
  emit();
  setTimeout(() => dismiss(item.id), kind === "error" ? 8000 : 4500);
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end" aria-live="polite">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-line bg-white px-3.5 py-3 text-sm shadow-lg shadow-slate-900/10"
        >
          {t.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          ) : t.kind === "error" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          )}
          <div className="min-w-0 flex-1 text-ink">{t.message}</div>
          <button onClick={() => dismiss(t.id)} className="text-ink-3 hover:text-ink" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
