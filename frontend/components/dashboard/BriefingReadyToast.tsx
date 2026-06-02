"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

type BriefingReadyToastProps = {
  itemCount: number;
  digestId: string;
  onDismiss: () => void;
  onView: () => void;
};

export function BriefingReadyToast({
  itemCount,
  digestId,
  onDismiss,
  onView,
}: BriefingReadyToastProps) {
  const pathname = usePathname();
  const onToday = pathname === "/dashboard";

  useEffect(() => {
    const timer = setTimeout(onDismiss, 12_000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const countLabel =
    itemCount === 1 ? "1 curated item" : `${itemCount} curated items`;

  return (
    <div className="briefing-ready-toast" role="status" aria-live="polite">
      <div className="briefing-ready-toast-icon" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M20 6 9 17l-5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="briefing-ready-toast-body">
        <p className="briefing-ready-toast-title">Your briefing is ready</p>
        <p className="briefing-ready-toast-desc">
          {countLabel} waiting for you{onToday ? "" : " on Today"}.
        </p>
      </div>
      {!onToday && (
        <Link
          href="/dashboard"
          className="briefing-ready-toast-action"
          onClick={onView}
        >
          View
        </Link>
      )}
      {onToday && (
        <Link
          href={`/dashboard/read/${digestId}`}
          className="briefing-ready-toast-action"
          onClick={onView}
        >
          Read
        </Link>
      )}
      <button
        type="button"
        className="briefing-ready-toast-close"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
