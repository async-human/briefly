"use client";

import { DigestPreview } from "./DigestPreview";

export function Hero() {
  return (
    <section className="hm-hero">
      <div className="hm-hero-copy">
        <p className="hm-hero-kicker">Personal morning briefing</p>
        <h1 className="hm-hero-title">
          Briefly reads your feeds overnight. You read the briefing.
        </h1>
        <p className="hm-hero-lede">
          Connect Gmail, YouTube, Reddit, and RSS once. Each night Briefly collects
          what you follow, merges duplicate stories, scores relevance to your work,
          and writes a cited briefing — without another app to maintain.
        </p>
        <div className="hm-hero-actions">
          <a href="/login" className="hm-btn hm-btn-primary">
            Start free →
          </a>
          <a href="#demo" className="hm-btn hm-btn-text">
            See a sample briefing
          </a>
        </div>
        <p className="hm-hero-note">Free to start · No credit card required</p>
      </div>

      <div className="hm-hero-visual">
        <div className="digest-preview-shell">
          <DigestPreview />
        </div>
      </div>
    </section>
  );
}
