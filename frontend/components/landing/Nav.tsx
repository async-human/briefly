"use client";

import { useEffect, useState } from "react";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <>
      <nav className={scrolled ? "scrolled" : ""}>
        <a href="#" className="nav-logo">Briefly</a>

        {/* Desktop links */}
        <ul className="nav-links">
          <li><a href="#how">How it works</a></li>
          <li><a href="#compare">Why Briefly</a></li>
          <li><a href="#roadmap">Roadmap</a></li>
          <li><a href="#pricing">Pricing</a></li>
          <li><a href="/login">Sign in</a></li>
          <li><a href="/login" className="nav-cta">Get started free</a></li>
        </ul>

        {/* Hamburger — mobile only */}
        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
        >
          <span /><span /><span />
        </button>
      </nav>

      {/* Full-screen mobile overlay */}
      {menuOpen && (
        <div className="nav-mobile-menu" role="dialog" aria-modal="true">

          {/* Explicit close button in top-right of overlay */}
          <button
            className="nav-mobile-close"
            onClick={close}
            aria-label="Close menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          <div className="nav-mobile-brand">Briefly</div>

          <nav className="nav-mobile-links">
            <a href="#how"     onClick={close}>How it works</a>
            <a href="#compare" onClick={close}>Why Briefly</a>
            <a href="#roadmap" onClick={close}>Roadmap</a>
            <a href="#pricing" onClick={close}>Pricing</a>
          </nav>

          <div className="nav-mobile-actions">
            <a href="/login" onClick={close} className="nav-mobile-signin">Sign in</a>
            <a href="/login" onClick={close} className="nav-mobile-cta">Get started free</a>
          </div>
        </div>
      )}
    </>
  );
}
