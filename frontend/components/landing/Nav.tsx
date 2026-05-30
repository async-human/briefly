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

  // Lock body scroll while mobile menu is open
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

        {/* Hamburger button — mobile only */}
        <button
          className={`nav-hamburger${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>
      </nav>

      {/* Full-screen mobile menu */}
      {menuOpen && (
        <div className="nav-mobile-menu" role="dialog" aria-modal="true">
          <a href="#how"     onClick={close}>How it works</a>
          <a href="#compare" onClick={close}>Why Briefly</a>
          <a href="#roadmap" onClick={close}>Roadmap</a>
          <a href="#pricing" onClick={close}>Pricing</a>
          <div className="nav-mobile-divider" />
          <a href="/login" onClick={close} className="nav-mobile-signin">Sign in</a>
          <a href="/login" onClick={close} className="nav-mobile-cta">Get started free →</a>
        </div>
      )}
    </>
  );
}
