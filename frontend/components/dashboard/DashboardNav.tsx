"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/auth";
import { useBriefingGeneration } from "./BriefingGenerationProvider";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
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
  const initial = userName?.charAt(0).toUpperCase() ?? "?";

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <header className="dash-nav">
      <div className="dash-nav-inner">
        <div className="dash-nav-row">
          <Link href="/dashboard" className="dash-logo">
            Briefly
          </Link>
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
      </div>
    </header>
  );
}
