"use client";

import { Suspense } from "react";
import { MobileCaptureScreen } from "@/components/saved/MobileCaptureScreen";

function CaptureFallback() {
  return (
    <div className="mobile-capture">
      <header className="mobile-capture-header">
        <span className="mobile-capture-brand">Briefly</span>
      </header>
      <main className="mobile-capture-main">
        <div className="mobile-capture-state" role="status">
          <span className="mobile-capture-spinner" aria-hidden />
          <p className="mobile-capture-heading">Loading…</p>
        </div>
      </main>
    </div>
  );
}

export default function SavedCapturePage() {
  return (
    <Suspense fallback={<CaptureFallback />}>
      <MobileCaptureScreen />
    </Suspense>
  );
}
