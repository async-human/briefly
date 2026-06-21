"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/auth";
import { AppThemeToggle } from "@/components/app/AppThemeToggle";
import { SidebarPlanBadge } from "@/components/billing/SidebarPlanBadge";

type AppAccountMenuProps = {
  userName: string | null;
  avatarUrl?: string | null;
  /** Called when the user navigates away (e.g. to close the mobile drawer). */
  onNavigate?: () => void;
};

export function AppAccountMenu({ userName, avatarUrl, onNavigate }: AppAccountMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = userName?.charAt(0).toUpperCase() ?? "?";

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close when the route changes (e.g. "Manage plan" navigates to settings).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <div className="app-account" ref={rootRef}>
      {open && (
        <div className="app-account-menu" role="menu" aria-label="Account">
          <div
            className="app-account-menu-section"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
          >
            <SidebarPlanBadge />
          </div>

          <div className="app-account-menu-divider" />

          <div className="app-account-menu-section">
            <p className="app-account-menu-label">Theme</p>
            <AppThemeToggle />
          </div>

          <div className="app-account-menu-divider" />

          <button
            type="button"
            className="app-account-menu-item app-account-menu-signout"
            onClick={handleLogout}
            role="menuitem"
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden width="16" height="16">
              <path
                d="M15 17l5-5-5-5M20 12H9M9 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Sign out
          </button>
        </div>
      )}

      <button
        type="button"
        className={`app-account-trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="app-sidebar-avatar" />
        ) : (
          <span className="app-sidebar-avatar app-sidebar-avatar-fallback">{initial}</span>
        )}
        <span className="app-account-name">{userName ?? "Account"}</span>
        <svg
          className="app-account-caret"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          width="16"
          height="16"
        >
          <path
            d="M7 14.5l5-5 5 5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
