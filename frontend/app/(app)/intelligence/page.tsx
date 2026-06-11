"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ProfileIntelligence, type WrappedSnapshot } from "@/lib/api";
import { AppPageHeader } from "@/components/dashboard/AppPageHeader";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BrieflyKnowsCard } from "@/components/intelligence/BrieflyKnowsCard";
import { WeekInFocusCard } from "@/components/intelligence/WeekInFocusCard";
import { AnimatedPageSkeleton } from "@/components/loading/AnimatedPageSkeleton";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";
import { getToken } from "@/lib/auth";

export default function IntelligencePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const showLoading = useMinLoadTime(loading);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const [intel, setIntel] = useState<ProfileIntelligence | null>(null);
  const [streak, setStreak] = useState(0);
  const [declaredProfile, setDeclaredProfile] = useState({
    role: "",
    goal: "",
    interests: [] as string[],
  });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [weekInFocus, setWeekInFocus] = useState<WrappedSnapshot | null>(null);

  async function refreshIntelligence() {
    setRefreshing(true);
    try {
      const [meData, intelData, weekData] = await Promise.all([
        api.getMe(),
        api.getProfileIntelligence(),
        api.getWeekInFocus().catch(() => null),
      ]);
      setStreak(meData.reading_streak ?? 0);
      setIntel(intelData);
      setWeekInFocus(weekData);
      setUpdatedAt(new Date());
      const p = meData.profile;
      if (p) {
        setDeclaredProfile({
          role: p.role ?? "",
          goal: p.goal ?? "",
          interests: p.interests?.map((i) => i.topic).filter(Boolean) ?? [],
        });
      }
    } catch {
      /* keep last known data */
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([
      api.getMe(),
      api.getProfileIntelligence().catch(() => null),
      api.getWeekInFocus().catch(() => null),
    ])
      .then(([meData, intelData, weekData]) => {
        if (!meData.onboarding_completed) {
          router.replace("/onboarding");
          return;
        }
        setMe({ name: meData.user.name, avatar_url: meData.user.avatar_url });
        setStreak(meData.reading_streak ?? 0);
        const p = meData.profile;
        if (p) {
          setDeclaredProfile({
            role: p.role ?? "",
            goal: p.goal ?? "",
            interests: p.interests?.map((i) => i.topic).filter(Boolean) ?? [],
          });
        }
        if (intelData) {
          setIntel(intelData);
          setUpdatedAt(new Date());
        }
        if (weekData) {
          setWeekInFocus(weekData);
        }
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && !loading) {
        void refreshIntelligence();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loading]);

  const signalCount = intel?.behavioral?.total_signals ?? 0;

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
      <div className="dash-page dash-page-intelligence">
        <AppPageHeader
          eyebrow="Intelligence"
          title="What Briefly knows"
          subtitle="How your reading shapes tomorrow's briefing — updated from saves, skips, and opens."
          stats={
            streak > 0 || signalCount > 0
              ? [
                  ...(streak > 0 ? [{ value: streak, label: "Day streak", accent: true }] : []),
                  ...(signalCount > 0
                    ? [{ value: signalCount, label: "Signals logged" }]
                    : []),
                ]
              : undefined
          }
        />

        {showLoading ? (
          <AnimatedPageSkeleton variant="intelligence" />
        ) : (
          <PageContentTransition>
            <div className="dash-page-stack">
              {weekInFocus && (
                <section id="week-in-focus" className="dash-surface dash-surface-week-focus">
                  <div className="dash-surface-body">
                    <header className="wif-page-head">
                      <div>
                        <p className="wif-page-eyebrow">Weekly snapshot</p>
                        <h2 className="wif-page-title">Your week in focus</h2>
                        <p className="wif-page-desc">
                          Patterns from your opens, saves, and skips — updated as you read.
                        </p>
                      </div>
                    </header>
                    <WeekInFocusCard wrapped={weekInFocus} variant="full" />
                  </div>
                </section>
              )}

              {intel ? (
                <div className="dash-surface dash-surface-knows">
                  <div className="dash-surface-body dash-surface-body-knows">
                    <BrieflyKnowsCard
                      intel={intel}
                      streak={streak}
                      declared={declaredProfile}
                      updatedAt={updatedAt}
                      onRefresh={() => void refreshIntelligence()}
                      refreshing={refreshing}
                    />
                  </div>
                </div>
              ) : (
                <div className="dash-surface dash-surface-knows">
                  <div className="dash-surface-body dash-surface-body-knows">
                    <p className="bk-empty-hint">
                      Your intelligence profile builds with every briefing you read.
                    </p>
                  </div>
                </div>
              )}

              <p className="intel-settings-foot">
                Want to change what Briefly tracks or filters?{" "}
                <Link href="/settings" className="intel-settings-link">
                  Edit preferences in Settings →
                </Link>
              </p>
            </div>
          </PageContentTransition>
        )}
      </div>
    </DashboardShell>
  );
}
