"use client";

import { useState } from "react";
import type { DigestItem, MemoryConnection } from "@/lib/api";
import { api } from "@/lib/api";
import { guessTrackName } from "@/lib/trackName";
import { useLearnedToast } from "@/components/dashboard/LearnedToast";
import { useGraphHub } from "./GraphHubContext";

function connectionLabel(conn: MemoryConnection): string {
  const raw = (conn.description || "").trim();
  if (raw) {
    const clipped = raw.length > 42 ? `${raw.slice(0, 39).trimEnd()}…` : raw;
    return clipped;
  }
  return "View connected note";
}

export function InlineGraphContext({
  item,
  compact = false,
}: {
  item: DigestItem;
  compact?: boolean;
}) {
  const { openHub, watchedNames, refreshWatched } = useGraphHub();
  const { showLearned } = useLearnedToast();
  const [tracking, setTracking] = useState(false);

  const callout = item.memory_reference?.trim() || item.memory_connections?.[0]?.description?.trim() || "";
  const trackName = guessTrackName(item);
  const alreadyWatched = watchedNames.has(trackName.trim().toLowerCase());
  const noteConn = item.memory_connections?.[0];
  const hasMemory = Boolean(callout || item.memory_connections?.length);

  if (!hasMemory) return null;

  function stop(event: React.MouseEvent | React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function openNote(event: React.MouseEvent) {
    stop(event);
    if (item.content_id) {
      openHub({ nodeId: `item:${item.content_id}` });
      return;
    }
    if (noteConn?.description) {
      openHub({ query: trackName || noteConn.description });
    }
  }

  async function track(event: React.MouseEvent) {
    stop(event);
    if (!trackName || tracking || alreadyWatched) return;
    setTracking(true);
    try {
      const created = await api.addWatchedEntity({ name: trackName, kind: "company" });
      refreshWatched();
      showLearned(`Tracking ${created.name}.`);
    } catch {
      /* toast is enough on success; keep silent on duplicate */
    } finally {
      setTracking(false);
    }
  }

  return (
    <div className={`inline-graph${compact ? " is-compact" : ""}`} onClick={stop}>
      {!compact && callout ? (
        <p className="inline-graph-note">
          <span className="inline-graph-kicker">Note</span>
          {callout}
        </p>
      ) : null}
      <div className="inline-graph-pills">
        <button type="button" className="inline-graph-pill" onClick={openNote}>
          {noteConn ? connectionLabel(noteConn) : "View connected note"}
        </button>
        {trackName && !alreadyWatched ? (
          <button
            type="button"
            className="inline-graph-pill inline-graph-pill-track"
            onClick={(e) => void track(e)}
            disabled={tracking}
          >
            {tracking ? "Tracking…" : `Track ${trackName}`}
          </button>
        ) : alreadyWatched ? (
          <span className="inline-graph-pill is-static">Tracking {trackName}</span>
        ) : null}
      </div>
    </div>
  );
}
