"use client";

import type { ReactNode } from "react";
import { Reveal } from "./Reveal";
import { StaggerHeadline } from "./StaggerHeadline";

type Capability = {
  title: string;
  desc: string;
  tag?: string;
  icon: ReactNode;
};

const ChatGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M4 5h16v11H9l-4 3v-3H4z" strokeLinejoin="round" />
    <path d="M8 9h8M8 12h5" strokeLinecap="round" />
  </svg>
);

const MicGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M6 11a6 6 0 0012 0M12 17v4M9 21h6" strokeLinecap="round" />
  </svg>
);

const GraphGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="6" cy="7" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <circle cx="17" cy="17" r="2.2" />
    <circle cx="7" cy="17" r="2.2" />
    <path d="M8 8l8 7M16 7L9 16M8 9v6" strokeLinecap="round" />
  </svg>
);

const AudioGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path
      d="M3 11v2M7 8v8M11 5v14M15 9v6M19 11v2"
      strokeLinecap="round"
    />
  </svg>
);

const CaptureGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M7 4h10a1 1 0 011 1v15l-6-3.5L6 20V5a1 1 0 011-1z" strokeLinejoin="round" />
  </svg>
);

const SkipGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M3 6h18M6 12h12M10 18h4" strokeLinecap="round" />
  </svg>
);

const CAPABILITIES: Capability[] = [
  {
    title: "Ask Briefly",
    tag: "Pro",
    desc: "Ask anything you've read. Get a synthesised answer with citations to your own sources — not the open web.",
    icon: ChatGlyph,
  },
  {
    title: "Voice & text brain dump",
    desc: "Drop a thought by voice or text. Briefly folds it into tomorrow's brief and sharpens what it shows you.",
    icon: MicGlyph,
  },
  {
    title: "Knowledge graph",
    tag: "Pro",
    desc: "Every entity, topic, and story thread connected across everything you've read — context resurfaces when it's relevant.",
    icon: GraphGlyph,
  },
  {
    title: "Audio briefings",
    tag: "Pro",
    desc: "Listen to your brief on the commute. Your morning, narrated — same intelligence, hands-free.",
    icon: AudioGlyph,
  },
  {
    title: "Capture from anywhere",
    tag: "Pro",
    desc: "Save any link, PDF, or page with the browser extension. It's indexed and connected like everything else.",
    icon: CaptureGlyph,
  },
  {
    title: "Skip transparency",
    desc: "Reads ~50 items, shows you ~10 — and tells you exactly what it skipped and why. Trust what you see, and what you don't.",
    icon: SkipGlyph,
  },
];

export function Capabilities() {
  return (
    <section className="capabilities landing-section landing-band-base" id="capabilities">
      <div className="capabilities-inner landing-section-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">More than a digest</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text="A second brain you can actually talk to"
            />
            <p className="section-body">
              The morning brief is the surface. Underneath, Briefly is a searchable, growing
              memory of everything you follow — that you can question, feed, and listen to.
            </p>
          </div>
        </Reveal>

        <div className="capabilities-grid">
          {CAPABILITIES.map((cap, i) => (
            <Reveal key={cap.title} delay={Math.min(i * 0.05, 0.25)}>
              <article className="capability-card">
                <span className="capability-icon" aria-hidden>
                  {cap.icon}
                </span>
                <div className="capability-head">
                  <h3 className="capability-title">{cap.title}</h3>
                  {cap.tag && <span className="capability-tag">{cap.tag}</span>}
                </div>
                <p className="capability-desc">{cap.desc}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
