"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setToken, consumeAuthNext } from "@/lib/auth";
import { api } from "@/lib/api";
import { ensureDesktopOrbLinked } from "@/lib/orbDesktopLink";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    async function finishLogin() {
      const token = searchParams.get("token");
      if (!token) {
        setError("No authentication token received.");
        return;
      }
      setToken(token);
      // Try desktop orb handoff immediately after login.
      await ensureDesktopOrbLinked();
      try {
        const returnTo = consumeAuthNext();
        if (returnTo) {
          router.replace(returnTo);
          return;
        }
        const status = await api.getOnboardingStatus();
        router.replace(status.onboarding_completed ? "/dashboard" : "/onboarding");
      } catch {
        router.replace("/onboarding");
      }
    }
    void finishLogin();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p className="auth-error">{error}</p>
          <a href="/login" className="btn-primary">Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <p className="auth-loading">Signing you in…</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
