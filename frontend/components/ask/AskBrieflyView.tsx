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
          <button type="button" className="ask-new-chat-btn" onClick={startNewThread}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
            New chat
          </button>
        </div>
        <ul className="ask-thread-list">
          {threads.length === 0 ? (
            <li className="ask-thread-empty">No chats yet</li>
          ) : (
            threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`ask-thread-item${threadId === t.id ? " is-active" : ""}`}
                  onClick={() => openThread(t.id)}
                >
                  <span className="ask-thread-item-title">{t.title}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      <div className={`ask-main${hasConversation ? " ask-main-chat" : " ask-main-idle"}`}>
        {scopeTitle && hasConversation ? (
          <div className="ask-scope-pill" role="status">
            Focused on <strong>{scopeTitle}</strong>
          </div>
        ) : null}

        <div className="ask-stage">
          <div className="ask-stage-inner">
            {!hasConversation ? (
              <div className="ask-hero">
                <div className="ask-hero-mark" aria-hidden>
                  B
                </div>
                <h1 className="ask-hero-title">What would you like to know?</h1>
                <p className="ask-hero-sub">
                  Answers grounded in your briefings, saves, and brain dumps.
                </p>
                <div className="ask-chips">
                  {SUGGESTED.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="ask-chip"
                      onClick={() => void handleSend(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="ask-messages" aria-live="polite">
                <div className="ask-thread">
                  {messages.map((m, i) => (
                    <MessageBubble key={`${m.role}-${i}-${m.content.slice(0, 24)}`} message={m} />
                  ))}
                </div>
                {sending ? (
                  <div className="ask-message ask-message-assistant ask-message-pending" role="status">
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
            )}

            <div className="ask-footer">
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
                  rows={1}
                  placeholder="Message Briefly…"
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
                      d="M12 19V5M5 12l7-7 7 7"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
