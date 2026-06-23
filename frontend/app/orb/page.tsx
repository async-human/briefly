"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppThemeProvider } from "@/components/app/AppThemeProvider";
import { MobileOrbOverlay } from "@/components/mobile/MobileOrbOverlay";
import { getToken, setAuthNext } from "@/lib/auth";
import "@/styles/mobile-orb.css";

function OrbInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    try {
      if (localStorage.getItem("briefly.orb_install_hint_dismissed") === "1") return;
    } catch {
      // ignore
    }
    setShow(true);
  }, []);

  if (!show) return null;

  const isIos =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as Window & { MSStream?: unknown }).MSStream;

  return (
    <div className="orb-install-hint" role="status">
      <p className="orb-install-hint-text">
        {isIos
          ? "For one-tap access: Share → Add to Home Screen."
          : "Install Briefly to your home screen for one-tap voice access."}
      </p>
      <button
        type="button"
        className="orb-install-hint-dismiss"
        onClick={() => {
          try {
            localStorage.setItem("briefly.orb_install_hint_dismissed", "1");
          } catch {
            // ignore
          }
          setShow(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}

export default function MobileOrbAppPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthNext("/orb");
      router.replace("/login?next=/orb");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="orb-boot" aria-busy="true" aria-label="Loading Briefly">
        <div className="orb-boot-pulse" />
      </div>
    );
  }

  return (
    <AppThemeProvider>
      <OrbInstallHint />
      <MobileOrbOverlay variant="standalone" />
    </AppThemeProvider>
  );
}
