"use client";

import type { ReactNode } from "react";

export type AppStatChip = {
  value: string | number;
  label: string;
  accent?: boolean;
};

type AppPageHeaderProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  status?: ReactNode;
  actions?: ReactNode;
  stats?: AppStatChip[];
};

export function AppPageHeader({
  eyebrow,
  title,
  subtitle,
  status,
  actions,
  stats,
}: AppPageHeaderProps) {
  return (
    <header className="dash-page-header">
      <div className="dash-page-header-main">
        <p className="dash-page-eyebrow">{eyebrow}</p>
        <h1 className="dash-page-title">{title}</h1>
        {subtitle ? <p className="dash-page-subtitle">{subtitle}</p> : null}
        {status}
      </div>

      {actions ? <div className="dash-page-header-actions">{actions}</div> : null}

      {stats && stats.length > 0 ? (
        <ul className="dash-stat-row" aria-label="Summary">
          {stats.map((chip) => (
            <li
              key={chip.label}
              className={`dash-stat-chip${chip.accent ? " dash-stat-chip-accent" : ""}`}
            >
              <span className="dash-stat-value">{chip.value}</span>
              <span className="dash-stat-label">{chip.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
