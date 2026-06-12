"use client";

import { motion, useReducedMotion } from "framer-motion";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const NAV_COLUMN = [
  { href: "#features", label: "Features" },
  { href: "#compare", label: "Compare" },
  { href: "#pricing", label: "Pricing" },
  { href: "#trust", label: "Privacy" },
] as const;

const LEGAL_COLUMN = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy/data-handling", label: "Data handling" },
] as const;

export function Footer() {
  const year = new Date().getFullYear();
  const reducedMotion = useReducedMotion();

  return (
    <footer className="footer-linear footer-linear-v2">
      <div className="footer-linear-inner">
        <div className="footer-linear-top">
          <p className="footer-linear-copy">
            © {year} Briefly. All rights reserved.
          </p>

          <div className="footer-linear-columns">
            <div className="footer-linear-col">
              <p className="footer-linear-col-title">Navigation</p>
              <ul className="footer-linear-col-list">
                {NAV_COLUMN.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="footer-linear-col">
              <p className="footer-linear-col-title">Legal</p>
              <ul className="footer-linear-col-list">
                {LEGAL_COLUMN.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-linear-wordmark-wrap">
          <div className="footer-linear-wordmark" aria-hidden>
            <motion.span
              initial={reducedMotion ? false : { y: "32%", opacity: 0 }}
              whileInView={{ y: "0%", opacity: 1 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.9, ease: EASE }}
            >
              Briefly
            </motion.span>
          </div>
        </div>
      </div>
    </footer>
  );
}
