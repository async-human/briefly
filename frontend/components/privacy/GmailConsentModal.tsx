"use client";

import Link from "next/link";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  ingestionEmail?: string;
};

export function GmailConsentModal({
  open,
  onCancel,
  onConfirm,
  confirming = false,
  ingestionEmail,
}: Props) {
  if (!open) return null;

  return (
    <div className="privacy-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="privacy-modal"
        role="dialog"
        aria-labelledby="gmail-consent-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gmail-consent-title" className="privacy-modal-title">
          What Briefly does with Gmail
        </h2>
        <p className="privacy-modal-lead">
          Briefly does <strong>not</strong> read your personal email. Here is exactly what happens:
        </p>
        <ul className="privacy-modal-list">
          <li>
            <strong>Discovery (one-time scan):</strong> We read sender names and subject lines only —
            never message bodies — to find newsletters in your inbox.
          </li>
          <li>
            <strong>Ingestion (ongoing):</strong> We download full content only from newsletter senders
            you explicitly approve.
          </li>
          <li>
            <strong>Never accessed:</strong> Personal mail, attachments, contacts, or emails from senders
            you did not approve.
          </li>
          <li>
            <strong>Your control:</strong> Disconnect anytime — we revoke Google access and delete
            Gmail-derived content from Briefly.
          </li>
        </ul>
        {ingestionEmail ? (
          <p className="privacy-modal-alt">
            Prefer no inbox access? Forward newsletters to{" "}
            <code className="privacy-modal-code">{ingestionEmail}</code> instead — no Gmail connection needed.
          </p>
        ) : null}
        <p className="privacy-modal-foot">
          Read our{" "}
          <Link href="/privacy/data-handling" className="privacy-modal-link" target="_blank">
            How Briefly handles your email
          </Link>{" "}
          page for full details. OAuth tokens are encrypted at rest.
        </p>
        <div className="privacy-modal-actions">
          <button type="button" className="privacy-modal-btn privacy-modal-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="privacy-modal-btn privacy-modal-btn-primary"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? "Redirecting…" : "Continue to Google"}
          </button>
        </div>
      </div>
    </div>
  );
}
