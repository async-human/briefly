"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrieflyLogo } from "@/components/BrieflyLogo";
import { ThemeToggle } from "./ThemeToggle";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const NAV_LINKS = [
  { href: "#trust", label: "Privacy" },
  { href: "#why", label: "Why" },
  { href: "#features", label: "Features" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#compare", label: "Compare" },
  { href: "#pricing", label: "Pricing" },
];

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const open = () => setMenuOpen(true);
  const close = () => setMenuOpen(false);

  return (
    <>
      {/* N5 — Floating pill */}
      <nav className={`nav-fp${menuOpen ? " menu-open" : ""}`}>
        <div className="nav-fp-inner">
          <a href="#" className="nav-fp-logo">
            <BrieflyLogo variant="full" size="sm" />
          </a>

          <ul className="nav-fp-links">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>

          <div className="nav-fp-right">
            <ThemeToggle compact />
            <a href="/login" className="nav-fp-cta">Start free →</a>
          </div>

          <button
            className="nav-hamburger"
            onClick={menuOpen ? close : open}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.button
              type="button"
              className="nav-mobile-backdrop"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={close}
            />
            <motion.div
              className="nav-mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              initial={{ opacity: 0, x: "100%" }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: "100%" }}
              transition={{ duration: 0.32, ease: EASE }}
            >
              <div className="nav-mobile-topbar">
                <BrieflyLogo variant="full" size="sm" className="nav-mobile-brand" />
                <button className="nav-mobile-close" onClick={close} aria-label="Close menu" type="button">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <div className="nav-mobile-links" role="navigation" aria-label="Mobile navigation">
                {NAV_LINKS.map((l, i) => (
                  <motion.a
                    key={l.href}
                    href={l.href}
                    className="nav-mobile-link"
                    onClick={close}
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.08 + i * 0.05, duration: 0.28, ease: EASE }}
                  >
                    <span className="nav-mobile-link-index">{String(i + 1).padStart(2, "0")}</span>
                    <span className="nav-mobile-link-label">{l.label}</span>
                  </motion.a>
                ))}
              </div>
              <motion.div
                className="nav-mobile-actions"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.28, duration: 0.25, ease: EASE }}
              >
                <div className="nav-mobile-theme"><ThemeToggle /></div>
                <a href="/login" onClick={close} className="nav-mobile-signin">Sign in</a>
                <a href="/login" onClick={close} className="nav-mobile-cta">Get started free</a>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
