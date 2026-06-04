"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Reveal } from "./Reveal";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

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
    body: "Not why it's generally important — why it matters to your role, your goals, and what you read last week.",
    tag: "Why it matters",
  },
  {
    num: "05",
    title: "Curated, not comprehensive.",
    body: "Briefly reads widely and shows what fits your morning. Skipped items come with a reason — so you trust what you see and what you don't.",
    tag: "Confident curation",
  },
  {
    num: "06",
    title: "Smarter with every briefing.",
    body: "Clicks, saves, and follow-ups shape what lands tomorrow. Memory compounds as your interests evolve.",
    tag: "Continuous learning",
  },
] as const;

function PrincipleRow({
  principle,
  index,
}: {
  principle: (typeof principles)[number];
  index: number;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.li
      ref={ref}
      className="principle-row"
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, delay: index * 0.05, ease: EASE }}
    >
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
    </motion.li>
  );
}

export function PrinciplesSection() {
  return (
    <section className="principles-section landing-section" id="why">
      <div className="landing-section-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Why Briefly</p>
            <h2 className="section-heading">
              A chief-of-staff briefing, not another app to maintain.
            </h2>
            <p className="section-body">
              Briefly is built on a simple promise: your information diet runs itself.
              You wake up informed — without highlighting, filing, or drowning in tabs.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <ol className="principles-list">
            {principles.map((p, i) => (
              <PrincipleRow key={p.num} principle={p} index={i} />
            ))}
          </ol>
          <p className="principles-footnote">
            Every item links to its original source. Claims are verified before delivery.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
