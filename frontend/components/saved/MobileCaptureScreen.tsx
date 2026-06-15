"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type UrlCaptureResponse } from "@/lib/api";
import { getToken, setAuthNext } from "@/lib/auth";
import { getCaptureToken } from "@/lib/captureAuth";
import { enrichmentConnectionText } from "@/lib/captureUtils";
import { formatCaptureTitle } from "@/lib/formatCaptureTitle";
import { graphItemUrl } from "@/lib/graphLinks";
import { BrieflyLogo } from "@/components/BrieflyLogo";
import { titleFromShareParams, urlFromShareParams } from "@/lib/shareUrl";

type Phase = "auth" | "capturing" | "success" | "error" | "no-url";

function hasCaptureAuth(): boolean {
  return !!(getToken() || getCaptureToken());
}

export function MobileCaptureScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>("auth");
  const [feedback, setFeedback] = useState<UrlCaptureResponse | null>(null);
  const [error, setError] = useState("");
  const capturedRef = useRef(false);

  const shareUrl = urlFromShareParams(searchParams);
  const shareTitle = titleFromShareParams(searchParams);

  const runCapture = useCallback(async () => {
    if (!shareUrl || capturedRef.current) return;
    capturedRef.current = true;
    setPhase("capturing");
    setError("");

    try {
      const res = await api.captureUrl({ url: shareUrl, title: shareTitle });
      setFeedback(res);
      setPhase("success");
    } catch (err) {
      capturedRef.current = false;
      const apiErr = err instanceof Error ? err : new Error("Could not save this link.");
      if (apiErr.message.includes("401") || apiErr.message.toLowerCase().includes("authenticated")) {
        setPhase("auth");
        setError("Session expired. Open Briefly to sign in, or set up a device token in Settings.");
        return;
      }
      setError(apiErr.message);
      setPhase("error");
    }
  }, [shareUrl, shareTitle]);

  useEffect(() => {
    const fullPath = `${window.location.pathname}${window.location.search}`;

    if (!shareUrl) {
      setPhase("no-url");
      return;
    }

    if (!hasCaptureAuth()) {
      setAuthNext(fullPath);
      router.replace(`/login?next=${encodeURIComponent(fullPath)}`);
      return;
    }

    void runCapture();
  }, [router, shareUrl, runCapture]);

  function handleBack() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.close();
  }

  const connectionText = feedback ? enrichmentConnectionText(feedback.enrichment) : null;

  return (
    <div className="mobile-capture">
      <header className="mobile-capture-header">
        <BrieflyLogo variant="full" size="sm" className="mobile-capture-brand" />
      </header>

      <main className="mobile-capture-main">
        {phase === "auth" || phase === "capturing" ? (
          <div className="mobile-capture-state" role="status" aria-live="polite">
            <span className="mobile-capture-spinner" aria-hidden />
            <p className="mobile-capture-heading">
              {phase === "auth" && error ? "Sign in required" : "Saving to Briefly…"}
            </p>
            <p className="mobile-capture-sub">
              {phase === "auth" && error
                ? error
                : "Scraping and connecting to your threads — same as the extension."}
            </p>
            {phase === "auth" && error ? (
              <div className="mobile-capture-actions">
                <Link href={`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`} className="mobile-capture-btn-primary">
                  Sign in
                </Link>
                <Link href="/settings#capture-devices" className="mobile-capture-btn-secondary">
                  Device setup
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === "success" && feedback ? (
          <div className="mobile-capture-state mobile-capture-success" role="status">
            <p className="mobile-capture-badge">
              {feedback.already_saved ? "Already in Briefly" : "Added to Briefly"}
            </p>
            <p className="mobile-capture-heading" title={feedback.title}>
              {formatCaptureTitle(feedback.title, feedback.url)}
            </p>
            {connectionText ? (
              <p className="mobile-capture-connection">{connectionText}</p>
            ) : (
              <p className="mobile-capture-sub">Queued for your next briefing.</p>
            )}
            <div className="mobile-capture-actions">
              <button type="button" className="mobile-capture-btn-primary" onClick={handleBack}>
                Back to article
              </button>
              <Link href={graphItemUrl(feedback.id)} className="mobile-capture-btn-secondary">
                View in graph
              </Link>
              <Link href="/saved" className="mobile-capture-btn-secondary">
                View all saves
              </Link>
            </div>
          </div>
        ) : null}

        {phase === "error" ? (
          <div className="mobile-capture-state mobile-capture-error" role="alert">
            <p className="mobile-capture-heading">Couldn&apos;t save</p>
            <p className="mobile-capture-sub">{error}</p>
            <div className="mobile-capture-actions">
              <button
                type="button"
                className="mobile-capture-btn-primary"
                onClick={() => void runCapture()}
              >
                Try again
              </button>
              <button type="button" className="mobile-capture-btn-secondary" onClick={handleBack}>
                Back to article
              </button>
            </div>
          </div>
        ) : null}

        {phase === "no-url" ? (
          <div className="mobile-capture-state">
            <p className="mobile-capture-heading">No link to save</p>
            <p className="mobile-capture-sub">
              Share an article from your browser, or paste a URL on the Saved page.
            </p>
            <div className="mobile-capture-actions">
              <Link href="/saved" className="mobile-capture-btn-primary">
                Open Saved
              </Link>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
