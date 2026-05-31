"use client";

import { useState } from "react";
import type { ReactNode } from "react";

// ── Brand SVG definitions ─────────────────────────────────────────────────────

function YouTubeSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5a3 3 0 0 0-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8z" fill="#FF0000"/>
      <path d="M9.6 15.6V8.4l6.2 3.6-6.2 3.6z" fill="#fff"/>
    </svg>
  );
}

function GmailSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M2 6.5C2 5.4 2.9 4.5 4 4.5h16c1.1 0 2 .9 2 2v11c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6.5z" fill="#fff" stroke="#e0e0e0" strokeWidth="0.5"/>
      <path d="M2 6.5l10 7 10-7" stroke="#EA4335" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M2 6.5L12 13.5" stroke="#34A853" strokeWidth="1.5"/>
      <path d="M22 6.5L12 13.5" stroke="#4285F4" strokeWidth="1.5"/>
      <path d="M4 19.5V9.5L12 14.5 20 9.5V19.5" fill="#fff"/>
      <path d="M4 9.5L12 14.5 20 9.5" stroke="#FBBC04" strokeWidth="0.5" fill="none"/>
    </svg>
  );
}

function RedditSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#FF4500"/>
      <path d="M20 12a2 2 0 0 0-2-2 2 2 0 0 0-1.3.5C15.5 9.7 14 9.2 12.3 9.1l.9-4.1 2.8.6a1.4 1.4 0 1 0 .1-.6L13.2 4.4l-1 4.7c-1.7.1-3.2.6-4.4 1.4A2 2 0 0 0 4 12a2 2 0 0 0 .9 1.7 4 4 0 0 0 0 .6c0 2.8 3.2 5 7.1 5s7.1-2.2 7.1-5a4 4 0 0 0 0-.6A2 2 0 0 0 20 12zm-13.5.8a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0zm6.8 3.2a4 4 0 0 1-2.3.6 4 4 0 0 1-2.3-.6.3.3 0 0 1 .4-.4 3.4 3.4 0 0 0 1.9.5 3.4 3.4 0 0 0 1.9-.5.3.3 0 0 1 .4.4zm-.3-2a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0z" fill="#fff"/>
    </svg>
  );
}

function RssSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="24" height="24" rx="5" fill="#F26522"/>
      <circle cx="6.5" cy="17.5" r="2.5" fill="#fff"/>
      <path d="M4 12.5a7.5 7.5 0 0 1 7.5 7.5h2.5A10 10 0 0 0 4 10v2.5z" fill="#fff"/>
      <path d="M4 7A13 13 0 0 1 17 20h2.5A15.5 15.5 0 0 0 4 4.5V7z" fill="#fff"/>
    </svg>
  );
}

function HackerNewsSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="24" height="24" rx="3" fill="#FF6600"/>
      <path d="M6 5l4 7.5V19h4v-6.5L18 5h-2.5L12 11.5 8.5 5z" fill="#fff"/>
    </svg>
  );
}

function SubstackSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="24" height="24" rx="4" fill="#FF6719"/>
      <path d="M4 7.5h16v2H4zM4 11.5h16v2H4zM4 15.5l8 4 8-4V17H4z" fill="#fff"/>
    </svg>
  );
}

function ReadwiseSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="24" height="24" rx="4" fill="#3B82F6"/>
      <path d="M6 17V8h12l-4 4.5 4 4.5H6z" fill="#fff" opacity="0.9"/>
    </svg>
  );
}

function EmailSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="3" fill="#6B7280"/>
      <path d="M2 8l10 7 10-7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function WebSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="#6B7280" strokeWidth="1.5"/>
      <path d="M2.5 12h19M12 2.5c-3 3-4.5 6-4.5 9.5s1.5 6.5 4.5 9.5M12 2.5c3 3 4.5 6 4.5 9.5s-1.5 6.5-4.5 9.5" stroke="#6B7280" strokeWidth="1.5"/>
    </svg>
  );
}

function TwitterSvg({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="24" height="24" rx="4" fill="#000"/>
      <path d="M17.5 4h2.6l-5.7 6.5L21 20h-5.2l-4.1-5.4L6.9 20H4.3l6.1-7L4 4h5.3l3.7 4.9L17.5 4zm-.9 14.4h1.4L7.5 5.5H6l10.6 12.9z" fill="#fff"/>
    </svg>
  );
}

// ── Favicon fallback for arbitrary RSS feeds ──────────────────────────────────

