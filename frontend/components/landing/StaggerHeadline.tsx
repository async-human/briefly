"use client";

import { motion, useReducedMotion } from "framer-motion";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type StaggerHeadlineProps = {
  text: string;
  className?: string;
  as?: "h1" | "h2";
  baseDelay?: number;
};

export function StaggerHeadline({
  text,
  className,
  as: Tag = "h1",
  baseDelay = 0.1,
}: StaggerHeadlineProps) {
  const reducedMotion = useReducedMotion();
  const words = text.split(/\s+/).filter(Boolean);

  if (reducedMotion) {
    return <Tag className={className}>{text}</Tag>;
  }

  return (
    <Tag className={className} aria-label={text}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className="stagger-headline-word"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.48,
            delay: baseDelay + i * 0.055,
            ease: EASE,
          }}
        >
          {word}
        </motion.span>
      ))}
    </Tag>
  );
}
