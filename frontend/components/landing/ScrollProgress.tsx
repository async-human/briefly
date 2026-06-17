"use client";

import { motion, useScroll, useSpring } from "framer-motion";

/** Thin violet progress rail pinned to the very top of the page. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    restDelta: 0.001,
  });

  return <motion.div className="landing-scroll-progress" style={{ scaleX }} aria-hidden />;
}
