"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { AskCitation } from "@/lib/api";
import { graphItemUrl, graphThoughtUrl } from "@/lib/graphLinks";

function refNumber(ref: string): number {
  const n = parseInt(ref.replace(/^S/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Turn [S1] markers into markdown links so citations stay inline inside paragraphs/lists. */
function preprocessCitationMarkdown(content: string, citations: AskCitation[]): string {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  return content.replace(/\[S(\d+)\]/g, (match, num: string) => {
    const ref = `S${num}`;
    if (!byRef.has(ref)) return match;
    return `[${num}](#cite-${ref})`;
  });
}

function scrollToCitation(ref: string) {
  const el = document.getElementById(`ask-cite-${ref}`);
  el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  el?.classList.add("ask-citation-highlight");
  window.setTimeout(() => el?.classList.remove("ask-citation-highlight"), 1600);
}

function openCitation(citation: AskCitation) {
  window.dispatchEvent(new CustomEvent("briefly:ask-cite", { detail: citation.ref }));
  window.setTimeout(() => scrollToCitation(citation.ref), 40);
}

function InlineCitation({ citation }: { citation: AskCitation }) {
  const n = refNumber(citation.ref);

  return (
    <button
      type="button"
      className="ask-inline-cite"
      title={`${citation.source_name ?? "Source"}: ${citation.title}`}
      aria-label={`Source ${n}: ${citation.title}`}
      onClick={() => openCitation(citation)}
    >
      {n}
    </button>
  );
}

function createMdComponents(citations: AskCitation[]): Components {
  const byRef = new Map(citations.map((c) => [c.ref, c]));

  return {
    p: ({ children }) => <p className="ask-md-p">{children}</p>,
    strong: ({ children }) => <strong className="ask-md-strong">{children}</strong>,
    em: ({ children }) => <em className="ask-md-em">{children}</em>,
    ul: ({ children }) => <ul className="ask-md-ul">{children}</ul>,
    ol: ({ children }) => <ol className="ask-md-ol">{children}</ol>,
    li: ({ children }) => <li className="ask-md-li">{children}</li>,
    a: ({ href, children }) => {
      if (href?.startsWith("#cite-")) {
        const ref = href.slice("#cite-".length);
        const citation = byRef.get(ref);
        if (citation) return <InlineCitation citation={citation} />;
      }
      return (
        <a href={href} className="ask-md-a" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
  };
}

export function AskMessageContent({
  content,
  citations = [],
}: {
  content: string;
  citations?: AskCitation[];
}) {
  const markdown = preprocessCitationMarkdown(content, citations);

  return (
    <div className="ask-md">
      <ReactMarkdown components={createMdComponents(citations)}>{markdown}</ReactMarkdown>
    </div>
  );
}

export function CitationSources({ citations }: { citations: AskCitation[] }) {
  const [openRef, setOpenRef] = useState<string | null>(null);

  useEffect(() => {
    function onCite(event: Event) {
      const ref = (event as CustomEvent<string>).detail;
      if (ref) setOpenRef(ref);
    }
    window.addEventListener("briefly:ask-cite", onCite);
    return () => window.removeEventListener("briefly:ask-cite", onCite);
  }, []);

  if (!citations.length) return null;

  const openCite = citations.find((c) => c.ref === openRef) ?? null;
  const openN = openCite ? refNumber(openCite.ref) : 0;
  const graphHref = openCite
    ? openCite.kind === "brain_dump" || openCite.kind === "thought"
      ? graphThoughtUrl(openCite.content_id)
      : graphItemUrl(openCite.content_id)
    : null;

  return (
    <div className="ask-sources">
      <p className="ask-sources-label">Sources</p>
      <div className="ask-sources-pills">
        {citations.map((cite) => {
          const n = refNumber(cite.ref);
          const isOpen = openRef === cite.ref;
          return (
            <button
              key={`${cite.ref}-${cite.content_id}`}
              id={`ask-cite-${cite.ref}`}
              type="button"
              className={`ask-source-pill${isOpen ? " is-open" : ""}`}
              aria-expanded={isOpen}
              aria-controls={isOpen ? "ask-source-detail" : undefined}
              title={cite.title}
              onClick={() => setOpenRef(isOpen ? null : cite.ref)}
            >
              <span className="ask-source-pill-n">{n}</span>
              <span className="ask-source-pill-title">{cite.title}</span>
            </button>
          );
        })}
      </div>
      {openCite ? (
        <article
          id="ask-source-detail"
          className="ask-source-detail"
        >
          <div className="ask-source-detail-head">
            <span className="ask-source-index">{openN}</span>
            <div className="ask-source-body">
              <span className="ask-source-origin">
                {openCite.source_name ?? (openCite.kind === "brain_dump" ? "Your thought" : "Saved")}
              </span>
              <span className="ask-source-title">{openCite.title}</span>
            </div>
          </div>
          {openCite.snippet ? (
            <p className="ask-source-snippet">{openCite.snippet}</p>
          ) : null}
          <div className="ask-source-actions">
            {openCite.url ? (
              <a
                href={openCite.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ask-source-action"
              >
                Open
              </a>
            ) : null}
            {openCite.content_id && !openCite.content_id.startsWith("digest-item") && graphHref ? (
              <Link href={graphHref} className="ask-source-action">
                Graph
              </Link>
            ) : null}
            <button
              type="button"
              className="ask-source-action ask-source-action-button"
              onClick={() => setOpenRef(null)}
            >
              Close
            </button>
          </div>
        </article>
      ) : null}
    </div>
  );
}
