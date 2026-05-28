import { Reveal } from "./Reveal";

const features = [
  {
    num: "01",
    title: "Written for you",
    desc: "Every item explains why it matters to your work and interests — not why it's generally important.",
  },
  {
    num: "02",
    title: "Memory across days",
    desc: "Updates reference stories from weeks ago. You never lose the thread.",
  },
  {
    num: "03",
    title: "Shows its work",
    desc: "Sources cited on every claim. Skipped items listed at the bottom so you know what you missed.",
  },
];

export function Features() {
  return (
    <section className="features-section" id="features">
      <div className="features-inner">
        <Reveal>
          <div className="features-header">
            <p className="section-label">Why Briefly</p>
            <h2 className="section-title">Not another summary tool</h2>
            <p className="section-desc">
              Most tools compress content. Briefly selects, contextualizes, and writes for one reader — you.
            </p>
          </div>
        </Reveal>

        <div className="features-list">
          {features.map((feature, i) => (
            <Reveal key={feature.num} delay={i * 0.08}>
              <div className="feature-item">
                <p className="feature-num">{feature.num}</p>
                <h3 className="feature-title">{feature.title}</h3>
                <p className="feature-desc">{feature.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