function FaviconImg({
  domain, size, fallback,
}: { domain: string; size: number; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
      width={size}
      height={size}
      style={{ borderRadius: 4, flexShrink: 0, display: "block" }}
      onError={() => setFailed(true)}
      alt=""
      aria-hidden
    />
  );
}

// ── Initials pill for truly unknown sources ───────────────────────────────────

function InitialsPill({ name, size }: { name: string; size: number }) {
  const words = name.trim().split(/\s+/);
  const initials = words.length === 1
    ? name.slice(0, 2).toUpperCase()
    : words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const hue = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.2),
        background: `hsl(${hue}, 44%, 42%)`,
        color: "#fff",
        fontSize: Math.floor(size * 0.44),
        fontFamily: "var(--mono, monospace)",
        fontWeight: 700,
        flexShrink: 0,
        letterSpacing: "-0.02em",
        userSelect: "none",
      }}
    >
      {initials}
    </span>
  );
}

// ── Core lookup tables ────────────────────────────────────────────────────────

type IconFn = (size: number) => ReactNode;

const TYPE_MAP: Record<string, IconFn> = {
  youtube:         (s) => <YouTubeSvg size={s} />,
  youtube_account: (s) => <YouTubeSvg size={s} />,
  gmail:           (s) => <GmailSvg size={s} />,
  reddit:          (s) => <RedditSvg size={s} />,
  reddit_account:  (s) => <RedditSvg size={s} />,
  rss:             (s) => <RssSvg size={s} />,
  email:           (s) => <EmailSvg size={s} />,
  url:             (s) => <WebSvg size={s} />,
  readwise:        (s) => <ReadwiseSvg size={s} />,
  twitter:         (s) => <TwitterSvg size={s} />,
};

// Ordered: first match wins. Entries are [substring-to-match, iconFn].
const NAME_MAP: [string, IconFn][] = [
  ["hacker news",  (s) => <HackerNewsSvg size={s} />],
  ["hackernews",   (s) => <HackerNewsSvg size={s} />],
  ["ycombinator",  (s) => <HackerNewsSvg size={s} />],
  ["substack",     (s) => <SubstackSvg size={s} />],
  ["readwise",     (s) => <ReadwiseSvg size={s} />],
  ["youtube",      (s) => <YouTubeSvg size={s} />],
  ["gmail",        (s) => <GmailSvg size={s} />],
  ["reddit",       (s) => <RedditSvg size={s} />],
  ["twitter",      (s) => <TwitterSvg size={s} />],
  ["rss",          (s) => <RssSvg size={s} />],
];

function matchName(name: string, size: number): ReactNode | null {
  const lower = name.toLowerCase();
  for (const [key, fn] of NAME_MAP) {
    if (lower.includes(key)) return fn(size);
  }
  return null;
}

// ── Public component ──────────────────────────────────────────────────────────

export type SourceIconProps = {
  /** Connector source type ("youtube", "rss", "gmail", …) */
  type?: string | null;
  /** Human-readable source name ("Hacker News", "YourStory", …) */
  name?: string | null;
  /** Article or feed URL — used to extract domain for favicon fallback */
  url?: string | null;
  /** Icon size in px (default 18) */
  size?: number;
  className?: string;
};

export function SourceIcon({ type, name, url, size = 18, className }: SourceIconProps) {
  const inner = resolveIcon(type, name, url, size);
  if (!className) return <>{inner}</>;
  return <span className={className} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>{inner}</span>;
}

function resolveIcon(
  type: string | null | undefined,
  name: string | null | undefined,
  url: string | null | undefined,
  size: number,
): ReactNode {
  // 1. Name-based override (catches "Hacker News" RSS feeds, etc.)
  if (name) {
    const named = matchName(name, size);
    if (named) return named;
  }

  // 2. Source-type icon
  if (type && TYPE_MAP[type]) {
    return TYPE_MAP[type](size);
  }

  // 3. Domain favicon for RSS / URL sources
  if (url) {
    try {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      const fallback = name
        ? <InitialsPill name={name} size={size} />
        : <RssSvg size={size} />;
      return <FaviconImg domain={domain} size={size} fallback={fallback} />;
    } catch { /* invalid URL — fall through */ }
  }

  // 4. Initials pill
  if (name) return <InitialsPill name={name} size={size} />;

  // 5. Generic web icon
  return <WebSvg size={size} />;
}
