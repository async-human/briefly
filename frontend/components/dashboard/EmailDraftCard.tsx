"use client";

import { useState } from "react";
import { api, type EmailDraft } from "@/lib/api";

type Stage = "compose" | "loading" | "review";

// Marker that delimits the optional, deterministic sources footer in the body.
const SOURCES_MARKER = "\n\n—\nSources:\n";

export function EmailDraftCard({
  open,
  onClose,
  contentId,
  defaultInstruction,
}: {
  open: boolean;
  onClose: () => void;
  contentId?: string;
  defaultInstruction?: string;
}) {
  const [stage, setStage] = useState<Stage>("compose");
  const [instruction, setInstruction] = useState(defaultInstruction ?? "");
  const [draft, setDraft] = useState<EmailDraft | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [canCreateDraft, setCanCreateDraft] = useState(false);
  const [includeSources, setIncludeSources] = useState(false);

  if (!open) return null;

  function reset() {
    setStage("compose");
    setInstruction(defaultInstruction ?? "");
    setDraft(null);
    setTo("");
    setSubject("");
    setBody("");
    setError("");
    setBusy(false);
    setIncludeSources(false);
  }

  // Append/strip a deterministic "Sources" footer built from REAL corpus links
  // (never LLM-generated). The body stays editable; toggling off removes it.
  function toggleSources(on: boolean) {
    setIncludeSources(on);
    const list = draft?.sources ?? [];
    setBody((prev) => {
      const idx = prev.indexOf(SOURCES_MARKER);
      const base = idx >= 0 ? prev.slice(0, idx) : prev;
      if (!on || list.length === 0) return base;
      return base + SOURCES_MARKER + list.map((s) => `- ${s.title}: ${s.url}`).join("\n");
    });
  }

  function close() {
    reset();
    onClose();
  }

  async function generate() {
    if (!instruction.trim()) return;
    setStage("loading");
    setError("");
    try {
      const d = await api.composeEmailDraft({
        instruction: instruction.trim(),
        content_id: contentId,
      });
      setDraft(d);
      setTo(d.to_email ?? "");
      setSubject(d.subject);
      setBody(d.body);
      setStage("review");
      void api
        .emailDraftCapabilities()
        .then((c) => {
          setCanSend(c.can_send);
          setCanCreateDraft(c.can_create_draft);
        })
        .catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't draft that — try again.");
      setStage("compose");
    }
  }

  async function send() {
    if (!draft) return;
    if (!to.trim()) {
      setError("Add a recipient before sending.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await persistEdits();
      await api.sendEmailDraft(draft.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed — try Open in Gmail.");
      setBusy(false);
    }
  }

  async function addToGmailDrafts() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await persistEdits();
      await api.draftEmailToGmail(draft.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the Gmail draft — try Open in Gmail.");
      setBusy(false);
    }
  }

  function reconnectGmail() {
    void api
      .startGmailConnect("/dashboard")
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch(() => setError("Could not start Gmail reconnect."));
  }

  async function persistEdits() {
    if (!draft) return;
    await api.editEmailDraft(draft.id, { to_email: to, subject, body }).catch(() => undefined);
  }

  function gmailUrl(): string {
    const u = new URL("https://mail.google.com/mail/");
    u.searchParams.set("view", "cm");
    u.searchParams.set("fs", "1");
    if (to.trim()) u.searchParams.set("to", to.trim());
    u.searchParams.set("su", subject);
    u.searchParams.set("body", body);
    return u.toString();
  }

  async function openInGmail() {
    setBusy(true);
    await persistEdits();
    window.open(gmailUrl(), "_blank", "noopener,noreferrer");
    setBusy(false);
  }

  async function markSent() {
    if (!draft) return;
    setBusy(true);
    await persistEdits();
    await api.markEmailDraftSent(draft.id).catch(() => undefined);
    close();
  }

  async function discard() {
    if (draft) await api.discardEmailDraft(draft.id).catch(() => undefined);
    close();
  }

  return (
    <div className="emaildraft" role="dialog" aria-modal="true" aria-label="Draft an email">
      <button type="button" className="emaildraft-veil" aria-label="Close" onClick={close} />
      <div className="emaildraft-panel">
        <div className="emaildraft-head">
          <div>
            <p className="emaildraft-eyebrow">Grounded email</p>
            <h2 className="emaildraft-title">
              {stage === "review" ? "Review before you send" : "Draft an email"}
            </h2>
          </div>
          <button type="button" className="emaildraft-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>

        {stage !== "review" ? (
          <div className="emaildraft-body">
            <label className="emaildraft-label" htmlFor="emaildraft-instruction">
              What should this email do? Briefly drafts it from what you&apos;ve read.
            </label>
            <textarea
              id="emaildraft-instruction"
              className="emaildraft-textarea"
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. Draft a note to my team about the most important thing in today's brief"
              disabled={stage === "loading"}
              autoFocus
            />
            {error && <p className="emaildraft-msg emaildraft-msg--err">{error}</p>}
            <div className="emaildraft-actions">
              <button
                type="button"
                className="dash-btn dash-btn-primary"
                onClick={generate}
                disabled={stage === "loading" || !instruction.trim()}
              >
                {stage === "loading" ? "Drafting…" : "Draft it"}
              </button>
            </div>
          </div>
        ) : (
          <div className="emaildraft-body">
            {draft?.rationale && <p className="emaildraft-rationale">{draft.rationale}</p>}

            {draft?.source_headlines && draft.source_headlines.length > 0 && (
              <div className="emaildraft-citations">
                <span className="emaildraft-citations-label">Grounded in what you read</span>
                <ul className="emaildraft-citations-list">
                  {draft.source_headlines.slice(0, 4).map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            )}

            <label className="emaildraft-label" htmlFor="emaildraft-to">To</label>
            <input
              id="emaildraft-to"
              className="emaildraft-input"
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@email.com"
            />

            <label className="emaildraft-label" htmlFor="emaildraft-subject">Subject</label>
            <input
              id="emaildraft-subject"
              className="emaildraft-input"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />

            <label className="emaildraft-label" htmlFor="emaildraft-message">Message</label>
            <textarea
              id="emaildraft-message"
              className="emaildraft-textarea"
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />

            {(draft?.sources?.length ?? 0) > 0 && (
              <label className="emaildraft-sources-toggle">
                <input
                  type="checkbox"
                  checked={includeSources}
                  onChange={(e) => toggleSources(e.target.checked)}
                />
                <span>
                  Add sources ({draft?.sources?.length}) as links at the end
                </span>
              </label>
            )}

            <p className="emaildraft-hitl">
              {canCreateDraft
                ? "Briefly puts a ready draft in your Gmail — you review and hit Send."
                : canSend
                  ? "You're the final check — Briefly only sends when you click Send."
                  : "Briefly never sends on its own — review, edit, then send it yourself from Gmail."}
            </p>

            {error && <p className="emaildraft-msg emaildraft-msg--err">{error}</p>}

            <div className="emaildraft-actions">
              {/* Default = the safe act: drop a ready draft into the user's Gmail. */}
              {canCreateDraft ? (
                <button type="button" className="dash-btn dash-btn-primary" onClick={addToGmailDrafts} disabled={busy}>
                  {busy ? "Working…" : "Add to Gmail drafts"}
                </button>
              ) : canSend ? (
                <button type="button" className="dash-btn dash-btn-primary" onClick={send} disabled={busy}>
                  {busy ? "Sending…" : "Send"}
                </button>
              ) : (
                <button type="button" className="dash-btn dash-btn-primary" onClick={openInGmail} disabled={busy}>
                  Open in Gmail →
                </button>
              )}

              {/* Direct send is the opt-in once drafting is the default. */}
              {canCreateDraft && canSend && (
                <button type="button" className="dash-btn dash-btn-secondary" onClick={send} disabled={busy}>
                  {busy ? "Sending…" : "Send now"}
                </button>
              )}

              {(canCreateDraft || canSend) && (
                <button type="button" className="dash-btn dash-btn-secondary" onClick={openInGmail} disabled={busy}>
                  Open in Gmail →
                </button>
              )}

              <button type="button" className="emaildraft-text-btn" onClick={markSent} disabled={busy}>
                Mark as sent
              </button>
              <button type="button" className="emaildraft-text-btn" onClick={() => setStage("compose")} disabled={busy}>
                Redraft
              </button>
              <button type="button" className="emaildraft-text-btn emaildraft-text-btn--danger" onClick={discard} disabled={busy}>
                Discard
              </button>
            </div>

            {!canCreateDraft && (
              <button type="button" className="emaildraft-reconnect" onClick={reconnectGmail}>
                Connect Gmail so Briefly can draft &amp; send for you →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
