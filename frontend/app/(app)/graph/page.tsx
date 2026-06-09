"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type KnowledgeGraphResponse } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { GraphPageSkeleton } from "@/components/graph/GraphPageSkeleton";
import { KnowledgeGraphView } from "@/components/graph/KnowledgeGraphView";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";
import { getToken } from "@/lib/auth";
import type { GraphTimeRange, GraphViewFilter } from "@/lib/graphLinks";

function parseDaysParam(value: string | null): GraphTimeRange | null {
  if (value === "7" || value === "30" || value === "90") return Number(value) as GraphTimeRange;
  return null;
}

function GraphPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusNodeId = searchParams.get("node");
  const viewFilter = (searchParams.get("filter") === "thread" ? "thread" : null) as GraphViewFilter | null;
  const days = parseDaysParam(searchParams.get("days"));

  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<KnowledgeGraphResponse | null>(null);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const [error, setError] = useState("");
  const showLoading = useMinLoadTime(loading);

  const loadGraph = useCallback(() => {
    return api.getKnowledgeGraph(days ?? undefined).then(setGraph);
  }, [days]);

  const updateViewParams = useCallback(
    (next: { filter?: GraphViewFilter | null; days?: GraphTimeRange | null }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next.filter === "thread") {
        params.set("filter", "thread");
      } else if (next.filter === null) {
        params.delete("filter");
      }
      if (next.days) {
        params.set("days", String(next.days));
      } else if (next.days === null) {
        params.delete("days");
      }
      const qs = params.toString();
      router.replace(qs ? `/graph?${qs}` : "/graph");
    },
    [router, searchParams],
  );

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    Promise.all([api.getMe(), api.getKnowledgeGraph(days ?? undefined)])
      .then(([meData, graphData]) => {
        setMe({ name: meData.user.name, avatar_url: meData.user.avatar_url });
        setGraph(graphData);
        setError("");
      })
      .catch((err) => {
        if (err instanceof Error && err.message.includes("401")) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load knowledge graph.");
      })
      .finally(() => setLoading(false));
  }, [router, days]);

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
      {showLoading ? (
        <div className="dash-page-graph">
          <GraphPageSkeleton />
        </div>
      ) : error ? (
        <div className="dash-page">
          <p className="form-error">{error}</p>
        </div>
      ) : graph ? (
        <PageContentTransition>
          <div className="dash-page-graph">
            <KnowledgeGraphView
              data={graph}
              initialFocusNodeId={focusNodeId}
              viewFilter={viewFilter}
              timeRangeDays={days}
              onViewChange={updateViewParams}
              onGraphUpdated={() => void loadGraph()}
            />
          </div>
        </PageContentTransition>
      ) : null}
    </DashboardShell>
  );
}

export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <DashboardShell userName={null} avatarUrl={null}>
          <div className="dash-page-graph">
            <GraphPageSkeleton />
          </div>
        </DashboardShell>
      }
    >
      <GraphPageContent />
    </Suspense>
  );
}
