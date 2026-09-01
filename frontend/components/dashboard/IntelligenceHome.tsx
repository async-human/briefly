"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Digest, type WatchedAlert, type WatchedEntity } from "@/lib/api";
import { getTimeGreeting } from "@/lib/greeting";
import { buildMorningPulse } from "@/lib/intelligenceHome";
import { IntelligenceCard } from "./IntelligenceCard";
import { MorningPulse } from "./MorningPulse";

type IntelligenceHomeProps = {
  digest: Digest | null;
  name: string;
  dateLabel: string;
  generating: boolean;
  children?: ReactNode;
};

export function IntelligenceHome({
  digest,
  name,
  dateLabel,
  generating,
  children,
}: IntelligenceHomeProps) {
  const [alerts, setAlerts] = useState<WatchedAlert[]>([]);
  const [entities, setEntities] = useState<WatchedEntity[]>([]);
  const [greeting] = useState(() => getTimeGreeting().label);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [setupWarning, setSetupWarning] = useState("");
  const [restOpen, setRestOpen] = useState(true);
  const userToggledRest = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [nextAlerts, nextEntities] = await Promise.all([
        api.listWatchedAlerts(true),
        api.listWatchedEntities(),
      ]);
      setAlerts(nextAlerts);
      setEntities(nextEntities);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const warning = sessionStorage.getItem("briefly:monitoring-setup-warning") || "";
    if (warning) {
      setSetupWarning(warning);
      sessionStorage.removeItem("briefly:monitoring-setup-warning");
    }
  }, [refresh]);

  async function scanWatching() {
    if (scanning || entities.length === 0) return;
    setScanning(true);
    setScanError(false);
    try {
      const result = await api.scanWatchedEntities();
      setAlerts(result.alerts.filter((a) => !a.is_read));
      setEntities((prev) =>
        prev.map((ent) => ({
          ...ent,
          unread_count: result.alerts.filter((a) => !a.is_read && a.entity_id === ent.id).length,
        })),
      );
    } catch {
      setScanError(true);
    } finally {
      setScanning(false);
    }
  }

  const model = buildMorningPulse({ digest, alerts, entities, generating });
  const scanState = scanning ? "loading" : scanError ? "error" : undefined;
  const briefCount = digest?.items?.length ?? 0;

  useEffect(() => {
    if (userToggledRest.current) return;
    if (generating) {
      setRestOpen(true);
      return;
    }
    setRestOpen(model.cards.length === 0);
  }, [generating, model.cards.length]);

  return (
    <div className="intel-home">
      <section aria-label="Today at a glance">
        <MorningPulse
          greeting={`${greeting}, ${name}`}
          dateLabel={dateLabel}
          line={loadError ? "Monitoring data is temporarily unavailable." : model.line}
          changeCount={model.changeCount}
          decisionCount={model.decisionCount}
          urgentCount={model.urgentCount}
          nodes={model.nodes}
          connectionLabel={model.connectionLabel}
          generating={generating}
        />

        {model.cards.length > 0 ? (
          <ul className="intel-stack-list">
            {model.cards.map((obj) => (
              <li key={obj.id}>
                <IntelligenceCard object={obj} />
              </li>
            ))}
          </ul>
        ) : (
          !generating && !loadError && (
            <p className="intel-quiet">
              When something material moves in your world, it will land here — not as a feed of stories.
            </p>
          )
        )}

        {loadError ? (
          <p className="intel-scan-error" role="alert">
            Briefly couldn’t load your monitoring data. This is not an all-clear.
          </p>
        ) : null}
        {setupWarning ? (
          <p className="intel-scan-error" role="status">{setupWarning}</p>
        ) : null}

        {entities.length > 0 ? (
          <div className="intel-scan-wrap">
            <button
              type="button"
              className="intel-scan"
              onClick={() => void scanWatching()}
              disabled={scanning}
              data-state={scanState}
              aria-busy={scanning}
            >
              {scanning ? "Checking sources…" : "Check watching sources"}
            </button>
            {scanError ? (
              <p className="intel-scan-error" role="alert">
                Couldn’t check sources. Try again.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {children ? (
        <details
          className="intel-rest"
          open={restOpen}
          onToggle={(event) => {
            if (!event.isTrusted) return;
            userToggledRest.current = true;
            setRestOpen((event.target as HTMLDetailsElement).open);
          }}
        >
          <summary className="intel-rest-summary">
            <span className="intel-rest-title">The rest of today</span>
            {briefCount > 0 ? (
              <span className="intel-rest-count">
                {briefCount} in the briefing
              </span>
            ) : null}
          </summary>
          <div className="intel-rest-body">{children}</div>
        </details>
      ) : null}
    </div>
  );
}
