"use client";

import { Reveal } from "./Reveal";

export function CTA() {
  return (
    <section className="cta-section" id="start">
      <div className="cta-inner">
        <Reveal>
          <h2 className="cta-title">Your second brain starts tonight</h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="cta-sub">
            Connect your accounts in 3 minutes. Briefly runs tonight. Your first personalised briefing lands tomorrow morning at 7am.
          </p>
        </Reveal>
        <Reveal delay={0.15}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <a href="/login" className="btn-primary" style={{ fontSize: 15, padding: "14px 32px" }}>
              Start building yours free
            </a>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Free to start · No credit card · First briefing tomorrow
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.25}>
          <div className="cta-loop">
            {[
              "Connect sources",
              "Briefly reads overnight",
              "Briefing in your inbox",
              "Gets smarter every day",
            ].map((step, i) => (
              <div key={step} className="cta-loop-step">
                <span className="cta-loop-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="cta-loop-label">{step}</span>
                {i < 3 && <span className="cta-loop-arrow">→</span>}
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
