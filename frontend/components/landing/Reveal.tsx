"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef, type ReactNode } from "react";

const REVEAL_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const isInView = useInView(ref, { once: true, margin: "-48px 0px -48px 0px", amount: 0.15 });
  const offset = reducedMotion ? 0 : 8;
  const duration = reducedMotion ? 0.01 : 0.42;
  const cappedDelay = Math.min(delay, 0.36);

  return (
    <motion.div
      ref={ref}
      className={className ? `landing-reveal ${className}` : "landing-reveal"}
      initial={{ opacity: 0, y: offset }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: offset }}
      transition={{ duration, ease: REVEAL_EASE, delay: cappedDelay }}
    >
      {children}
    </motion.div>
  );
}
