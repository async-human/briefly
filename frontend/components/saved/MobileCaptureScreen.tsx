"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type UrlCaptureResponse } from "@/lib/api";
import { getToken, setAuthNext } from "@/lib/auth";
import { enrichmentConnectionText } from "@/lib/captureUtils";
import { formatCaptureTitle } from "@/lib/formatCaptureTitle";
import { graphItemUrl } from "@/lib/graphLinks";
import { titleFromShareParams, urlFromShareParams } from "@/lib/shareUrl";

type Phase = "auth" | "capturing" | "success" | "error" | "no-url";

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
      setError(err instanceof Error ? err.message : "Could not save this link.");
      setPhase("error");
    }
  }, [shareUrl, shareTitle]);

  useEffect(() => {
    const fullPath = `${window.location.pathname}${window.location.search}`;

    if (!getToken()) {
      setAuthNext(fullPath);
      router.replace(`/login?next=${encodeURIComponent(fullPath)}`);
      return;
    }

    if (!shareUrl) {
      setPhase("no-url");
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
        <span className="mobile-capture-brand">Briefly</span>
      </header>

      <main className="mobile-capture-main">
        {phase === "auth" || phase === "capturing" ? (
          <div className="mobile-capture-state" role="status" aria-live="polite">
            <span className="mobile-capture-spinner" aria-hidden />
            <p className="mobile-capture-heading">Saving to Briefly…</p>
            <p className="mobile-capture-sub">
              Scraping and connecting to your threads — same as the extension.
            </p>
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
