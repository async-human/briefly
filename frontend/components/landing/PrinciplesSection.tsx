"use client";

import { Reveal } from "./Reveal";

const principles = [
  {
    num: "01",
    title: "Connect once. Never maintain.",
    body: "Link Gmail, YouTube, Reddit, and RSS a single time. Briefly ingests your streams every night — no saving, tagging, or inbox zero required.",
    tag: "Zero friction",
  },
  {
    num: "02",
    title: "We read the firehose for you.",
    body: "Newsletters pile up. Subreddits scroll by. Videos upload overnight. While you sleep, specialized agents collect, clean, and score everything.",
    tag: "Nightly pipeline",
  },
  {
    num: "03",
    title: "One story, one entry.",
    body: "The same headline across five sources becomes a single cited summary. Cross-source deduplication — signal without the noise.",
    tag: "Synthesis",
  },
  {
    num: "04",
    title: "Every item answers why you.",
    body: "Not why it's generally important — why it matters to your role, your goals, and what you read last week. Personal relevance on every line.",
    tag: "Why it matters",
  },
  {
    num: "05",
    title: "Ten items, not fifty.",
    body: "Briefly reads dozens and shows only what fits your morning. Every skip is logged with a reason — so you trust what you see and what you don't.",
    tag: "Confident curation",
  },
  {
    num: "06",
    title: "Smarter with every briefing.",
    body: "Clicks, saves, and follow-ups shape what lands tomorrow. New sources are suggested as your interests evolve. Memory that compounds.",
    tag: "Continuous learning",
  },
] as const;

function PrincipleRow({
  principle,
}: {
  principle: (typeof principles)[number];
  index?: number;
}) {
  return (
    <li className="principle-row">
      <span className="principle-num" aria-hidden>
        {principle.num}
      </span>
      <div className="principle-body">
        <div className="principle-head">
          <h3 className="principle-title">{principle.title}</h3>
          <span className="principle-tag">{principle.tag}</span>
        </div>
        <p className="principle-desc">{principle.body}</p>
      </div>
    </li>
  );
}

export function PrinciplesSection() {
  return (
    <section className="principles-section" id="why">
      <div className="principles-inner">
        <div className="principles-layout">
          <Reveal className="principles-intro">
            <p className="section-eyebrow">Why Briefly</p>
            <h2 className="principles-headline">
              A chief-of-staff briefing,
              <br />
              <span className="hero-light-gradient">not another app to maintain.</span>
            </h2>
            <p className="principles-lede">
              Briefly is built on a simple promise: your information diet runs itself.
              You wake up informed — without highlighting, filing, or drowning in tabs.
            </p>
            <div className="principles-pullquote" aria-hidden>
              <span className="principles-pullquote-mark">&ldquo;</span>
              <p>Connect once. Read ten. Trust the rest.</p>
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <ol className="principles-list">
              {principles.map((p) => (
                <PrincipleRow key={p.num} principle={p} />
              ))}
            </ol>
            <p className="principles-footnote">
              Every item links to its original source. Claims are verified before delivery — no black-box paraphrasing.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
