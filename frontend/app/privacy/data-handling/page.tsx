import type { Metadata } from "next";

import { LegalPageShell, type LegalSection } from "@/components/legal/LegalPageShell";

export const metadata: Metadata = {
  title: "How Briefly Handles Your Email — Briefly",
  description:
    "Plain-English explanation of what Briefly reads from Gmail, what it stores, and what it never touches.",
};

const SECTIONS: LegalSection[] = [
  {
    id: "summary",
    title: "The short version",
    paragraphs: [
      "Briefly does not read your personal email. It reads your newsletters — and only the ones you approve.",
      "We use read-only Gmail access to discover newsletter senders (metadata only) and to fetch full newsletter content from senders you explicitly add. Personal mail from your boss, doctor, bank, or family never enters Briefly.",
    ],
  },
  {
    id: "discovery",
    title: "What happens when you connect Gmail",
    list: [
      "Briefly requests read-only Gmail access (gmail.readonly) via Google OAuth.",
      "A one-time discovery scan lists messages matching newsletter signals (List-Unsubscribe headers, known newsletter platforms, subject keywords).",
      "For each candidate message, Briefly reads only metadata: From, Subject, List-Unsubscribe, List-Id, and Precedence. Message bodies are not downloaded during discovery.",
      "You review the list of discovered senders and choose which ones Briefly should follow.",
      "OAuth tokens are encrypted at rest. You can disconnect anytime.",
    ],
  },
  {
    id: "ingestion",
    title: "What Briefly downloads ongoing",
    list: [
      "Full newsletter bodies are fetched only for senders you approved as sources.",
      "Queries are scoped per sender (e.g. from:newsletter@example.com) — not a broad inbox crawl.",
      "During onboarding, Briefly may open a few recent approved newsletters to extract outbound article links for feed discovery. This is logged in your access log.",
      "Newsletter content is stored as RawContent to power your briefings, memory, and Ask Briefly features.",
    ],
  },
  {
    id: "never",
    title: "What Briefly never does",
    list: [
      "Read or store personal emails (non-newsletter messages)",
      "Read attachments, contacts, or calendar data via Gmail (Calendar is a separate, optional connection)",
      "Use your email content for advertising or sell it to third parties",
      "Train public AI models on your email content (we use enterprise/provider terms where available)",
      "Let humans read your email except where strictly necessary for support with your permission",
    ],
  },
  {
    id: "forwarding",
    title: "Alternative: forwarding (no Gmail access)",
    paragraphs: [
      "Every Briefly user has a private ingestion address (shown in Settings). You can forward newsletters to that address or update your subscriptions to send there directly.",
      "Forwarded mail is stored the same way as Gmail-fetched newsletters, but Briefly never needs inbox access. Many users connect Gmail once for discovery, set up forwarding for approved senders, then revoke Gmail access.",
    ],
  },
  {
    id: "disconnect",
    title: "Disconnecting and deleting",
    list: [
      "Disconnect Gmail in Settings revokes Google's OAuth token and removes Gmail-derived sources and stored newsletter bodies fetched via Gmail.",
      "Forwarded-mail content (if any) is kept unless you remove those sources separately.",
      "Delete account in Settings permanently removes all your Briefly data.",
      "You can also email privacy@briefly.app for data subject requests.",
    ],
  },
  {
    id: "log",
    title: "Access log",
    paragraphs: [
      "Settings → Data & privacy shows a log of Gmail API access: when Briefly connected, scanned for senders, fetched newsletters, or disconnected. We built this so you can verify our restraint without reading our source code.",
    ],
  },
  {
    id: "google",
    title: "Google's requirements",
    paragraphs: [
      "Gmail access is subject to Google's Limited Use policy: data is used only for user-facing features you request, not for ads or unrelated purposes. See our Privacy Policy for full legal terms.",
    ],
  },
];

export default function DataHandlingPage() {
  return (
    <LegalPageShell
      title="How Briefly Handles Your Email"
      effectiveDate="June 10, 2026"
      intro="This page explains—in plain language—what Briefly reads from Gmail, what we store, and what we never touch. It matches how the product is built today."
      sections={SECTIONS}
    />
  );
}
