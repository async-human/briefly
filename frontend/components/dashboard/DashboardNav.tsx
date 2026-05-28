"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearToken } from "@/lib/auth";

export function DashboardNav({
  userName,
  avatarUrl,
}: {
  userName: string | null;
  avatarUrl?: string | null;
}) {
  const router = useRouter();
  const initial = userName?.charAt(0).toUpperCase() ?? "?";

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <header className="dash-nav">
      <div className="dash-nav-inner">
        <Link href="/dashboard" className="dash-logo">Briefly</Link>
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
  );
}
