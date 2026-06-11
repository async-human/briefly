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
    <div className={`dash-accordion${open ? " dash-accordion--open" : ""}`}>
      <button
        type="button"
        className="dash-accordion-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="dash-accordion-trigger-text">
          <span className="dash-accordion-title">{title}</span>
          {description && !open && (
            <span className="dash-accordion-desc">{description}</span>
          )}
        </span>
        <span className="dash-accordion-meta">
          {badge && <span className="dash-accordion-badge">{badge}</span>}
          <span className="dash-accordion-chevron" aria-hidden>
            {open ? "−" : "+"}
          </span>
        </span>
      </button>
      {open && (
        <div id={panelId} className="dash-accordion-panel" data-section={id}>
          {children}
        </div>
      )}
    </div>
  );
}
