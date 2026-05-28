"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Reveal } from "./Reveal";
import {
  GatherPhase,
  FilterPhase,
  PersonalizePhase,
  DeliverPhase,
} from "./WorkflowCanvas";

const steps = [
  {
    id: "gather",
    index: "01",
    title: "Gather",
    desc: "Pulls from every source you follow overnight",
    duration: 5000,
  },
  {
    id: "filter",
    index: "02",
    title: "Filter",
    desc: "Deduplicates and removes what you've already seen",
    duration: 5000,
  },
  {
    id: "personalize",
    index: "03",
    title: "Personalize",
    desc: "Writes why each story matters to you specifically",
    duration: 5500,
  },
  {
    id: "deliver",
    index: "04",
    title: "Deliver",
    desc: "Your briefing, ready when you wake up",
    duration: 6000,
  },
] as const;

type StepId = (typeof steps)[number]["id"];

export function WorkflowDemo() {
  const [activeStep, setActiveStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [phaseState, setPhaseState] = useState({
    gatherCount: 0,
    filterStage: 0,
    typedChars: 0,
    deliverCount: 0,
  });
  const sectionRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetPhaseState = useCallback(() => {
    setPhaseState({
      gatherCount: 0,
      filterStage: 0,
      typedChars: 0,
      deliverCount: 0,
    });
  }, []);

  const runPhaseAnimation = useCallback((stepId: StepId) => {
    resetPhaseState();

    if (stepId === "gather") {
      let count = 0;
      const interval = setInterval(() => {
        count++;
        setPhaseState((s) => ({ ...s, gatherCount: count }));
        if (count >= 4) clearInterval(interval);
      }, 600);
      return () => clearInterval(interval);
    }

    if (stepId === "filter") {
      const timers = [
        setTimeout(() => setPhaseState((s) => ({ ...s, filterStage: 1 })), 400),
        setTimeout(() => setPhaseState((s) => ({ ...s, filterStage: 2 })), 1200),
        setTimeout(() => setPhaseState((s) => ({ ...s, filterStage: 3 })), 2200),
      ];
      return () => timers.forEach(clearTimeout);
    }

    if (stepId === "personalize") {
      const text =
        "As someone building an agent-based product, the 40% improvement in tool-use reliability changes how much you can trust multi-step chains without human oversight.";
      let chars = 0;
      const interval = setInterval(() => {
        chars += 2;
        setPhaseState((s) => ({ ...s, typedChars: Math.min(chars, text.length) }));
        if (chars >= text.length) clearInterval(interval);
      }, 30);
      return () => clearInterval(interval);
    }

    if (stepId === "deliver") {
      let count = 0;
      const interval = setInterval(() => {
        count++;
        setPhaseState((s) => ({ ...s, deliverCount: count }));
        if (count >= 3) clearInterval(interval);
      }, 700);
      return () => clearInterval(interval);
    }

    return undefined;
  }, [resetPhaseState]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.15 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    setProgress(0);
    const cleanup = runPhaseAnimation(steps[activeStep].id);

    const start = Date.now();
    const duration = steps[activeStep].duration;

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.min(elapsed / duration, 1));
    }, 50);

    const advance = setTimeout(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, duration);

    return () => {
      cleanup?.();
      clearTimeout(advance);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeStep, isVisible, runPhaseAnimation]);

  const currentStep = steps[activeStep];

  return (
    <section className="workflow-section" id="how" ref={sectionRef}>
      <div className="workflow-inner">
        <Reveal>
          <div className="workflow-header">
            <p className="section-label">How it works</p>
            <h2 className="section-title">From noise to your morning read</h2>
            <p className="section-desc">
              Every night, Briefly runs your sources through a pipeline built to find signal — not summarize everything.
            </p>
          </div>
        </Reveal>

        <div className="workflow-layout">
          <div className="workflow-steps">
            {steps.map((step, i) => (
              <button
                key={step.id}
                type="button"
                className={`workflow-step${activeStep === i ? " active" : ""}`}
                onClick={() => setActiveStep(i)}
              >
                <span className="step-index">{step.index}</span>
                <div className="step-info">
                  <div className="step-title">{step.title}</div>
                  <div className="step-desc">{step.desc}</div>
                  {activeStep === i && (
                    <div className="step-progress">
                      <motion.div
                        className="step-progress-bar"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>

          <Reveal delay={0.1}>
            <div className="product-frame">
              <div className="product-chrome">
                <span className="product-chrome-title">briefly</span>
                <span className="product-chrome-status">
                  <span className={`status-pulse${isVisible ? " live" : ""}`} />
                  {currentStep.title.toLowerCase()}
                </span>
              </div>
              <div className="product-body">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  >
                    {currentStep.id === "gather" && (
                      <GatherPhase activeCount={phaseState.gatherCount} />
                    )}
                    {currentStep.id === "filter" && (
                      <FilterPhase stage={phaseState.filterStage} />
                    )}
                    {currentStep.id === "personalize" && (
                      <PersonalizePhase typedChars={phaseState.typedChars} />
                    )}
                    {currentStep.id === "deliver" && (
                      <DeliverPhase visibleCount={phaseState.deliverCount} />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
