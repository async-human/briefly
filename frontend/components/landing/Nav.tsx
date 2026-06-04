"use client";

import { useState } from "react";

import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { href: "#why", label: "Why" },
  { href: "#demo", label: "Demo" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#pricing", label: "Pricing" },
];

export function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className={`hm-nav${menuOpen ? " menu-open" : ""}`}>
      <div className="hm-nav-inner">
        <div className="hm-masthead">
          <a href="#" className="hm-wordmark">
            Briefly
          </a>
          <span className="hm-tagline">Morning intelligence from what you already follow</span>
        </div>

        <div className="hm-nav-actions hm-nav-desktop">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hm-nav-link">
              {l.label}
            </a>
          ))}
          <ThemeToggle compact />
          <a href="/login" className="hm-nav-link">
            Sign in
          </a>
          <a href="/login" className="hm-nav-cta">
            Get started
          </a>
        </div>

        <button
          type="button"
          className="hm-nav-toggle"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((o) => !o)}
        >
          Menu
        </button>

        <div className="hm-nav-mobile">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="hm-nav-link"
              onClick={() => setMenuOpen(false)}
            >
              {l.label}
            </a>
          ))}
          <ThemeToggle compact />
          <a href="/login" className="hm-nav-link" onClick={() => setMenuOpen(false)}>
            Sign in
          </a>
          <a href="/login" className="hm-nav-cta" onClick={() => setMenuOpen(false)}>
            Get started
          </a>
        </div>
      </div>
    </nav>
  );
}
