"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CANCELLATION_REASONS, type CancellationReason } from "@/lib/cancellationReasons";

type Props = {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (payload: { reason: CancellationReason; comment: string }) => void;
};

export function CancelSubscriptionModal({ open, busy = false, onClose, onConfirm }: Props) {
  const [mounted, setMounted] = useState(false);
  const [reason, setReason] = useState<CancellationReason>("unused");
  const [comment, setComment] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setReason("unused");
    setComment("");
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  if (!open || !mounted) return null;

  const needsComment = reason === "other";

  return createPortal(
    <div className="cancel-sub-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        className="cancel-sub-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-sub-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="cancel-sub-close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close"
        >
          ×
        </button>

        <p className="cancel-sub-eyebrow">Cancel Pro</p>
        <h2 id="cancel-sub-title" className="cancel-sub-title">
          Before you go…
        </h2>
        <p className="cancel-sub-lead">
          Help us improve Briefly — why are you cancelling? You&apos;ll receive a confirmation
          email once cancellation is processed.
        </p>

        <fieldset className="cancel-sub-reasons" disabled={busy}>
          <legend className="sr-only">Cancellation reason</legend>
          {CANCELLATION_REASONS.map((opt) => (
            <label key={opt.value} className="cancel-sub-reason">
              <input
                type="radio"
                name="cancel-reason"
                value={opt.value}
                checked={reason === opt.value}
                onChange={() => setReason(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </fieldset>

        <label className="cancel-sub-comment-label">
          {needsComment ? "Tell us more (required)" : "Anything else? (optional)"}
          <textarea
            className="cancel-sub-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={busy}
            placeholder={
              needsComment
                ? "What would have made Briefly worth keeping?"
                : "Optional feedback for the team…"
            }
          />
        </label>

        <div className="cancel-sub-actions">
          <button
            type="button"
            className="cancel-sub-keep"
            disabled={busy}
            onClick={onClose}
          >
            Keep Pro
          </button>
          <button
            type="button"
            className="cancel-sub-confirm"
            disabled={busy || (needsComment && !comment.trim())}
            onClick={() =>
              onConfirm({ reason, comment: comment.trim() })
            }
          >
            {busy ? "Cancelling…" : "Confirm cancellation"}
          </button>
        </div>

        <p className="cancel-sub-foot">
          You&apos;ll receive a confirmation email shortly. Pro access continues until your
          current billing period ends.
        </p>
      </div>
    </div>,
    document.body,
  );
}
