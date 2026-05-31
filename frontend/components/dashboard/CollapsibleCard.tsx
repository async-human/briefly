"use client";

import React from "react";

export function CollapsibleCard({
  label,
  title,
  defaultOpen = false,
  badge,
  children,
}: {
  label: string;
  title: string;
  defaultOpen?: boolean;
  badge?: string | number;
  children: React.ReactNode;
}) {
  return (
    <details className="dash-collapsible dash-card" open={defaultOpen}>
      <summary className="dash-collapsible-summary">
        <div className="dash-collapsible-heading">
          <p className="dash-card-label">{label}</p>
          <h2 className="dash-card-title dash-collapsible-title">{title}</h2>
        </div>
        <span className="dash-collapsible-meta">
          {badge != null && badge !== "" && (
            <span className="dash-collapsible-badge">{badge}</span>
          )}
          <span className="dash-collapsible-chevron" aria-hidden />
        </span>
      </summary>
      <div className="dash-collapsible-body">{children}</div>
    </details>
  );
}
