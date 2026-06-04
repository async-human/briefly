"use client";

import { Reveal } from "./Reveal";

export function CTA() {
  return (
    <section className="cta-linear landing-section landing-band-accent" id="start">
      <div className="landing-section-inner cta-linear-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Get started</p>
            <h2 className="section-heading">
              Built for mornings. Available tonight.
            </h2>
            <p className="section-body">
              Connect your sources once. Briefly runs on your schedule — your first
              briefing is ready when you are.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <div className="cta-linear-actions">
            <a href="/login" className="btn-light-primary">
              Start free →
            </a>
            <a href="#pricing" className="btn-light-ghost">
              See pricing
            </a>
          </div>
          <p className="cta-linear-fine">Free to start · No credit card required</p>
        </Reveal>
      </div>
    </section>
  );
}
