"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Reveal } from "./Reveal";
import { StaggerHeadline } from "./StaggerHeadline";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const principles = [
  {
    num: "01",
    title: "Your sources, not the open web.",
    body: "Briefly never crawls the internet for engagement bait. It reads only the newsletters, channels, and communities you chose — your taste is the algorithm.",
    tag: "Curated by you",
  },
  {
    num: "02",
    title: "Ten items, not fifty.",
    body: "Confidence means leaving things out. Every briefing is capped, and every skip is logged with a reason — so you trust what you see and what you don't.",
    tag: "Confident curation",
  },
  {
    num: "03",
    title: "Cited, or it doesn't ship.",
    body: "Every line links back to the original source, and claims are verified before delivery. A briefing you can act on is a briefing you can check.",
    tag: "Verifiable",
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
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.2), ease: EASE }}
    >
      <motion.span
        className="principle-rule"
        aria-hidden
        initial={{ scaleX: 0 }}
        animate={inView ? { scaleX: 1 } : {}}
        transition={{ duration: 0.55, delay: Math.min(index * 0.05, 0.25), ease: EASE }}
      />
      <span className="principle-num" aria-hidden>
        {principle.num}
      </span>
      <motion.div
        className="principle-body"
        initial={{ x: -10, opacity: 0 }}
        animate={inView ? { x: 0, opacity: 1 } : {}}
        transition={{ duration: 0.42, delay: 0.08 + Math.min(index * 0.05, 0.25), ease: EASE }}
      >
        <div className="principle-head">
          <h3 className="principle-title">{principle.title}</h3>
          <span className="principle-tag">{principle.tag}</span>
        </div>
        <p className="principle-desc">{principle.body}</p>
      </motion.div>
    </motion.li>
  );
}

export function PrinciplesSection() {
  return (
    <section className="principles-section landing-section landing-band-warm" id="why">
      <div className="landing-section-inner principles-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Why Briefly</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text="A chief-of-staff briefing, not another app to maintain."
            />
            <p className="section-body">
              Briefly is built on a simple promise: your information diet runs itself.
              You wake up informed — without highlighting, filing, or drowning in tabs.
            </p>
          </div>
        </Reveal>

        <ol className="principles-list">
          {principles.map((p, i) => (
            <PrincipleRow key={p.num} principle={p} index={i} />
          ))}
        </ol>
      </div>
    </section>
  );
}
