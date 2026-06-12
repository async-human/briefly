"use client";

import type { ReactNode } from "react";

export type IntelSectionTone = "active" | "shifting" | "ignored" | "uncovered" | "emerging";

type Props = {
  title: string;
  hint?: string;
  tone?: IntelSectionTone;
  children: ReactNode;
};

export function IntelSection({ title, hint, tone, children }: Props) {
  const toneClass = tone ? ` intel-doc-section--${tone}` : "";
  return (
    <section className={`intel-doc-section${toneClass}`}>
      <div className="intel-doc-section-head">
        <h3 className="intel-doc-section-title">{title}</h3>
        {hint ? <p className="intel-doc-section-hint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
