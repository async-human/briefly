"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearToken } from "@/lib/auth";

export function DashboardNav({ userName }: { userName: string | null }) {
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.push("/login");
  }

  return (
    <header className="dash-nav">
      <Link href="/dashboard" className="dash-logo">Briefly</Link>
      <div className="dash-nav-right">
        {userName && <span className="dash-user">{userName}</span>}
        <button type="button" className="dash-logout" onClick={handleLogout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
