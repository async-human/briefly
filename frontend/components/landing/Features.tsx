import { Reveal } from "./Reveal";

const features = [
  {
    num: "01",
    title: "Builds itself while you sleep",
    desc: "Connect Gmail, YouTube, Reddit, and any RSS feed once. Every night, Briefly fetches everything automatically. No saving, tagging, or organising — ever.",
  },
  {
    num: "02",
    title: "Remembers what you read",
    desc: "Today's story gets connected to what you read last week. \"Update to the thread you've been following since March.\" The reading finally compounds.",
  },
  {
    num: "03",
    title: "Written specifically for you",
    desc: "Every item explains why it matters to your role, goals, and history — not why it's generally important. Your briefing reads nothing like anyone else's.",
  },
  {
    num: "04",
    title: "Confident, not comprehensive",
    desc: "Briefly reads 50 items and shows you 10. Then tells you exactly what it skipped and why. You know what you're missing. That's the point.",
  },
];

export function Features() {
  return (
    <section className="features-section" id="features">
      <div className="features-inner">
        <Reveal>
          <div className="features-header">
            <p className="section-label">Why Briefly</p>
            <h2 className="section-title">Not another tool to maintain</h2>
            <p className="section-desc">
              Notion dies when you stop feeding it. Feedly is a firehose. Readwise needs you to highlight first.
              Briefly needs nothing from you except the accounts you already have.
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
