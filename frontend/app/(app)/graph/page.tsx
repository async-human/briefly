"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type KnowledgeGraphResponse } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { GraphPageSkeleton } from "@/components/graph/GraphPageSkeleton";
import { KnowledgeGraphView } from "@/components/graph/KnowledgeGraphView";
import { getToken } from "@/lib/auth";

function GraphPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<KnowledgeGraphResponse | null>(null);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api.getMe(), api.getKnowledgeGraph()])
      .then(([meData, graphData]) => {
        setMe({ name: meData.user.name, avatar_url: meData.user.avatar_url });
        setGraph(graphData);
      })
      .catch((err) => {
        if (err instanceof Error && err.message.includes("401")) {
          router.replace("/login");
          return;
        }
        setError(err instanceof Error ? err.message : "Could not load knowledge graph.");
      })
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
      {loading ? (
        <GraphPageSkeleton />
      ) : error ? (
        <div className="dash-page">
          <p className="form-error">{error}</p>
        </div>
      ) : graph ? (
        <div className="dash-page-graph">
          <KnowledgeGraphView data={graph} />
        </div>
      ) : null}
    </DashboardShell>
  );
}

export default function GraphPage() {
  return (
    <Suspense
      fallback={
        <DashboardShell userName={null} avatarUrl={null}>
          <GraphPageSkeleton />
        </DashboardShell>
      }
    >
      <GraphPageContent />
    </Suspense>
  );
}
