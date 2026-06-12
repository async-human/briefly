"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { BrainCanvas } from "./BrainCanvas";
import { DigestPreview } from "./DigestPreview";
import { StaggerHeadline } from "./StaggerHeadline";
import { ArrowRightIcon } from "./icons";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();

  // Scroll-linked depth: atmosphere drifts down and fades while the product
  // window lifts slightly faster than the page, so layers separate on scroll
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const meshY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const brainY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const atmosphereOpacity = useTransform(scrollYProgress, [0, 0.65], [1, 0]);
  const introY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const productY = useTransform(scrollYProgress, [0, 1], [0, -36]);

  return (
    <section className="hero-linear landing-band-base" ref={sectionRef}>
      <motion.div
        className="hero-linear-atmosphere"
        aria-hidden
        style={reducedMotion ? undefined : { opacity: atmosphereOpacity }}
      >
        <motion.div
          className="hero-linear-mesh"
          style={reducedMotion ? undefined : { y: meshY }}
        />
        <motion.div
          className="hero-linear-brain"
          style={reducedMotion ? undefined : { y: brainY }}
        >
          <BrainCanvas tone="accent" />
        </motion.div>
      </motion.div>

      <motion.div
        className="hero-linear-intro"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: EASE }}
        style={reducedMotion ? undefined : { y: introY }}
      >
        <p className="hero-linear-eyebrow">
          <a href="#demo">
            <span className="hero-eyebrow-pulse" aria-hidden />
            Morning briefing →
          </a>
        </p>
        <StaggerHeadline
          className="hero-linear-headline"
          text="The intelligence system for everything you follow"
          highlight="intelligence system"
        />
        <motion.p
          className="hero-linear-sub"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.55, ease: EASE }}
        >
          Purpose-built for people who subscribe to too much. Briefly processes the
          newsletters, feeds, and channels you choose — then delivers one sharp,
          cited briefing designed for how you actually consume news.
        </motion.p>
        <motion.div
          className="hero-linear-actions"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.68, ease: EASE }}
        >
          <a href="/login" className="btn-light-primary">
            Start free
            <span className="btn-arrow" aria-hidden>
              <ArrowRightIcon size={14} />
            </span>
          </a>
          <a href="#demo" className="btn-light-ghost">
            See it work
          </a>
        </motion.div>
        <motion.p
          className="hero-linear-fine"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.82, ease: EASE }}
        >
          Free to start · No credit card required
        </motion.p>
      </motion.div>

      <motion.div
        className="hero-linear-product"
        style={reducedMotion ? undefined : { y: productY }}
      >
        <DigestPreview />
      </motion.div>
    </section>
  );
}
