"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AutoSuggestion, Source } from "@/lib/api";
import { SourcesSidebar } from "./BriefingPanel";

type ConnectionsDrawerProps = {
  open: boolean;
  onClose: () => void;
  ingestionEmail: string;
  sources: Source[];
  gmailConnected: boolean;
  autoSuggestions?: AutoSuggestion[];
  onSourceAdded: (source: Source) => void;
  onSourcesRemoved: (sourceIds: string[]) => void;
  onSourceUpdated?: (source: Source) => void;
  onRediscover?: () => void;
};

export function ConnectionsDrawer({
  open,
  onClose,
  ingestionEmail,
  sources,
  gmailConnected,
  autoSuggestions = [],
  onSourceAdded,
  onSourcesRemoved,
  onSourceUpdated,
  onRediscover,
}: ConnectionsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            className="connections-drawer-backdrop"
            aria-label="Close connections"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="connections-drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connections-drawer-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="connections-drawer-header">
              <div>
                <p className="connections-drawer-eyebrow">Manage</p>
                <h2 id="connections-drawer-title" className="connections-drawer-title">
                  Connections
                </h2>
              </div>
              <button
                type="button"
                className="connections-drawer-close"
                onClick={onClose}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M18 6L6 18M6 6l12 12"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>

            <div className="connections-drawer-body">
              <SourcesSidebar
                ingestionEmail={ingestionEmail}
                sources={sources}
                gmailConnected={gmailConnected}
                autoSuggestions={autoSuggestions}
                onSourceAdded={onSourceAdded}
                onSourcesRemoved={onSourcesRemoved}
                onSourceUpdated={onSourceUpdated}
                onRediscover={onRediscover}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
