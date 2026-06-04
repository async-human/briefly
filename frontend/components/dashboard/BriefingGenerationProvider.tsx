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
import {
  clearBriefingGeneratedToday,
  markBriefingGeneratedToday,
} from "@/lib/briefingStorage";
import { needsBriefingForToday } from "@/lib/localDate";
import { BriefingReadyToast } from "./BriefingReadyToast";

type ReadyNotice = {
  itemCount: number;
  digestId: string;
};

type BriefingGenerationContextValue = {
  digest: Digest | null;
  setDigest: (digest: Digest | null) => void;
  digestTimezone: string | null;
  generating: boolean;
  generatingLabel: string;
  generatingElapsedSec: number;
  generateError: string;
  generateWarnings: string[];
  runGenerate: () => void;
  ensureBriefing: () => void;
  resumePolling: () => void;
  clearGenerateError: () => void;
};

const BriefingGenerationContext = createContext<BriefingGenerationContextValue | null>(null);

const DEFAULT_LABEL = "Fetching from your sources…";
const STALE_RUNNING_MS = 3 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function runningAgeMs(status: { started_at?: string | null } | null): number {
  if (!status?.started_at) return Infinity;
  const started = new Date(status.started_at).getTime();
  return Number.isNaN(started) ? Infinity : Date.now() - started;
}

function shouldKickOffGeneration(
  status: { status?: string; started_at?: string | null } | null,
  restart: boolean,
): boolean {
  if (!status || status.status === "idle" || status.status === "error" || status.status === "complete") {
    return true;
  }
  if (status.status === "running") {
    return restart || runningAgeMs(status) > STALE_RUNNING_MS;
  }
  return true;
}

function isValidTodayDigest(
  digest: Digest | null | undefined,
  digestTimezone?: string | null,
): digest is Digest {
  if (!digest) return false;
  return !needsBriefingForToday(digest, digestTimezone);
}

