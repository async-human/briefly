import { Reveal } from "./Reveal";

const freeFeatures = [
  "3 source connections",
  "5 items per briefing",
  "Gmail, YouTube, Reddit, RSS",
  "7-day history",
  "Email delivery",
];

const proFeatures = [
  "Unlimited source connections",
  "Full briefing, 8–14 items",
  "All source types incl. Readwise",
  "Unlimited history",
  "Interest learning — gets smarter daily",
  "Manual capture: links, notes, docs (V2)",
  "Ask Briefly — search your knowledge base (V3)",
];

export function Pricing() {
  return (
    <section className="pricing-section" id="pricing">
      <div className="pricing-inner">
        <Reveal>
          <div className="pricing-header">
            <p className="section-label">Pricing</p>
            <h2 className="section-title">Start free. Upgrade when it&apos;s indispensable.</h2>
            <p className="section-desc" style={{ margin: "0 auto" }}>
              Free is enough to feel the value. Pro is what it becomes when you can&apos;t live without it.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="pricing-cards">
            <div className="pricing-card">
              <p className="pricing-name">Free</p>
              <p className="pricing-amount">$0</p>
              <p className="pricing-period">forever</p>
              <ul className="pricing-features">
                {freeFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
                <li className="disabled">Manual capture</li>
                <li className="disabled">Ask Briefly</li>
                <li className="disabled">Interest learning</li>
              </ul>
              <a href="/login" className="btn-ghost" style={{ display: "flex" }}>
                Get started free
              </a>
            </div>

            <div className="pricing-card featured">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
                <p className="pricing-name" style={{ margin: 0 }}>Pro</p>
                <span style={{
                  fontSize: 10,
                  fontFamily: "var(--mono)",
                  color: "var(--accent)",
                  border: "1px solid var(--accent-line)",
                  padding: "3px 8px",
                  borderRadius: 100,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}>
                  Save 17%
                </span>
              </div>
              <p className="pricing-amount">$9</p>
              <p className="pricing-period">per month · or $90/year</p>
              <ul className="pricing-features">
                {proFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a href="/login" className="btn-primary" style={{ display: "flex" }}>
                Start free trial
              </a>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, textAlign: "center" }}>
                No credit card required
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", marginTop: 32 }}>
            LLM costs ~$0.20/user/day at scale. Break-even at 400 paying users. Every dollar above that goes into making Briefly smarter.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
