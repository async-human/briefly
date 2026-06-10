"use client";

import Link from "next/link";
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
  if (citation.url) {
    window.open(citation.url, "_blank", "noopener,noreferrer");
    return;
  }
  scrollToCitation(citation.ref);
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
  if (!citations.length) return null;

  return (
    <div className="ask-sources">
      <p className="ask-sources-label">Sources</p>
      <div className="ask-sources-list">
        {citations.map((cite) => {
          const n = refNumber(cite.ref);
          const graphHref =
            cite.kind === "brain_dump" || cite.kind === "thought"
              ? graphThoughtUrl(cite.content_id)
              : graphItemUrl(cite.content_id);

          return (
            <article
              key={`${cite.ref}-${cite.content_id}`}
              id={`ask-cite-${cite.ref}`}
              className="ask-source-card"
            >
              <button
                type="button"
                className="ask-source-card-main"
                onClick={() => openCitation(cite)}
              >
                <span className="ask-source-index">{n}</span>
                <div className="ask-source-body">
                  <span className="ask-source-origin">
                    {cite.source_name ?? (cite.kind === "brain_dump" ? "Your thought" : "Saved")}
                  </span>
                  <span className="ask-source-title">{cite.title}</span>
                  <span className="ask-source-snippet">{cite.snippet}</span>
                </div>
              </button>
              <div className="ask-source-actions">
                {cite.url ? (
                  <a
                    href={cite.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ask-source-action"
                  >
                    Open
                  </a>
                ) : null}
                {cite.content_id && !cite.content_id.startsWith("digest-item") ? (
                  <Link href={graphHref} className="ask-source-action">
                    Graph
                  </Link>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
