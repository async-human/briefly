"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  hint?: string;
  children: ReactNode;
};

export function IntelSection({ title, hint, children }: Props) {
  return (
    <section className="intel-doc-section">
      <div className="intel-doc-section-head">
        <h3 className="intel-doc-section-title">{title}</h3>
        {hint ? <p className="intel-doc-section-hint">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}
