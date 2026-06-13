"use client";

type Props = {
  used: number;
  limit: number;
  isPro: boolean;
  onUpgrade?: () => void;
};

export function SourceSlotMeter({ used, limit, isPro, onUpgrade }: Props) {
  if (isPro) {
    return (
      <div className="source-slot-meter source-slot-meter-pro">
        <div className="source-slot-meter-head">
          <span className="source-slot-meter-label">Your connections</span>
          <span className="source-slot-meter-value">
            {used} connected · Unlimited
          </span>
        </div>
        <p className="source-slot-meter-hint">
          RSS feeds, newsletters, YouTube channels, subreddits, and websites you follow.
        </p>
      </div>
    );
  }

  const atLimit = used >= limit;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <div className={`source-slot-meter${atLimit ? " is-at-limit" : ""}`}>
      <div className="source-slot-meter-head">
        <span className="source-slot-meter-label">Free plan connections</span>
        <span className="source-slot-meter-value">
          {used} of {limit} used
        </span>
      </div>
      <div
        className="source-slot-meter-bar"
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={`${used} of ${limit} connections used`}
      >
        <div className="source-slot-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="source-slot-meter-hint">
        Each RSS feed, newsletter sender, YouTube channel, subreddit, or website uses one
        connection.
        {atLimit && onUpgrade ? (
          <>
            {" "}
            <button type="button" className="source-slot-meter-upgrade" onClick={onUpgrade}>
              Upgrade for unlimited
            </button>
          </>
        ) : null}
      </p>
      <p className="source-slot-meter-note">
        Gmail and Calendar don&apos;t use a connection slot.
      </p>
    </div>
  );
}
