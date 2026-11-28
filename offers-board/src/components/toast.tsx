"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ToastTone = "success" | "error";

type Toast = { id: number; message: string; tone: ToastTone };

type Push = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<Push | null>(null);

/**
 * One toast stack for the whole app. Mounted in the root layout so any client
 * component can report the result of an action without a page refresh.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<Push>((message, tone = "success") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-coal-soft px-4 py-3 text-sm shadow-[0_18px_40px_-24px_rgba(0,0,0,0.95)] ${
              toast.tone === "error"
                ? "border-ember/60 text-ember"
                : "border-sage/40 text-paper"
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                toast.tone === "error" ? "bg-ember" : "bg-sage"
              }`}
            />
            <p className="flex-1 leading-relaxed">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="text-mute transition hover:text-paper"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Push {
  const context = useContext(ToastContext);
  // Outside the provider nothing is mounted; a no-op keeps call sites simple.
  return context ?? (() => {});
}
