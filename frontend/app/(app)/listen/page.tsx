"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Digest, type MeResponse } from "@/lib/api";
import { VoiceOrb } from "@/components/VoiceOrb";
import { InstallPrompt } from "@/components/InstallPrompt";
import "@/styles/voice.css";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function ListenPage() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getMe().catch(() => null),
      api.getTodayDigest().catch(() => null),
    ])
      .then(([m, d]) => {
        if (!active) return;
        setMe(m);
        setDigest(d);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const name = me?.user?.name ? me.user.name.split(" ")[0] : "";

  return (
    <main className="vo-page">
      <header className="vo-page-head">
        <span className="vo-greeting">
          {greeting()}
          {name ? `, ${name}` : ""}
        </span>
        <Link href="/dashboard" className="vo-open">
          Open full briefing →
        </Link>
      </header>

      <div className="vo-stage">
        {loading ? (
          <div className="vo-loading" aria-label="Loading">
            <span className="vo-loading-dot" />
            <span className="vo-loading-dot" />
            <span className="vo-loading-dot" />
          </div>
        ) : (
          <VoiceOrb digest={digest} userName={name} autoSpeak />
        )}
      </div>

      <footer className="vo-page-foot">
        <InstallPrompt />
        <p className="vo-foot-hint">
          Tip: after installing, enable “Start on login” in your browser&apos;s app
          settings so Briefly greets you each morning.
        </p>
      </footer>
    </main>
  );
}
