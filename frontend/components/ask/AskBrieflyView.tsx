"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AskCitation, type AskMessage, type AskThreadSummary } from "@/lib/api";
import { graphItemUrl, graphThoughtUrl } from "@/lib/graphLinks";

const SUGGESTED = [
  "What have I been reading about most this month?",
  "Summarize my active story threads.",
  "What did I save recently that I haven't read yet?",
  "Where did I see something about AI agents?",
];

type AskBrieflyViewProps = {
  initialContentId?: string | null;
  initialDigestItemId?: string | null;
  initialThreadId?: string | null;
  anchorTitle?: string | null;
};

function CitationCard({ cite }: { cite: AskCitation }) {
  const graphHref =
    cite.kind === "brain_dump" || cite.kind === "thought"
      ? graphThoughtUrl(cite.content_id)
      : graphItemUrl(cite.content_id);

  return (
    <div className="ask-citation">
      <div className="ask-citation-head">
        <span className="ask-citation-ref">{cite.ref}</span>
        {cite.source_name ? (
          <span className="ask-citation-source">{cite.source_name}</span>
        ) : null}
      </div>
      <p className="ask-citation-title">{cite.title}</p>
      <p className="ask-citation-snippet">{cite.snippet}</p>
      <div className="ask-citation-actions">
        {cite.url ? (
          <a
            href={cite.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ask-citation-link"
          >
            Open source
          </a>
        ) : null}
        {!cite.content_id.startsWith("digest-item") ? (
          <Link href={graphHref} className="ask-citation-link">
            View in graph
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: AskMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`ask-message${isUser ? " ask-message-user" : " ask-message-assistant"}`}>
      <div className="ask-message-body">
        <p className="ask-message-text">{message.content}</p>
        {!isUser && message.citations && message.citations.length > 0 ? (
          <div className="ask-citations">
            {message.citations.map((c) => (
              <CitationCard key={`${c.ref}-${c.content_id}`} cite={c} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AskBrieflyView({
  initialContentId,
  initialDigestItemId,
  initialThreadId,
  anchorTitle,
}: AskBrieflyViewProps) {
  const [threads, setThreads] = useState<AskThreadSummary[]>([]);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId ?? null);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [scopeTitle, setScopeTitle] = useState(anchorTitle ?? null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const contentId = initialContentId ?? null;
  const digestItemId = initialDigestItemId ?? null;

  const loadThreads = useCallback(() => {
    void api.listAskThreads().then((res) => setThreads(res.threads)).catch(() => {});
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!initialThreadId) return;
    void api
      .getAskThread(initialThreadId)
      .then((res) => {
        setThreadId(res.thread.id);
        setMessages(res.thread.messages);
        if (res.thread.anchor_title) setScopeTitle(res.thread.anchor_title);
      })
      .catch(() => setError("Could not load this conversation."));
  }, [initialThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend(text?: string) {
    const trimmed = (text ?? input).trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError("");
    setInput("");

    const optimistic: AskMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const res = await api.ask({
        message: trimmed,
        thread_id: threadId ?? undefined,
        content_id: contentId ?? undefined,
        digest_item_id: digestItemId ?? undefined,
      });
      setThreadId(res.thread_id);
      setMessages((prev) => [...prev, res.assistant]);
      loadThreads();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m !== optimistic));
      setError(err instanceof Error ? err.message : "Could not get an answer.");
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }

  function startNewThread() {
    setThreadId(null);
    setMessages([]);
    setScopeTitle(anchorTitle ?? null);
    setError("");
  }

  function openThread(id: string) {
    void api
      .getAskThread(id)
      .then((res) => {
        setThreadId(res.thread.id);
        setMessages(res.thread.messages);
        setScopeTitle(res.thread.anchor_title);
        setError("");
      })
      .catch(() => setError("Could not load this conversation."));
  }

  return (
    <div className="ask-layout">
      <aside className="ask-sidebar" aria-label="Past conversations">
        <div className="ask-sidebar-head">
          <h2 className="ask-sidebar-title">Conversations</h2>
          <button type="button" className="ask-new-btn" onClick={startNewThread}>
            New
          </button>
        </div>
        <ul className="ask-thread-list">
          {threads.length === 0 ? (
            <li className="ask-thread-empty">No conversations yet</li>
          ) : (
            threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`ask-thread-item${threadId === t.id ? " is-active" : ""}`}
                  onClick={() => openThread(t.id)}
                >
                  <span className="ask-thread-item-title">{t.title}</span>
                  {t.preview ? (
                    <span className="ask-thread-item-preview">{t.preview}</span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <div className="ask-main">
        <header className="ask-header">
          <div>
            <p className="ask-eyebrow">Ask Briefly</p>
            <h1 className="ask-heading">Your second brain, on demand</h1>
            <p className="ask-sub">
              Answers grounded in your briefings, saves, and brain dumps — with citations.
            </p>
          </div>
        </header>

        {scopeTitle ? (
          <div className="ask-scope-banner" role="status">
            <span className="ask-scope-label">Asking about</span>
            <span className="ask-scope-title">{scopeTitle}</span>
          </div>
        ) : null}

        <div className="ask-messages" aria-live="polite">
          {messages.length === 0 && !sending ? (
            <div className="ask-empty">
              <p className="ask-empty-title">What do you want to know?</p>
              <p className="ask-empty-desc">
                Ask about trends in your reading, connections between topics, or where you saw
                something before.
              </p>
              <div className="ask-suggestions">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="ask-suggestion"
                    onClick={() => void handleSend(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <MessageBubble key={`${m.role}-${i}`} message={m} />)
          )}
          {sending ? (
            <div className="ask-message ask-message-assistant ask-message-pending" role="status">
              <span className="ask-typing">Briefly is thinking…</span>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? <p className="ask-error">{error}</p> : null}

        <form
          className="ask-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
        >
          <textarea
            className="ask-input"
            rows={2}
            placeholder="Ask anything about your reading…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            disabled={sending}
          />
          <button type="submit" className="dash-btn dash-btn-primary ask-send" disabled={sending || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
