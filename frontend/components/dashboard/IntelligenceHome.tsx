"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
};

export function IntelligenceHome({
  digest,
  name,
  dateLabel,
  generating,
}: IntelligenceHomeProps) {
  const [alerts, setAlerts] = useState<WatchedAlert[]>([]);
  const [entities, setEntities] = useState<WatchedEntity[]>([]);
  const [greeting] = useState(() => getTimeGreeting().label);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(false);

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

  return (
    <section className="intel-home" aria-label="Today at a glance">
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
        <div className="intel-stack">
          <p className="intel-stack-label">
            {model.cards.length === 1
              ? "1 thing deserves your attention"
              : `${model.cards.length} things deserve your attention`}
          </p>
          <ul className="intel-stack-list">
            {model.cards.map((obj) => (
              <li key={obj.id}>
                <IntelligenceCard object={obj} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        !generating && (
          <p className="intel-quiet">
            When something material moves in your world, it will land here — not as a feed of stories.
          </p>
        )
      )}

      {model.action ? (
        <p className="intel-do">
          <span className="intel-do-kicker">Do this</span>
          <Link href={model.action.href} className="intel-do-link">
            {model.action.label}
          </Link>
        </p>
      ) : null}

      {entities.length > 0 ? (
        <div className="intel-scan-wrap">
          <button
            type="button"
            className="dash-btn dash-btn-secondary intel-scan"
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
  );
}
