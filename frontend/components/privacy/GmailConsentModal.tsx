"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type Props = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  ingestionEmail?: string;
};

const POINTS = [
  {
    label: "Discovery",
    tag: "One-time",
    text: "We read sender names and subject lines only — never message bodies — to find newsletters.",
  },
  {
    label: "Ingestion",
    tag: "Ongoing",
    text: "Full content is downloaded only from newsletter senders you explicitly approve.",
  },
  {
    label: "Never accessed",
    tag: "Protected",
    text: "Personal mail, attachments, contacts, and unapproved senders stay untouched.",
  },
  {
    label: "Your control",
    tag: "Always",
    text: "Disconnect anytime — we revoke Google access and delete Gmail-derived content.",
  },
];

export function GmailConsentModal({
  open,
  onCancel,
  onConfirm,
  confirming = false,
  ingestionEmail,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onCancel]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="privacy-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="privacy-modal privacy-modal-gmail"
        role="dialog"
        aria-labelledby="gmail-consent-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="privacy-modal-close"
          onClick={onCancel}
          aria-label="Close"
        >
          ×
        </button>

        <div className="privacy-modal-gmail-head">
          <span className="privacy-modal-gmail-icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5v-11z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M4 7l8 6 8-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <p className="privacy-modal-eyebrow">Before you connect</p>
            <h2 id="gmail-consent-title" className="privacy-modal-title">
              What Briefly does with Gmail
            </h2>
          </div>
        </div>

        <p className="privacy-modal-lead">
          Briefly does <strong>not</strong> read your personal email. Here is exactly what happens:
        </p>

        <ul className="privacy-modal-points">
          {POINTS.map((point) => (
            <li key={point.label} className="privacy-modal-point">
              <span className="privacy-modal-point-check" aria-hidden>✓</span>
              <div className="privacy-modal-point-body">
                <div className="privacy-modal-point-head">
                  <strong>{point.label}</strong>
                  <span className="privacy-modal-point-tag">{point.tag}</span>
                </div>
                <p>{point.text}</p>
              </div>
            </li>
          ))}
        </ul>

        {ingestionEmail ? (
          <div className="privacy-modal-alt-box">
            <p className="privacy-modal-alt">
              Prefer no inbox access? Forward newsletters to{" "}
              <code className="privacy-modal-code">{ingestionEmail}</code> — no Gmail connection needed.
            </p>
          </div>
        ) : null}

        <p className="privacy-modal-foot">
          Read our{" "}
          <Link href="/privacy/data-handling" className="privacy-modal-link" target="_blank">
            How Briefly handles your email
          </Link>{" "}
          for full details. OAuth tokens are encrypted at rest.
        </p>

        <div className="privacy-modal-actions privacy-modal-actions-stack">
          <button
            type="button"
            className="privacy-modal-btn privacy-modal-btn-primary"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? "Redirecting to Google…" : "Continue to Google"}
          </button>
          <button type="button" className="privacy-modal-btn privacy-modal-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
