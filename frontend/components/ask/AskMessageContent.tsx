"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { AskCitation } from "@/lib/api";
import { graphItemUrl, graphThoughtUrl } from "@/lib/graphLinks";

const CITE_RE = /\[S(\d+)\]/g;

function refNumber(ref: string): number {
  const n = parseInt(ref.replace(/^S/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

type ContentPart =
  | { type: "text"; value: string }
  | { type: "cite"; ref: string; citation: AskCitation };

function splitContent(content: string, citations: AskCitation[]): ContentPart[] {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  const parts: ContentPart[] = [];
  let last = 0;
  const re = new RegExp(CITE_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: content.slice(last, match.index) });
    }
    const ref = `S${match[1]}`;
    const citation = byRef.get(ref);
    if (citation) {
      parts.push({ type: "cite", ref, citation });
    } else {
      parts.push({ type: "text", value: match[0] });
    }
    last = match.index + match[0].length;
  }

  if (last < content.length) {
    parts.push({ type: "text", value: content.slice(last) });
  }
  return parts;
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
  const label = citation.source_name?.split(" ")[0] ?? `Source ${n}`;

  return (
    <button
      type="button"
      className="ask-inline-cite"
      title={citation.title}
      aria-label={`Source ${n}: ${citation.title}`}
      onClick={() => openCitation(citation)}
    >
      <span className="ask-inline-cite-num">{n}</span>
      <span className="ask-inline-cite-label">{label}</span>
    </button>
  );
}

const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="ask-md-p">{children}</p>,
  strong: ({ children }) => <strong className="ask-md-strong">{children}</strong>,
  em: ({ children }) => <em className="ask-md-em">{children}</em>,
  ul: ({ children }) => <ul className="ask-md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="ask-md-ol">{children}</ol>,
  li: ({ children }) => <li className="ask-md-li">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} className="ask-md-a" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function AskMessageContent({
  content,
  citations = [],
}: {
  content: string;
  citations?: AskCitation[];
}) {
  const parts = splitContent(content, citations);

  return (
    <div className="ask-md">
      {parts.map((part, i) => {
        if (part.type === "cite") {
          return <InlineCitation key={`cite-${part.ref}-${i}`} citation={part.citation} />;
        }
        const trimmed = part.value.trim();
        if (!trimmed) return null;
        return (
          <ReactMarkdown key={`md-${i}`} components={MD_COMPONENTS}>
            {part.value}
          </ReactMarkdown>
        );
      })}
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
                {!cite.content_id.startsWith("digest-item") ? (
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
