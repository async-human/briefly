"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import { StaggerHeadline } from "./StaggerHeadline";
import { ArrowRightIcon } from "./icons";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function CTA() {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-80px", amount: 0.35 });
  const duration = reducedMotion ? 0.01 : 0.52;
  const scaleFrom = reducedMotion ? 1 : 0.96;

  return (
    <section className="cta-linear landing-section landing-band-accent" id="start">
      <div className="cta-linear-glow" aria-hidden />
      <div className="landing-section-inner cta-linear-inner" ref={ref}>
        <motion.div
          className="cta-linear-content"
          initial={{ opacity: 0, scale: scaleFrom }}
          animate={inView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: scaleFrom }}
          transition={{ duration, ease: EASE }}
        >
          <div className="section-header-centered">
            <p className="section-eyebrow">Get started</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text="Built for mornings. Available tonight."
            />
            <p className="section-body">
              Connect your sources once. Briefly runs on your schedule — your first
              briefing is ready when you are.
            </p>
          </div>

          <motion.div
            className="cta-linear-actions"
            initial={{ opacity: 0, y: 10 }}
            animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: duration * 0.85, delay: reducedMotion ? 0 : 0.12, ease: EASE }}
          >
            <a href="/login" className="btn-light-primary">
              Start free
              <span className="btn-arrow" aria-hidden>
                <ArrowRightIcon size={14} />
              </span>
            </a>
            <a href="#pricing" className="btn-light-ghost">
              See pricing
            </a>
          </motion.div>
          <p className="cta-linear-fine">Free to start · No credit card required</p>
        </motion.div>
      </div>
    </section>
  );
}
