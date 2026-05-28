import { Reveal } from "./Reveal";

const freeFeatures = [
  "5 sources",
  "5 items per digest",
  "Email + RSS ingestion",
  "7-day history",
];

const proFeatures = [
  "Unlimited sources",
  "Full digest, 10–14 items",
  "All source types",
  "Memory + follow-ups",
  "Interest learning",
];

export function Pricing() {
  return (
    <section className="pricing-section" id="pricing">
      <div className="pricing-inner">
        <Reveal>
          <div className="pricing-header">
            <p className="section-label">Pricing</p>
            <h2 className="section-title">Simple plans</h2>
            <p className="section-desc" style={{ margin: "0 auto" }}>
              Start free. Upgrade when you need more sources and memory.
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
                <li className="disabled">Memory across days</li>
                <li className="disabled">Follow-up questions</li>
              </ul>
              <a href="#waitlist" className="btn-ghost" style={{ display: "flex" }}>
                Get started
              </a>
            </div>

            <div className="pricing-card featured">
              <p className="pricing-name">Pro</p>
              <p className="pricing-amount">$9</p>
              <p className="pricing-period">per month</p>
              <ul className="pricing-features">
                {proFeatures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <a href="#waitlist" className="btn-primary" style={{ display: "flex" }}>
                Start free trial
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
