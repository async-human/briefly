"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken } from "@/lib/auth";
import { useBriefingGeneration } from "./BriefingGenerationProvider";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Today", short: "Today" },
  { href: "/history", label: "History", short: "History" },
  { href: "/settings", label: "Preferences", short: "Prefs" },
] as const;

export function DashboardNav({
  userName,
  avatarUrl,
}: {
  userName: string | null;
  avatarUrl?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { generating } = useBriefingGeneration();
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = userName?.charAt(0).toUpperCase() ?? "?";

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const shell = document.querySelector(".dash-hallmark");
    shell?.classList.toggle("dash-nav-open", menuOpen);
    return () => shell?.classList.remove("dash-nav-open");
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <>
      <header className="dash-nav">
        <div className="dash-nav-inner">
          <div className="dash-nav-brand">
            <Link href="/dashboard" className="dash-logo">
              Briefly
            </Link>
          </div>

          <nav className="dash-nav-tabs" aria-label="Dashboard sections">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`dash-nav-link${isActive(item.href) ? " active" : ""}`}
              >
                {item.label}
                {generating && item.href === "/dashboard" && pathname !== "/dashboard" && (
                  <span
                    className="dash-nav-generating-pip"
                    title="Briefing generating"
                    aria-label="Generating briefing"
                  />
                )}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            className="dash-nav-menu-btn"
            aria-expanded={menuOpen}
            aria-controls="dash-nav-sheet"
            onClick={() => setMenuOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
            <span className="sr-only">Open menu</span>
          </button>

          <div className="dash-nav-right">
            {userName && (
              <div className="dash-user-chip">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarUrl} alt="" className="dash-avatar" />
                ) : (
                  <span className="dash-avatar dash-avatar-fallback">{initial}</span>
                )}
                <span className="dash-user-name">{userName}</span>
              </div>
            )}
            <button type="button" className="dash-logout" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <button
        type="button"
        className="dash-nav-sheet-backdrop"
        aria-hidden={!menuOpen}
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />

      <nav
        id="dash-nav-sheet"
        className="dash-nav-sheet"
        aria-label="Mobile navigation"
        aria-hidden={!menuOpen}
      >
        <div className="dash-nav-sheet-head">
          <p className="dash-nav-sheet-title">Menu</p>
          <button
            type="button"
            className="dash-nav-sheet-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            ×
          </button>
        </div>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`dash-nav-sheet-link${isActive(item.href) ? " active" : ""}`}
            onClick={() => setMenuOpen(false)}
          >
            {item.label}
          </Link>
        ))}
        <div className="dash-nav-sheet-account">
          {userName && <span className="dash-user-name">{userName}</span>}
          <button type="button" className="dash-logout" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </nav>

      <nav className="dash-bottom-nav" aria-label="Primary">
        <div className="dash-bottom-nav-inner">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`dash-bottom-nav-link${isActive(item.href) ? " active" : ""}`}
            >
              <span className="dash-bottom-nav-icon" aria-hidden>
                {item.href === "/dashboard" ? "◎" : item.href === "/history" ? "◷" : "◇"}
              </span>
              {item.short}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
