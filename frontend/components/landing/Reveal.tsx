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
  const isInView = useInView(ref, { once: true, margin: "-64px 0px -64px 0px", amount: 0.15 });
  const cappedDelay = Math.min(delay, 0.36);

  const hidden = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 28, scale: 0.97 };
  const shown = reducedMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, scale: 1 };

  return (
    <motion.div
      ref={ref}
      className={className ? `landing-reveal ${className}` : "landing-reveal"}
      initial={hidden}
      animate={isInView ? shown : hidden}
      transition={
        reducedMotion
          ? { duration: 0.01, delay: cappedDelay }
          : { type: "spring", stiffness: 120, damping: 18, mass: 0.7, delay: cappedDelay }
      }
    >
      {children}
    </motion.div>
  );
}
