import Link from "next/link";
import type { ReactNode } from "react";
import { BrieflyLogo } from "@/components/BrieflyLogo";

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  list?: string[];
  afterList?: string[];
  subsections?: { title: string; paragraphs?: string[]; list?: string[] }[];
};

type LegalPageShellProps = {
  title: string;
  effectiveDate: string;
  intro: string;
  sections: LegalSection[];
  footerNote?: ReactNode;
};

export function LegalPageShell({
  title,
  effectiveDate,
  intro,
  sections,
  footerNote,
}: LegalPageShellProps) {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <div className="legal-header-inner">
          <Link href="/" className="legal-logo">
            <BrieflyLogo variant="full" size="sm" />
          </Link>
          <nav className="legal-header-nav" aria-label="Legal">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="legal-main">
        <article className="legal-article">
          <header className="legal-article-head">
            <p className="legal-eyebrow">Legal</p>
            <h1>{title}</h1>
            <p className="legal-meta">Effective date: {effectiveDate}</p>
            <p className="legal-intro">{intro}</p>
          </header>

          <nav className="legal-toc" aria-label="Table of contents">
            <p className="legal-toc-label">On this page</p>
            <ol>
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.title.replace(/^\d+\.\s*/, "")}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="legal-body">
            {sections.map((section) => (
              <section key={section.id} id={section.id} className="legal-section">
                <h2>{section.title}</h2>
                {section.paragraphs?.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
                {section.list && (
                  <ul>
                    {section.list.map((item) => (
                      <li key={item.slice(0, 48)}>{item}</li>
                    ))}
                  </ul>
                )}
                {section.afterList?.map((p) => (
                  <p key={p.slice(0, 40)}>{p}</p>
                ))}
                {section.subsections?.map((sub) => (
                  <div key={sub.title} className="legal-subsection">
                    <h3>{sub.title}</h3>
                    {sub.paragraphs?.map((p) => (
                      <p key={p.slice(0, 40)}>{p}</p>
                    ))}
                    {sub.list && (
                      <ul>
                        {sub.list.map((item) => (
                          <li key={item.slice(0, 48)}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </div>

          {footerNote && <div className="legal-footer-note">{footerNote}</div>}
        </article>
      </main>

      <footer className="legal-footer">
        <span>© {new Date().getFullYear()} Briefly</span>
        <div className="legal-footer-links">
          <Link href="/">Home</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  );
}
