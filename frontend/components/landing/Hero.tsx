"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { BrainCanvas } from "./BrainCanvas";
import { DigestPreview } from "./DigestPreview";
import { MagneticButton } from "./MagneticButton";
import { RotatingWord } from "./RotatingWord";
import { ArrowRightIcon } from "./icons";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const ROTATING = ["everything you follow", "your whole inbox", "every feed you trust", "all of it"];

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

  // Cursor-reactive atmosphere — the violet spotlight + orbs track the pointer.
  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (reducedMotion || e.pointerType !== "mouse") return;
    const el = sectionRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty("--hero-mx", `${(px * 100).toFixed(2)}%`);
    el.style.setProperty("--hero-my", `${(py * 100).toFixed(2)}%`);
    el.style.setProperty("--hero-dx", (px - 0.5).toFixed(3));
    el.style.setProperty("--hero-dy", (py - 0.5).toFixed(3));
  };

  return (
    <section
      className="hero-linear landing-band-base"
      ref={sectionRef}
      onPointerMove={handlePointerMove}
    >
      <motion.div
        className="hero-linear-atmosphere"
        aria-hidden
        style={reducedMotion ? undefined : { opacity: atmosphereOpacity }}
      >
        <motion.div
          className="hero-linear-mesh"
          style={reducedMotion ? undefined : { y: meshY }}
        />
        {!reducedMotion && (
          <>
            <span className="hero-cursor-glow" aria-hidden />
            <span className="hero-orb hero-orb-1" aria-hidden />
            <span className="hero-orb hero-orb-2" aria-hidden />
            <span className="hero-orb hero-orb-3" aria-hidden />
          </>
        )}
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
        <h1 className="hero-linear-headline" aria-label="The intelligence system for everything you follow">
          <motion.span
            className="hero-headline-lead"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: EASE }}
          >
            The <span className="headline-shimmer">intelligence system</span> for{" "}
          </motion.span>
          <RotatingWord className="hero-headline-rotate" words={ROTATING} />
        </h1>
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
          <MagneticButton href="/login" className="btn-light-primary">
            Start free
            <span className="btn-arrow" aria-hidden>
              <ArrowRightIcon size={14} />
            </span>
          </MagneticButton>
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
