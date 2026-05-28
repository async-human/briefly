"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setToken } from "@/lib/auth";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    function finishLogin() {
      const token = searchParams.get("token");
      if (!token) {
        setError("No authentication token received.");
        return;
      }
      setToken(token);
      // Always land on onboarding after login — returning users see step 2
      // (connection management) and continue to dashboard from there.
      router.replace("/onboarding");
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
