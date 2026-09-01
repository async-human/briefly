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
  const [scanResult, setScanResult] = useState<{ entities: number; newAlerts: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [setupWarning, setSetupWarning] = useState("");
  const [restOpen, setRestOpen] = useState(true);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
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
    setScanResult(null);
    try {
      const result = await api.scanWatchedEntities();
      const unread = result.alerts.filter((alert) => !alert.is_read);
      const unreadByEntity = new Map<string, number>();
      for (const alert of unread) {
        unreadByEntity.set(alert.entity_id, (unreadByEntity.get(alert.entity_id) ?? 0) + 1);
      }
      const freshEntities = await api.listWatchedEntities().catch(() => null);

      setAlerts(unread);
      if (freshEntities) {
        setEntities(freshEntities.map((entity) => ({
          ...entity,
          unread_count: unreadByEntity.get(entity.id) ?? entity.unread_count ?? 0,
        })));
      } else {
        setEntities((previous) => previous.map((entity) => ({
          ...entity,
          unread_count: unreadByEntity.get(entity.id) ?? 0,
        })));
      }
      setScanResult({ entities: result.entities, newAlerts: result.new_alerts });
    } catch {
      setScanError(true);
    } finally {
      setScanning(false);
    }
  }

  const model = buildMorningPulse({ digest, alerts, entities, generating });
  const selectedNode = model.nodes.find((node) => node.id === selectedEntityId) || null;
  const visibleCards = selectedNode
    ? model.cards.filter((card) => selectedNode.cardIds.includes(card.id))
    : model.cards;
  const briefCount = digest?.items?.length ?? 0;

  useEffect(() => {
    if (selectedEntityId && !model.nodes.some((node) => node.id === selectedEntityId)) {
      setSelectedEntityId(null);
    }
  }, [model.nodes, selectedEntityId]);

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
          watchCount={model.watchCount}
          pendingCheckCount={model.pendingCheckCount}
          lastCheckedAt={model.lastCheckedAt}
          nodes={model.nodes}
          connectionLabel={model.connectionLabel}
          generating={generating}
          scanning={scanning}
          scanError={scanError}
          scanResult={scanResult}
          onScan={() => void scanWatching()}
          selectedNodeId={selectedEntityId}
          onSelectNode={(nodeId) => {
            setSelectedEntityId((current) => current === nodeId ? null : nodeId);
          }}
          onClearSelection={() => setSelectedEntityId(null)}
        />

        {model.pendingCheckCount > 0 && !scanning && !loadError ? (
          <p className="intel-pending-scan" role="status">
            <button type="button" className="intel-pending-scan-action" onClick={() => void scanWatching()}>
              Check now
            </button>
            {" "}
            to run the first source scan for{" "}
            {model.pendingCheckCount === 1 ? "your new watch" : `${model.pendingCheckCount} new watches`}.
          </p>
        ) : null}

        {visibleCards.length > 0 ? (
          <ul
            id="dashboard-intelligence-list"
            className="intel-stack-list"
            aria-label={selectedNode ? `Intelligence connected to ${selectedNode.name}` : undefined}
          >
            {visibleCards.map((obj) => (
              <li key={obj.id}>
                <IntelligenceCard object={obj} />
              </li>
            ))}
          </ul>
        ) : selectedNode ? (
          <p className="intel-quiet" role="status">
            No featured intelligence card is attached to {selectedNode.name} today. Its latest
            monitoring signal is summarized above.
          </p>
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
