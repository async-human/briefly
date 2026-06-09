"use client";

import { motion } from "framer-motion";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type PageContentTransitionProps = {
  children: React.ReactNode;
  className?: string;
};

export function PageContentTransition({ children, className }: PageContentTransitionProps) {
  return (
    <motion.div
      className={className ? `app-page-enter ${className}` : "app-page-enter"}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.48, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
