"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "./Reveal";
import {
  CollectIcon,
  CleanIcon,
  DeduplicateIcon,
  ScoreIcon,
  RememberIcon,
  WriteIcon,
  VerifyIcon,
  DeliverIcon,
} from "./icons";

const steps = [
  {
    number: "01",
    icon: CollectIcon,
    name: "Collect",
    desc: "Ingests from sources you approved — newsletters, RSS, YouTube, Reddit",
  },
  {
    number: "02",
    icon: CleanIcon,
    name: "Clean",
    desc: "Strips boilerplate, extracts signal, normalizes quality",
  },
  {
    number: "03",
    icon: DeduplicateIcon,
    name: "Deduplicate",
    desc: "Groups the same story from 5 sources into one cited entry",
  },
  {
    number: "04",
    icon: ScoreIcon,
    name: "Score",
    desc: "Relevance scored against your profile, history, and interests",
  },
  {
    number: "05",
    icon: RememberIcon,
    name: "Remember",
    desc: "Checks memory — is this new, or an update to a past story?",
  },
  {
    number: "06",
    icon: WriteIcon,
    name: "Write",
    desc: "Writes why each item matters specifically to you",
  },
  {
    number: "07",
    icon: VerifyIcon,
    name: "Verify",
    desc: "Every claim cited back to its exact source — no hallucinations",
  },
  {
    number: "08",
    icon: DeliverIcon,
    name: "Deliver",
    desc: "Sent at your chosen time. Web app and email, both beautiful",
  },
];

export function HowItWorks() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.2 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [isVisible]);

  return (
    <section className="section" id="how" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="section-inner" ref={sectionRef}>
        <Reveal>
          <div className="section-eyebrow">How it works</div>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="section-title">
            Eight agents.
            <br />
            <em>One brilliant briefing.</em>
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="section-sub">
            Every morning at 5am, a pipeline of specialized agents processes your approved sources, filters, deduplicates, and writes your personal digest. You just read it.
          </p>
        </Reveal>

        <Reveal delay={0.2}>
          <div className="pipeline">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.number}
                  className={`pipeline-step${activeStep === index && isVisible ? " active" : ""}`}
                >
                  <div className="step-number">{step.number}</div>
                  <span className="step-icon">
                    <Icon size={18} />
                  </span>
                  <div className="step-name">{step.name}</div>
                  <div className="step-desc">{step.desc}</div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
