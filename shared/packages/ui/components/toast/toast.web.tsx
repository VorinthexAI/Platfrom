"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastNotice = { title: string; description?: string; duration?: number };
type ToastRecord = ToastNotice & { id: number };
type ToastContextValue = { dismissToast: (id: number) => void; showToast: (notice: ToastNotice) => number };
const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0);
  const [notices, setNotices] = useState<ToastRecord[]>([]);
  const dismissToast = useCallback((id: number) => setNotices((current) => current.filter((notice) => notice.id !== id)), []);
  const showToast = useCallback((notice: ToastNotice) => {
    nextId.current += 1;
    const id = nextId.current;
    setNotices((current) => [{ ...notice, id }, ...current].slice(0, 3));
    window.setTimeout(() => dismissToast(id), notice.duration ?? 2_000);
    return id;
  }, [dismissToast]);
  return <ToastContext.Provider value={{ dismissToast, showToast }}>
    {children}
    <div aria-live="polite" className="vui-toast-viewport">
      {notices.map((notice, depth) => <div className="vui-toast" key={notice.id} style={{ opacity: 1 - depth * 0.18, transform: `translateY(${depth * -9}px) scale(${1 - depth * 0.035}) rotateX(${depth * 0.8}deg)`, zIndex: 3 - depth }}><strong>{notice.title}</strong>{notice.description ? <span>{notice.description}</span> : null}</div>)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider.");
  return context;
}
