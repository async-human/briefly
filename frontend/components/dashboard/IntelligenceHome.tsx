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
  const [restOpen, setRestOpen] = useState(true);
  const userToggledRest = useRef(false);

  const refresh = useCallback(() => {
    Promise.all([
      api.listWatchedAlerts(true).catch(() => [] as WatchedAlert[]),
      api.listWatchedEntities().catch(() => [] as WatchedEntity[]),
    ]).then(([nextAlerts, nextEntities]) => {
      setAlerts(nextAlerts);
      setEntities(nextEntities);
    });
  }, []);

  useEffect(() => {
    void refresh();
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
          line={model.line}
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
          !generating && (
            <p className="intel-quiet">
              When something material moves in your world, it will land here — not as a feed of stories.
            </p>
          )
        )}

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
