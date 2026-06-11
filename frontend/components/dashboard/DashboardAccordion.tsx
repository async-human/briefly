"use client";

import { useId, useState } from "react";

type Props = {
  id: string;
  title: string;
  description?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function DashboardAccordion({
  id,
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={`dash-accordion${open ? " dash-accordion--open" : ""}`} data-section={id}>
      <button
        type="button"
        className="dash-accordion-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dash-accordion-trigger-main">
          <span className="dash-accordion-title">{title}</span>
          {description && (
            <span className="dash-accordion-desc">{description}</span>
          )}
        </span>
        <span className="dash-accordion-meta">
          {badge && <span className="dash-accordion-badge">{badge}</span>}
          <span className="dash-accordion-chevron-wrap" aria-hidden>
            <svg
              className={`dash-accordion-chevron${open ? " dash-accordion-chevron--open" : ""}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </button>
      {open && (
        <div id={panelId} className="dash-accordion-panel" role="region" aria-label={title}>
          <div className="dash-accordion-content">
            <p className="dash-accordion-content-label">Details</p>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
