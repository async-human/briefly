"use client";

import { useEffect, useState } from "react";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={scrolled ? "scrolled" : ""}>
      <a href="#" className="nav-logo">Briefly</a>
      <ul className="nav-links">
        <li><a href="#how">How it works</a></li>
        <li><a href="#compare">Why Briefly</a></li>
        <li><a href="#roadmap">Roadmap</a></li>
        <li><a href="#pricing">Pricing</a></li>
        <li><a href="/login">Sign in</a></li>
        <li><a href="/login" className="nav-cta">Get started free</a></li>
      </ul>
    </nav>
  );
}
