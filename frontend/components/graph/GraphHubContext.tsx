"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type WatchedEntity } from "@/lib/api";
import { EntityHubDrawer } from "./EntityHubDrawer";

export type HubTarget = { nodeId?: string; query?: string };

type GraphHubContextValue = {
  openHub: (target: HubTarget) => void;
  closeHub: () => void;
  target: HubTarget | null;
  watchedNames: Set<string>;
  refreshWatched: () => void;
};

const GraphHubContext = createContext<GraphHubContextValue>({
  openHub: () => {},
  closeHub: () => {},
  target: null,
  watchedNames: new Set(),
  refreshWatched: () => {},
});

export function useGraphHub() {
  return useContext(GraphHubContext);
}

export function GraphHubProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HubTarget | null>(null);
  const [watched, setWatched] = useState<WatchedEntity[]>([]);

  const refreshWatched = useCallback(() => {
    api.listWatchedEntities().then(setWatched).catch(() => {});
  }, []);

  useEffect(() => {
    refreshWatched();
  }, [refreshWatched]);

  const openHub = useCallback((next: HubTarget) => {
    if (!next.nodeId && !next.query) return;
    setTarget(next);
  }, []);

  const closeHub = useCallback(() => setTarget(null), []);

  const watchedNames = useMemo(
    () => new Set(watched.map((e) => e.name.trim().toLowerCase()).filter(Boolean)),
    [watched],
  );

  const value = useMemo(
    () => ({ openHub, closeHub, target, watchedNames, refreshWatched }),
    [openHub, closeHub, target, watchedNames, refreshWatched],
  );

  return (
    <GraphHubContext.Provider value={value}>
      {children}
      <EntityHubDrawer />
    </GraphHubContext.Provider>
  );
}
