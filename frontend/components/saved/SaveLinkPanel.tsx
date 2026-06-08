"use client";

import { useState } from "react";
import { api, type BrowserCapture, type UrlCaptureResponse } from "@/lib/api";
import { captureResponseToBrowserCapture, enrichmentConnectionText } from "@/lib/captureUtils";
import { formatCaptureTitle } from "@/lib/formatCaptureTitle";

type SaveLinkPanelProps = {
  initialUrl?: string;
  onSaved: (capture: BrowserCapture) => void;
};

export function SaveLinkPanel({ initialUrl = "", onSaved }: SaveLinkPanelProps) {
  const [url, setUrl] = useState(initialUrl);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<UrlCaptureResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setSaving(true);
    setError("");
    setFeedback(null);

    try {
      const res = await api.captureUrl({
        url: trimmed,
        note: note.trim() || undefined,
      });
      setFeedback(res);
      onSaved(captureResponseToBrowserCapture(res));
      if (!res.already_saved) {
        setNote("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="save-link-panel">
      <form className="save-link-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="save-link-label" htmlFor="save-url">
          Save a link
        </label>
        <p className="save-link-hint">
          Paste a URL or share to Briefly from your phone&apos;s browser — same as the extension.
        </p>
        <input
          id="save-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          className="save-link-input"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={saving}
          required
        />
        <textarea
          className="save-link-note"
          placeholder="Add a thought — optional"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={saving}
          rows={2}
          maxLength={2000}
        />
        <button type="submit" className="dash-btn dash-btn-primary save-link-submit" disabled={saving}>
          {saving ? "Saving…" : "Save to Briefly"}
        </button>
      </form>

      {error ? <p className="save-link-error">{error}</p> : null}

      {feedback ? (
        <div className="save-link-feedback" role="status">
          <p className="save-link-feedback-label">
            {feedback.already_saved ? "Already in Briefly" : "✓ Added to Briefly"}
          </p>
          <p className="save-link-feedback-title" title={feedback.title}>
            {formatCaptureTitle(feedback.title, feedback.url)}
          </p>
          {enrichmentConnectionText(feedback.enrichment) ? (
            <p className="save-link-feedback-connection">
              {enrichmentConnectionText(feedback.enrichment)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
