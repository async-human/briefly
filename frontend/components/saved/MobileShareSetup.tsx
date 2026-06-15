"use client";

import Link from "next/link";
import { useEnableMobileShare } from "@/components/settings/CaptureDevicesCard";

export function MobileShareSetup() {
  const { enable, status, error, hasLocalToken } = useEnableMobileShare();

  return (
    <div className="mobile-share-setup">
      {hasLocalToken || status === "ready" ? (
        <p className="install-hint-ready">Share sheet enabled on this device.</p>
      ) : (
        <button
          type="button"
          className="dash-btn dash-btn-primary"
          onClick={() => void enable()}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Enabling…" : "Enable share on this phone"}
        </button>
      )}
      {error ? <p className="form-error">{error}</p> : null}
      <ol className="install-hint-steps">
        <li>Tap the button above once (stores a device token on this phone).</li>
        <li>
          <strong>Android:</strong> Chrome menu → Install app / Add to Home screen
        </li>
        <li>On any article: Share → Briefly</li>
      </ol>
      <Link href="/settings#capture-devices" className="install-hint-link">
        Manage save devices in Settings
      </Link>
    </div>
  );
}
