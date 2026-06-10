"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type ToastState = { message: string; id: number } | null;

const LearnedToastContext = createContext<{
  showLearned: (message: string | null | undefined) => void;
}>({ showLearned: () => {} });

export function LearnedToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);

  const showLearned = useCallback((message: string | null | undefined) => {
    if (!message?.trim()) return;
    const id = Date.now();
    setToast({ message: message.trim(), id });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4200);
  }, []);

  return (
    <LearnedToastContext.Provider value={{ showLearned }}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className="learned-toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            role="status"
          >
            <span className="learned-toast-icon" aria-hidden>✦</span>
            <div>
              <p className="learned-toast-label">Briefly learned</p>
              <p className="learned-toast-text">{toast.message}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </LearnedToastContext.Provider>
  );
}

export function useLearnedToast() {
  return useContext(LearnedToastContext);
}
