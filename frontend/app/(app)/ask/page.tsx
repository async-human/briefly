"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AskBrieflyView } from "@/components/ask/AskBrieflyView";
import { AnimatedPageSkeleton } from "@/components/loading/AnimatedPageSkeleton";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";

function AskPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const contentId = searchParams.get("content");
  const digestItemId = searchParams.get("item");
  const threadId = searchParams.get("thread");
  const titleParam = searchParams.get("title");

  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const anchorTitle = titleParam;
  const showLoading = useMinLoadTime(loading);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    void api
      .getMe()
      .then((m) => setMe({ name: m.user.name, avatar_url: m.user.avatar_url }))
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
      {showLoading ? (
        <AnimatedPageSkeleton variant="dashboard" />
      ) : (
        <PageContentTransition>
          <div className="dash-page dash-page-ask">
            <AskBrieflyView
              initialContentId={contentId}
              initialDigestItemId={digestItemId}
              initialThreadId={threadId}
              anchorTitle={anchorTitle}
            />
          </div>
        </PageContentTransition>
      )}
    </DashboardShell>
  );
}

export default function AskPage() {
  return (
    <Suspense
      fallback={
        <DashboardShell userName={null} avatarUrl={null}>
          <AnimatedPageSkeleton variant="dashboard" />
        </DashboardShell>
      }
    >
      <AskPageContent />
    </Suspense>
  );
}
