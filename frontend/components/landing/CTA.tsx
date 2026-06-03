"use client";

export function CTA() {
  return (
    <section className="cta-v2" id="start">
      <div className="cta-v2-inner" style={{ maxWidth: 720 }}>
        <h2 className="cta-v2-headline">
          Your second brain
          <br />
          <span className="hero-gradient-text">starts tonight</span>
        </h2>

        <p className="cta-v2-sub">
          Connect your accounts in 3 minutes. Briefly runs tonight.
          Your first personalised briefing lands tomorrow at 7am.
        </p>

        <div className="cta-v2-actions">
          <a href="/login" className="btn-hero-primary btn-cta-large">
            Start building yours free
            <span className="btn-arrow">→</span>
          </a>
          <p className="cta-fine-print">
            Free to start · No credit card · First briefing tomorrow
          </p>
        </div>
      </div>
    </section>
  );
}
