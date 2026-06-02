"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type Digest } from "@/lib/api";
import { BriefingReadyToast } from "./BriefingReadyToast";

type ReadyNotice = {
  itemCount: number;
  digestId: string;
};

type BriefingGenerationContextValue = {
  digest: Digest | null;
  setDigest: (digest: Digest | null) => void;
  generating: boolean;
  generatingLabel: string;
  generatingElapsedSec: number;   // seconds since generation started
  generateError: string;
  generateWarnings: string[];
  runGenerate: () => void;
  ensureBriefing: () => void;
  resumePolling: () => void;
  clearGenerateError: () => void;
};

const BriefingGenerationContext = createContext<BriefingGenerationContextValue | null>(null);

const DEFAULT_LABEL = "Fetching from your sources…";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function BriefingGenerationProvider({ children }: { children: ReactNode }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingLabel, setGeneratingLabel] = useState(DEFAULT_LABEL);
  const [generatingElapsedSec, setGeneratingElapsedSec] = useState(0);
  const [generateError, setGenerateError] = useState("");
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);
  const [readyNotice, setReadyNotice] = useState<ReadyNotice | null>(null);

  const pollingRef = useRef(false);
  const pendingGenerateRef = useRef(false);
  const userTriggeredRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generatingStartRef = useRef<number>(0);

  const pollBriefingUntilDone = useCallback(async (): Promise<{ digest: Digest; warnings: string[] }> => {
    const maxAttempts = 300;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(2000);
      const status = await api.getBriefingGenerationStatus();
      if (status.label) {
        setGeneratingLabel(status.label);
      }
      if (status.status === "complete") {
        const nextDigest =
          status.digest ??
          (status.digest_id ? await api.getDigest(status.digest_id) : null) ??
          (await api.getLatestDigest());
        if (nextDigest) {
          return { digest: nextDigest, warnings: status.warnings ?? [] };
        }
      }
      if (status.status === "error") {
        throw new Error(status.error || "Briefing generation failed");
      }
    }
    const latest = await api.getLatestDigest();
    if (latest) {
      return { digest: latest, warnings: [] };
    }
    throw new Error(
      "Briefing generation is taking longer than expected. Try refreshing in a moment.",
    );
  }, []);

  const runPollCycle = useCallback(
    async (startJob: boolean, notifyOnComplete: boolean) => {
      if (pollingRef.current) {
        if (startJob) pendingGenerateRef.current = true;
        return;
      }

      pollingRef.current = true;
      setGenerating(true);
      setGenerateError("");
      if (startJob) {
        userTriggeredRef.current = notifyOnComplete;
        setGenerateWarnings([]);
        setGeneratingLabel(DEFAULT_LABEL);
        // Start elapsed-time counter
        generatingStartRef.current = Date.now();
        setGeneratingElapsedSec(0);
        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = setInterval(() => {
          setGeneratingElapsedSec(Math.floor((Date.now() - generatingStartRef.current) / 1000));
        }, 1000);
      }

      try {
        if (startJob) {
          const existing = await api.getBriefingGenerationStatus().catch(() => null);
          if (existing?.label) {
            setGeneratingLabel(existing.label);
          }
          if (existing?.status !== "running") {
            const started = await api.generateDigest({ force: userTriggeredRef.current });
            if (started.status === "complete" && started.digest) {
              setDigest(started.digest);
              setGenerateWarnings(started.warnings ?? []);
              if (userTriggeredRef.current) {
                setReadyNotice({
                  itemCount: started.digest.total_items_shown ?? started.digest.items?.length ?? 0,
                  digestId: started.digest.id,
                });
              }
              userTriggeredRef.current = false;
              return;
            }
          }
        } else {
          const existing = await api.getBriefingGenerationStatus().catch(() => null);
          if (existing?.label) {
            setGeneratingLabel(existing.label);
          }
        }

        const result = await pollBriefingUntilDone();
        setDigest(result.digest);
        setGenerateWarnings(result.warnings);
        if (userTriggeredRef.current) {
          setReadyNotice({
            itemCount: result.digest.total_items_shown ?? result.digest.items?.length ?? 0,
            digestId: result.digest.id,
          });
        }
        userTriggeredRef.current = false;
      } catch (err) {
        setGenerateError(err instanceof Error ? err.message : "Failed to generate briefing");
        userTriggeredRef.current = false;
      } finally {
        setGenerating(false);
        setGeneratingLabel(DEFAULT_LABEL);
        setGeneratingElapsedSec(0);
        if (elapsedTimerRef.current) {
          clearInterval(elapsedTimerRef.current);
          elapsedTimerRef.current = null;
        }
        pollingRef.current = false;
        if (pendingGenerateRef.current) {
          pendingGenerateRef.current = false;
          void runPollCycle(true, true);
        }
      }
    },
    [pollBriefingUntilDone],
  );

  const runGenerate = useCallback(() => {
    void runPollCycle(true, true);
  }, [runPollCycle]);

  const ensureBriefing = useCallback(() => {
    void runPollCycle(true, false);
  }, [runPollCycle]);

  const resumePolling = useCallback(() => {
    void runPollCycle(false, false);
  }, [runPollCycle]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [latest, status] = await Promise.all([
          api.getLatestDigest().catch(() => null),
          api.getBriefingGenerationStatus().catch(() => null),
        ]);
        if (cancelled) return;
        if (latest) setDigest(latest);
        if (status?.status === "running") {
          resumePolling();
        }
      } catch {
        /* non-fatal */
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [resumePolling]);

  const value: BriefingGenerationContextValue = {
    digest,
    setDigest,
    generating,
    generatingLabel,
    generatingElapsedSec,
    generateError,
    generateWarnings,
    runGenerate,
    ensureBriefing,
    resumePolling,
    clearGenerateError: () => setGenerateError(""),
  };

  return (
    <BriefingGenerationContext.Provider value={value}>
      {children}
      {readyNotice && (
        <BriefingReadyToast
          itemCount={readyNotice.itemCount}
          digestId={readyNotice.digestId}
          onDismiss={() => setReadyNotice(null)}
          onView={() => setReadyNotice(null)}
        />
      )}
    </BriefingGenerationContext.Provider>
  );
}

export function useBriefingGeneration() {
  const ctx = useContext(BriefingGenerationContext);
  if (!ctx) {
    throw new Error("useBriefingGeneration must be used within BriefingGenerationProvider");
  }
  return ctx;
}
