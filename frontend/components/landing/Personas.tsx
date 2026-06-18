"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Reveal } from "./Reveal";
import { StaggerHeadline } from "./StaggerHeadline";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const ROTATE_MS = 4200;

type Persona = {
  key: string;
  label: string;
  follows: string;
  source: string;
  headline: string;
  why: string;
};

// Beachhead (founders) first. Examples are illustrative scenarios — no invented
// metrics — showing the same engine producing a personal result per background.
const PERSONAS: Persona[] = [
  {
    key: "founder",
    label: "Founders & operators",
    follows: "Competitors · customers · investors · the market",
    source: "The Information · a competitor's changelog",
    headline: "A competitor just shipped the capability your pitch leans on.",
    why: "You're raising next quarter — this reshapes your differentiation story. Here's the three-line version for your investor update.",
  },
  {
    key: "investor",
    label: "Investors",
    follows: "Portfolio companies · sectors · founders",
    source: "Industry report · portfolio mention",
    headline: "Your portfolio company is named in this morning's sector report.",
    why: "You meet their founder Thursday — here's what changed and two sharp questions to bring.",
  },
  {
    key: "pm",
    label: "Product managers",
    follows: "User communities · changelogs · competitors",
    source: "r/your-market · competitor release notes",
    headline: "The pain point your users keep raising just shipped — in a rival's changelog.",
    why: "It's been building in the community you track all week. Here's the synthesis for standup.",
  },
  {
    key: "engineer",
    label: "Engineers",
    follows: "GitHub · papers · engineering blogs · HN",
    source: "GitHub releases · a dependency you pinned",
    headline: "A library in your stack shipped a breaking change in v3.",
    why: "You pinned v2 three weeks ago — here's the migration delta and whether it actually touches you.",
  },
  {
    key: "researcher",
    label: "Researchers",
    follows: "arXiv · labs · journals",
    source: "arXiv · a thread you've followed",
    headline: "A new paper extends the method you've tracked for weeks.",
    why: "It cites the work you read in March — here's exactly how it moves your thread forward.",
  },
];

export function Personas() {
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { once: false, margin: "-12% 0px" });
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!inView || paused || reducedMotion) return;
    const id = window.setInterval(
      () => setActive((i) => (i + 1) % PERSONAS.length),
      ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, [inView, paused, reducedMotion]);

  const persona = PERSONAS[active];

  return (
    <section
      className="personas-section landing-section landing-band-base"
      id="personas"
      ref={sectionRef}
    >
      <div className="landing-section-inner personas-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Built for how you work</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text="However you work, Briefly knows your world"
            />
            <p className="section-body">
              One engine — your sources, your history. The same Briefly reads a different world for
              each person, so the result is always personal, never generic.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div
            className="personas-stage"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="personas-pills" role="tablist" aria-label="Who Briefly is for">
              {PERSONAS.map((p, i) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={`personas-pill${i === active ? " is-active" : ""}`}
                  onClick={() => setActive(i)}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="personas-card-wrap">
              <AnimatePresence mode="wait">
                <motion.article
                  key={persona.key}
                  className="personas-card"
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                  transition={{ duration: 0.4, ease: EASE }}
                >
                  <p className="personas-follows">
                    <span className="personas-follows-label">You follow</span>
                    {persona.follows}
                  </p>

                  <div className="personas-item">
                    <span className="personas-item-source">{persona.source}</span>
                    <p className="personas-item-headline">{persona.headline}</p>
                    <p className="personas-item-why">
                      <span className="personas-item-why-label">Why it matters to you</span>
                      {persona.why}
                    </p>
                  </div>
                </motion.article>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