export function BriefingGenerationProvider({ children }: { children: ReactNode }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [digestTimezone, setDigestTimezone] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
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
  const digestTimezoneRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    digestTimezoneRef.current = digestTimezone;
  }, [digestTimezone]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const resolveTodayDigest = useCallback(async (): Promise<Digest | null> => {
    const todayDigest = await api.getTodayDigest().catch(() => null);
    if (isValidTodayDigest(todayDigest, digestTimezoneRef.current)) {
      return todayDigest;
    }
    return null;
  }, []);

  const pollBriefingUntilDone = useCallback(async (): Promise<{ digest: Digest; warnings: string[] }> => {
    const POLL_INTERVAL_MS = 2000;
    const HARD_TIMEOUT_MS = 5 * 60 * 1000;
    const DIGEST_FALLBACK_MS = 3 * 60 * 1000;
    const startedAt = Date.now();

    while (true) {
      await sleep(POLL_INTERVAL_MS);
      const elapsed = Date.now() - startedAt;

      const status = await api.getBriefingGenerationStatus();
      if (status.label) {
        setGeneratingLabel(status.label);
      }

      if (status.status === "complete") {
        const fromStatus =
          status.digest && isValidTodayDigest(status.digest, digestTimezoneRef.current)
            ? status.digest
            : null;
        const fromId =
          !fromStatus && status.digest_id
            ? await api.getDigest(status.digest_id).catch(() => null)
            : null;
        const nextDigest =
          fromStatus ??
          (isValidTodayDigest(fromId, digestTimezoneRef.current) ? fromId : null) ??
          (await resolveTodayDigest());
        if (nextDigest) {
          return { digest: nextDigest, warnings: status.warnings ?? [] };
        }
        // Status says complete but today's digest isn't in DB — keep polling.
      }

      if (status.status === "error") {
        throw new Error(status.error || "Briefing generation failed");
      }

      if (elapsed >= DIGEST_FALLBACK_MS) {
        const todayDigest = await resolveTodayDigest();
        if (todayDigest) {
          return { digest: todayDigest, warnings: [] };
        }
      }

      if (elapsed >= HARD_TIMEOUT_MS) {
        throw new Error(
          "Today's briefing didn't finish in time. Try refreshing — if it keeps failing, check that your sources have recent content.",
        );
      }
    }
  }, [resolveTodayDigest]);

  const runPollCycle = useCallback(
    async (startJob: boolean, notifyOnComplete: boolean, restart = false) => {
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
          const todayAlready = await resolveTodayDigest();
          if (todayAlready) {
            setDigest(todayAlready);
            if (userIdRef.current) {
              markBriefingGeneratedToday(userIdRef.current, digestTimezoneRef.current);
            }
            userTriggeredRef.current = false;
            return;
          }
          if (shouldKickOffGeneration(existing, restart)) {
            const started = await api.generateDigest({ force: true, restart });
            if (started.status === "complete" && isValidTodayDigest(started.digest, digestTimezoneRef.current)) {
              setDigest(started.digest!);
              setGenerateWarnings(started.warnings ?? []);
              if (userIdRef.current) {
                markBriefingGeneratedToday(userIdRef.current, digestTimezoneRef.current);
              }
              if (userTriggeredRef.current) {
                setReadyNotice({
                  itemCount: started.digest!.total_items_shown ?? started.digest!.items?.length ?? 0,
                  digestId: started.digest!.id,
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
          const todayAlready = await resolveTodayDigest();
          if (!todayAlready && shouldKickOffGeneration(existing, false)) {
            await api.generateDigest({ force: true }).catch(() => null);
          }
          if (existing?.started_at) {
            const startedMs = new Date(existing.started_at).getTime();
            const ageMs = Date.now() - startedMs;
            const MAX_RESUME_AGE_MS = 20 * 60 * 1000;
            if (!isNaN(startedMs) && ageMs < MAX_RESUME_AGE_MS) {
              generatingStartRef.current = startedMs;
              setGeneratingElapsedSec(Math.floor(ageMs / 1000));
            } else {
              generatingStartRef.current = Date.now();
              setGeneratingElapsedSec(0);
            }
            if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
            elapsedTimerRef.current = setInterval(() => {
              setGeneratingElapsedSec(Math.floor((Date.now() - generatingStartRef.current) / 1000));
            }, 1000);
          }
        }

        const result = await pollBriefingUntilDone();
        setDigest(result.digest);
        setGenerateWarnings(result.warnings);
        if (userIdRef.current) {
          markBriefingGeneratedToday(userIdRef.current, digestTimezoneRef.current);
        }
        if (userTriggeredRef.current) {
          setReadyNotice({
            itemCount: result.digest.total_items_shown ?? result.digest.items?.length ?? 0,
            digestId: result.digest.id,
          });
        }
        userTriggeredRef.current = false;
      } catch (err) {
        if (userIdRef.current) {
          clearBriefingGeneratedToday(userIdRef.current);
        }
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
          void runPollCycle(true, true, true);
        }
      }
    },
    [pollBriefingUntilDone, resolveTodayDigest],
  );

  const runGenerate = useCallback(() => {
    void runPollCycle(true, true, true);
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
        const [me, todayDigest, latestDigest, status] = await Promise.all([
          api.getMe().catch(() => null),
          api.getTodayDigest().catch(() => null),
          api.getLatestDigest().catch(() => null),
          api.getBriefingGenerationStatus().catch(() => null),
        ]);
        if (cancelled) return;

        const tz = me?.profile?.digest_timezone ?? null;
        setDigestTimezone(tz);
        setUserId(me?.user.id ?? null);

        const displayDigest =
          (isValidTodayDigest(todayDigest, tz) ? todayDigest : null) ??
          (isValidTodayDigest(latestDigest, tz) ? latestDigest : null) ??
          latestDigest;
        if (displayDigest) setDigest(displayDigest);

        const alreadyHaveToday = isValidTodayDigest(todayDigest, tz);
        if (status?.status === "running" && !alreadyHaveToday) {
          ensureBriefing();
        }
      } catch {
        /* non-fatal */
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [ensureBriefing]);

  const value: BriefingGenerationContextValue = {
    digest,
    setDigest,
    digestTimezone,
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
