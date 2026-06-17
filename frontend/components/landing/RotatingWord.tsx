"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type RotatingWordProps = {
  words: string[];
  className?: string;
  interval?: number;
};

/**
 * Cycles through a list of phrases with an elegant vertical flip.
 * The longest word reserves the width so surrounding copy doesn't reflow.
 */
export function RotatingWord({ words, className, interval = 2600 }: RotatingWordProps) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion || words.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % words.length),
      interval
    );
    return () => window.clearInterval(id);
  }, [reducedMotion, words.length, interval]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  if (reducedMotion) {
    return <span className={className}>{words[0]}</span>;
  }

  return (
    <span className={`rotating-word ${className ?? ""}`} aria-live="polite">
      {/* invisible sizer keeps the inline box at the widest phrase */}
      <span className="rotating-word-sizer" aria-hidden>
        {longest}
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={words[index]}
          className="rotating-word-value"
          initial={{ y: "0.72em", opacity: 0, rotateX: -55 }}
          animate={{ y: 0, opacity: 1, rotateX: 0 }}
          exit={{ y: "-0.72em", opacity: 0, rotateX: 55 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          {words[index]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
