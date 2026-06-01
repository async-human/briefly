"use client";

import type { DiscoveryProgress } from "@/lib/api";
import { SourceIcon } from "@/components/SourceIcon";

const ALL_STEPS: { id: string; label: string; gmailOnly?: boolean }[] = [
  { id: "start", label: "Starting scan" },
  { id: "gmail_scan", label: "Scanning Gmail inbox", gmailOnly: true },
  { id: "rss_probe", label: "Finding RSS feeds", gmailOnly: true },
  { id: "deep_links", label: "Extracting newsletter links", gmailOnly: true },
  { id: "oauth", label: "Loading connected accounts" },
  { id: "scoring", label: "Matching to your profile" },
  { id: "done", label: "Finishing up" },
];

const STEP_ORDER = ALL_STEPS.map((s) => s.id);

function stepState(
  stepId: string,
  currentStep: string | undefined,
  progressStatus: DiscoveryProgress["status"] | undefined,
  visibleIds: string[],
): "done" | "active" | "pending" {
  if (progressStatus === "complete") return "done";
  const order = visibleIds;
  let curIdx = order.indexOf(currentStep ?? "start");
  if (curIdx === -1) {
    curIdx = STEP_ORDER.indexOf(currentStep ?? "start");
    curIdx = order.findIndex((id) => STEP_ORDER.indexOf(id) >= curIdx);
    if (curIdx === -1) curIdx = order.length - 1;
  }
  const stepIdx = order.indexOf(stepId);
  if (stepIdx < curIdx) return "done";
  if (stepIdx === curIdx) return "active";
  return "pending";
}

type DiscoveryScanningProps = {
  progress: DiscoveryProgress | null;
  gmailConnected: boolean;
};

export function DiscoveryScanning({ progress, gmailConnected }: DiscoveryScanningProps) {
  const visibleSteps = ALL_STEPS.filter((s) => !s.gmailOnly || gmailConnected);
  const visibleIds = visibleSteps.map((s) => s.id);
  const currentStep = progress?.step ?? "start";
  const status = progress?.status ?? "running";
  const liveLabel = progress?.label ?? "Starting discovery…";

  return (
    <div className="discovery-scanning-panel">
      <div className="discovery-scanning-head">
        <div className="discovery-spinner" aria-hidden />
        <div className="discovery-scanning-live">
          <p className="discovery-scanning-title">{liveLabel}</p>
          {progress?.messages_scanned != null && progress.messages_scanned > 0 && (
            <p className="discovery-scanning-stats">
              {progress.messages_scanned} emails scanned
              {progress.senders_found != null && progress.senders_found > 0
                ? ` · ${progress.senders_found} senders found`
                : ""}
            </p>
          )}
        </div>
      </div>

      <ol className="discovery-step-list">
        {visibleSteps.map((step) => {
          const state = stepState(step.id, currentStep, status, visibleIds);
          return (
            <li
              key={step.id}
              className={`discovery-step discovery-step-${state}`}
            >
              <span className="discovery-step-marker" aria-hidden>
                {state === "done" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l2.5 2.5L10 3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : state === "active" ? (
                  <span className="discovery-step-dot" />
                ) : (
                  <span className="discovery-step-dot discovery-step-dot-muted" />
                )}
              </span>
              <span className="discovery-step-label">{step.label}</span>
              {step.id === "gmail_scan" && state === "active" && (
                <SourceIcon type="gmail" size={14} className="discovery-step-icon" />
              )}
              {step.id === "oauth" && state === "active" && (
                <SourceIcon type="youtube" size={14} className="discovery-step-icon" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
