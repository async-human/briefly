"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrieflyLogo } from "@/components/BrieflyLogo";
import { clearToken } from "@/lib/auth";
import { useBriefingGeneration } from "./BriefingGenerationProvider";

const NAV = [
  {
    href: "/dashboard",
    label: "Today",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/saved",
    label: "Saved",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v13.8L12 16.5 5.5 19.8V6A1.5 1.5 0 0 1 7 4.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/ask",
    label: "Ask",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M7 8.5h10M7 12h7M7 15.5h9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M5 5.5h14a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H10l-4.5 3v-3H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/graph",
    label: "Graph",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="6" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="18" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="18" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8.2 16.5 15.8 7.5M15.8 16.5l-4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/intelligence",
    label: "Intelligence",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M5 19c2.2-1.2 4.6-1.8 7-1.8s4.8.6 7 1.8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/history",
    label: "History",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M6 5h12M6 9h12M6 13h8M6 17h5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-.4 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.1.4 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.26 0 .52-.1.7-.3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
] as const;

type AppSidebarProps = {
  userName: string | null;
  avatarUrl?: string | null;
  open: boolean;
  onClose: () => void;
};

export function AppSidebar({ userName, avatarUrl, open, onClose }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { generating } = useBriefingGeneration();
  const initial = userName?.charAt(0).toUpperCase() ?? "?";

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <>
      <button
        type="button"
        className={`app-sidebar-backdrop${open ? " is-visible" : ""}`}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={onClose}
      />
      <aside className={`app-sidebar${open ? " is-open" : ""}`} aria-label="App navigation">
        <div className="app-sidebar-brand">
          <Link href="/dashboard" className="app-sidebar-logo" onClick={onClose}>
            <BrieflyLogo variant="full" size="sm" />
          </Link>
        </div>

        <nav className="app-sidebar-nav">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`app-sidebar-link${isActive(item.href) ? " is-active" : ""}`}
              onClick={onClose}
            >
              <span className="app-sidebar-link-icon">{item.icon}</span>
              <span className="app-sidebar-link-label">{item.label}</span>
              {generating && item.href === "/dashboard" && pathname !== "/dashboard" && (
                <span className="app-sidebar-link-pip" aria-label="Generating briefing" />
              )}
            </Link>
          ))}
        </nav>

        <div className="app-sidebar-foot">
          {userName && (
            <div className="app-sidebar-user">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="app-sidebar-avatar" />
              ) : (
                <span className="app-sidebar-avatar app-sidebar-avatar-fallback">{initial}</span>
              )}
              <span className="app-sidebar-user-name">{userName}</span>
            </div>
          )}
          <button type="button" className="app-sidebar-signout" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
