"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AskMessage, type AskThreadSummary } from "@/lib/api";
import { AskMessageContent, CitationSources } from "./AskMessageContent";

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

function MessageBubble({ message }: { message: AskMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`ask-message${isUser ? " ask-message-user" : " ask-message-assistant"}`}>
      {!isUser ? (
        <div className="ask-avatar" aria-hidden>
          B
        </div>
      ) : null}
      <div className="ask-message-body">
        {isUser ? (
          <p className="ask-message-text-user">{message.content}</p>
        ) : (
          <>
            <AskMessageContent content={message.content} citations={message.citations} />
            {message.citations && message.citations.length > 0 ? (
              <CitationSources citations={message.citations} />
            ) : null}
          </>
        )}
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
  const hasConversation = messages.length > 0 || sending;

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
        <header className={`ask-header${hasConversation ? " ask-header-compact" : ""}`}>
          <div>
            <p className="ask-eyebrow">Ask Briefly</p>
            <h1 className="ask-heading">
              {hasConversation ? "Conversation" : "Your second brain, on demand"}
            </h1>
            {!hasConversation ? (
              <p className="ask-sub">
                Grounded answers from your briefings, saves, and brain dumps.
              </p>
            ) : null}
          </div>
        </header>

        {scopeTitle ? (
          <div className="ask-scope-banner" role="status">
            <span className="ask-scope-label">Focused on</span>
            <span className="ask-scope-title">{scopeTitle}</span>
          </div>
        ) : null}

        <div className="ask-messages" aria-live="polite">
          {messages.length === 0 && !sending ? (
            <div className="ask-empty">
              <div className="ask-empty-icon" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 8.5h10M7 12h7M7 15.5h9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M5 5.5h14a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H10l-4.5 3v-3H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
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
            <div className="ask-thread">
              {messages.map((m, i) => (
                <MessageBubble key={`${m.role}-${i}-${m.content.slice(0, 24)}`} message={m} />
              ))}
            </div>
          )}
          {sending ? (
            <div className="ask-message ask-message-assistant ask-message-pending" role="status">
              <div className="ask-avatar" aria-hidden>
                B
              </div>
              <div className="ask-message-body ask-typing-wrap">
                <span className="ask-typing-dots" aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                <span className="ask-typing">Briefly is thinking</span>
              </div>
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
          <div className="ask-composer-inner">
            <textarea
              className="ask-input"
              rows={1}
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
            <button
              type="submit"
              className="ask-send"
              disabled={sending || !input.trim()}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <p className="ask-composer-hint">Enter to send · Shift+Enter for new line</p>
        </form>
      </div>
    </div>
  );
}
