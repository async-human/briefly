"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const NAV_LINKS = [
  { href: "#how",     label: "How it works" },
  { href: "#compare", label: "Why Briefly"  },
  { href: "#roadmap", label: "Roadmap"      },
  { href: "#pricing", label: "Pricing"      },
];

export function Nav() {
  const [scrolled, setScrolled]   = useState(false);
  const [menuOpen, setMenuOpen]   = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const open  = () => setMenuOpen(true);
  const close = () => setMenuOpen(false);

  return (
    <>
      <nav className={scrolled ? "scrolled" : ""}>
        <a href="#" className="nav-logo">Briefly</a>

        {/* Desktop links — hidden on mobile */}
        <ul className="nav-links">
          {NAV_LINKS.map((l) => (
            <li key={l.href}><a href={l.href}>{l.label}</a></li>
          ))}
          <li><a href="/login">Sign in</a></li>
          <li><a href="/login" className="nav-cta">Get started free</a></li>
        </ul>

        {/* Hamburger — mobile only */}
        <button className="nav-hamburger" onClick={open} aria-label="Open menu">
          <span /><span /><span />
        </button>
      </nav>

      {/* ── Mobile overlay ── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="nav-mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            {/* Top bar: brand + close — in the same flex row so close always works */}
            <div className="nav-mobile-topbar">
              <span className="nav-mobile-brand">Briefly</span>
              <button
                className="nav-mobile-close"
                onClick={close}
                aria-label="Close menu"
                type="button"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M2 2l12 12M14 2L2 14"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            {/* Nav links */}
            <nav className="nav-mobile-links">
              {NAV_LINKS.map((l, i) => (
                <motion.a
                  key={l.href}
                  href={l.href}
                  onClick={close}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 + i * 0.04, duration: 0.2, ease: EASE }}
                >
                  {l.label}
                </motion.a>
              ))}
            </nav>

            {/* CTA buttons */}
            <motion.div
              className="nav-mobile-actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.22, duration: 0.2 }}
            >
              <a href="/login" onClick={close} className="nav-mobile-signin">
                Sign in
              </a>
              <a href="/login" onClick={close} className="nav-mobile-cta">
                Get started free
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
