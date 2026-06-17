"use client";

import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import type { ReactNode } from "react";

type MagneticButtonProps = {
  href: string;
  className?: string;
  children: ReactNode;
  /** How far the button drifts toward the cursor, in px. */
  strength?: number;
};

/**
 * An anchor that springs gently toward the pointer while hovered — a tactile,
 * "alive" affordance on the primary action. No-ops on touch / reduced-motion.
 */
export function MagneticButton({
  href,
  className,
  children,
  strength = 14,
}: MagneticButtonProps) {
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.4 });

  if (reducedMotion) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }

  const onMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    x.set(dx * strength);
    y.set(dy * strength);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.a
      href={href}
      className={className}
      style={{ x: sx, y: sy }}
      onPointerMove={onMove}
      onPointerLeave={reset}
      whileTap={{ scale: 0.97 }}
    >
      {children}
    </motion.a>
  );
}
