"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type GmailAccessLogEvent } from "@/lib/api";

const ACTION_LABELS: Record<string, string> = {
  connect: "Connected",
  disconnect: "Disconnected",
  discovery: "Sender discovery",
  ingest: "Newsletter fetch",
  link_extract: "Link extraction",
};

function formatEventTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function DataControls({ ingestionEmail }: { ingestionEmail?: string }) {
  const [log, setLog] = useState<GmailAccessLogEvent[]>([]);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getGmailAccessLog();
      setLog(res.events);
      setGmailConnected(res.connected);
      setGmailEmail(res.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load privacy data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDeleteAccount() {
    if (!deleteEmail.trim()) return;
    setDeleting(true);
    setError("");
    try {
      await api.deleteAccount(deleteEmail.trim());
      window.location.href = "/login?deleted=1";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
      setDeleting(false);
    }
  }

  return (
    <div className="data-controls">
      {error && (
        <div className="data-controls-error" role="alert">
          {error}
        </div>
      )}

      <section className="data-controls-section">
        <h3 className="data-controls-title">How we handle your email</h3>
        <p className="data-controls-desc">
          Plain-English explanation of what Briefly reads, stores, and never touches.
        </p>
        <Link href="/privacy/data-handling" className="data-controls-link">
          Read: How Briefly handles your email →
        </Link>
        {ingestionEmail ? (
          <p className="data-controls-note">
            No Gmail? Forward newsletters to <code>{ingestionEmail}</code> — content is stored the same way,
            without inbox access.
          </p>
        ) : null}
      </section>

      <section className="data-controls-section">
        <h3 className="data-controls-title">Gmail access log</h3>
        <p className="data-controls-desc">
          {gmailConnected
            ? `Connected as ${gmailEmail ?? "your Google account"}. Every Gmail API access Briefly makes is listed here.`
            : "Gmail is not connected. Connect Gmail to see access events here."}
        </p>
        {loading ? (
          <p className="data-controls-muted">Loading…</p>
        ) : log.length === 0 ? (
          <p className="data-controls-muted">No Gmail access events yet.</p>
        ) : (
          <ul className="data-controls-log">
            {log.map((event, i) => (
              <li key={`${event.at}-${i}`} className="data-controls-log-item">
                <span className="data-controls-log-time">{formatEventTime(event.at)}</span>
                <span className="data-controls-log-action">
                  {ACTION_LABELS[event.action] ?? event.action}
                </span>
                <span className="data-controls-log-detail">{event.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="data-controls-section data-controls-danger">
        <h3 className="data-controls-title">Delete account</h3>
        <p className="data-controls-desc">
          Permanently delete your Briefly account and all associated data — briefings, saved content,
          brain dumps, connections, and OAuth tokens. This cannot be undone.
        </p>
        {!showDeleteConfirm ? (
          <button
            type="button"
            className="data-controls-danger-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete my account
          </button>
        ) : (
          <div className="data-controls-delete-form">
            <label className="data-controls-delete-label" htmlFor="delete-confirm-email">
              Type your email to confirm deletion
            </label>
            <input
              id="delete-confirm-email"
              type="email"
              className="onboard-input"
              value={deleteEmail}
              onChange={(e) => setDeleteEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
            <div className="data-controls-delete-actions">
              <button
                type="button"
                className="data-controls-danger-btn"
                disabled={deleting || !deleteEmail.trim()}
                onClick={() => void handleDeleteAccount()}
              >
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
              <button
                type="button"
                className="data-controls-cancel-btn"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteEmail("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
