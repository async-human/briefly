"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type ConnectionToastState = {
  id: number;
  title: string;
  detail?: string;
};

type ConnectionToastProps = {
  toast: ConnectionToastState | null;
  onDismiss: () => void;
};

export function ConnectionToast({ toast, onDismiss }: ConnectionToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, 5200);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.id}
          className="connection-toast"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          role="status"
          aria-live="polite"
        >
          <span className="connection-toast-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6 9 17l-5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="connection-toast-body">
            <p className="connection-toast-title">{toast.title}</p>
            {toast.detail ? <p className="connection-toast-detail">{toast.detail}</p> : null}
          </div>
          <button
            type="button"
            className="connection-toast-close"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
