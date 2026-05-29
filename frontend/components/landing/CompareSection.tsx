import { Reveal } from "./Reveal";

const tools = [
  {
    name: "Notion / Obsidian",
    what: "Flexible knowledge storage",
    why: "Dies when you stop feeding it. Most users abandon within 3 weeks.",
    briefly: false,
  },
  {
    name: "Feedly / Inoreader",
    what: "RSS reader with AI summaries",
    why: "Still a firehose. Shows everything, decides nothing. You do all the filtering.",
    briefly: false,
  },
  {
    name: "Readwise",
    what: "Resurfaces your highlights",
    why: "Requires you to highlight first. Passive-ish, but still depends on you at input.",
    briefly: false,
  },
  {
    name: "Generic newsletters",
    what: "Curated email digests",
    why: "Same summary for every subscriber. No memory, no personalisation, no learning.",
    briefly: false,
  },
  {
    name: "Briefly",
    what: "Self-building second brain",
    why: "Connects once. Reads everything. Remembers what it showed you. Gets smarter every day.",
    briefly: true,
  },
];

export function CompareSection() {
  return (
    <section className="compare-section" id="compare">
      <div className="compare-inner">
        <Reveal>
          <div className="features-header">
            <p className="section-label">The honest comparison</p>
            <h2 className="section-title">You&apos;ve tried the others</h2>
            <p className="section-desc">
              Every tool either requires your constant attention or shows you everything and lets you drown.
              Briefly is the first one that works without you.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="compare-table">
            <div className="compare-header-row">
              <span className="compare-col-tool">Tool</span>
              <span className="compare-col-what">What it does</span>
              <span className="compare-col-why">Why it fails</span>
            </div>
            {tools.map((tool, i) => (
              <div
                key={tool.name}
                className={`compare-row${tool.briefly ? " compare-row-briefly" : ""}`}
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                <span className="compare-col-tool">
                  {tool.briefly && (
                    <span className="compare-briefly-badge">you are here</span>
                  )}
                  <strong>{tool.name}</strong>
                </span>
                <span className="compare-col-what">{tool.what}</span>
                <span className="compare-col-why">
                  {tool.briefly ? (
                    <span style={{ color: "var(--accent)" }}>{tool.why}</span>
                  ) : (
                    tool.why
                  )}
                </span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
