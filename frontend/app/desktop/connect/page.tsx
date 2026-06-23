"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getToken, setAuthNext } from "@/lib/auth";
import { openDesktopOrbLink } from "@/lib/orbDesktopLink";

function ConnectHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const relayPort = searchParams.get("relay_port");
  const started = useRef(false);
  const [status, setStatus] = useState<"pending" | "working" | "success" | "error">("pending");
  const [message, setMessage] = useState("Preparing desktop connection…");
  const [delivery, setDelivery] = useState<"relay" | "deeplink" | null>(null);

  const linkOrb = useCallback(async () => {
    setStatus("working");
    setMessage("Linking your desktop orb…");
    try {
      const created = await api.createCaptureToken({
        name: `Desktop Orb (${window.navigator.platform || "desktop"})`,
        platform: "desktop",
      });
      if (!created?.token) throw new Error("No token returned");
      const mode = await openDesktopOrbLink(created.token, relayPort);
      setDelivery(mode);
      setStatus("success");
      setMessage(
        mode === "relay"
          ? "Connected! Switch back to the Briefly orb on your desktop — you're ready to talk."
          : "Connected! If the orb did not update, click connect again while the orb app is open.",
      );
    } catch {
      setStatus("error");
      setMessage(
        "Could not connect automatically. Make sure the orb app is running and try again.",
      );
    }
  }, [relayPort]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const session = getToken();
    if (!session) {
      setAuthNext("/desktop/connect");
      router.replace("/login");
      return;
    }
    void linkOrb();
  }, [router, linkOrb]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title" style={{ marginBottom: 12 }}>
          Desktop orb
        </h1>
        <p className={status === "error" ? "auth-error" : "auth-loading"}>{message}</p>
        {status === "success" && delivery === "deeplink" && (
          <p className="auth-loading" style={{ marginTop: 12, fontSize: 14 }}>
            Keep the orb running, then{" "}
            <button
              type="button"
              className="btn-primary"
              style={{ display: "inline", padding: "4px 10px", fontSize: 13 }}
              onClick={() => void linkOrb()}
            >
              connect again
            </button>
            .
          </p>
        )}
        {status === "success" && delivery === "relay" && (
          <p className="auth-loading" style={{ marginTop: 12, fontSize: 14 }}>
            The orb should show &quot;Connected to Briefly&quot; now.
          </p>
        )}
        {status === "error" && (
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button type="button" className="btn-primary" onClick={() => void linkOrb()}>
              Try again
            </button>
            <Link href="/dashboard" className="btn-primary">
              Dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DesktopConnectPage() {
  return (
    <Suspense>
      <ConnectHandler />
    </Suspense>
  );
}
