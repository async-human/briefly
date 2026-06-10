"use client";

import type { StoryThread } from "@/lib/api";

type Props = {
  threads: StoryThread[];
};

export function StoryThreadsRail({ threads }: Props) {
  if (!threads.length) return null;

  return (
    <section className="story-threads-rail" aria-label="Stories you are following">
      <header className="story-threads-head">
        <p className="story-threads-eyebrow">Stories you&apos;re following</p>
        <p className="story-threads-sub">Threads Briefly is tracking across your briefings</p>
      </header>
      <ul className="story-threads-list">
        {threads.slice(0, 6).map((thread) => (
          <li key={thread.topic} className="story-thread-card">
            <span className="story-thread-topic">{thread.topic}</span>
            <span className="story-thread-meta">
              {thread.appearances} update{thread.appearances === 1 ? "" : "s"}
              {thread.weeks > 0 ? ` · ${thread.weeks}w` : ""}
            </span>
            {thread.latest && (
              <p className="story-thread-latest">{thread.latest}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
