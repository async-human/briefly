"use client";

import React from "react";
import { Reveal } from "./Reveal";
import { StaggerHeadline } from "./StaggerHeadline";

const InboxGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M4 13l2.5-7h11L20 13M4 13v5h16v-5M4 13h5l1 2h4l1-2h5" strokeLinejoin="round" />
  </svg>
);

const ThreadGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="5" cy="12" r="2.2" />
    <circle cx="12" cy="6" r="2.2" />
    <circle cx="19" cy="13" r="2.2" />
    <path d="M6.9 11l3.4-3.4M13.6 7.3 17 11" strokeLinecap="round" />
  </svg>
);

const TalkGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M4 5h16v11H9l-4 3v-3H4z" strokeLinejoin="round" />
    <path d="M12 8.5v4M9.5 10.5h5" strokeLinecap="round" />
  </svg>
);

const TRIO = [
  {
    title: "Reads everything you follow",
    desc: "Newsletters, RSS, YouTube, Reddit, Gmail. You pick the sources; Briefly does the reading.",
    icon: InboxGlyph,
  },
  {
    title: "Remembers how it connects",
    desc: "Compounding memory links today to everything before it — automatically, with nothing to file.",
    icon: ThreadGlyph,
  },
  {
    title: "Talk to it anywhere",
    desc: "Ask by voice or text, on the web or Telegram, always grounded in your sources — with citations.",
    icon: TalkGlyph,
  },
] as const;

export function WhyBriefly() {
  return (
    <section className="why-briefly landing-section landing-band-base" id="why">
      <div className="landing-section-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Why Briefly</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text={"Not a feed. Not another chatbot."}
            />
            <p className="section-body">
              Other &quot;personal AI&quot; hands you a workbench of tools to wire up and agents to
              manage. Briefly hands you one brief that actually knows what you read — and does the
              upkeep itself.
            </p>
          </div>
        </Reveal>

        <div className="capabilities-grid" style={{ marginTop: "clamp(2.25rem, 4vw, 3.25rem)" }}>
          {TRIO.map((item, i) => (
            <Reveal key={item.title} delay={Math.min(i * 0.06, 0.2)}>
              <article className="capability-card">
                <span className="capability-icon" aria-hidden>
                  {item.icon}
                </span>
                <div className="capability-head">
                  <h3 className="capability-title">{item.title}</h3>
                </div>
                <p className="capability-desc">{item.desc}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
