"use client";

import { api } from "@/lib/api";
import { API_URL } from "@/lib/auth";

const LAST_ATTEMPT_KEY = "briefly.desktop_orb.last_attempt_at";
const ATTEMPT_COOLDOWN_MS = 1000 * 60 * 2;

function canAttemptNow(): boolean {
  const raw = localStorage.getItem(LAST_ATTEMPT_KEY);
  const last = raw ? Number(raw) : 0;
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last > ATTEMPT_COOLDOWN_MS;
}

function markAttempt(): void {
  localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now()));
}

function openDesktopLink(token: string): void {
  const deepLink =
    `briefly://auth?token=${encodeURIComponent(token)}&api_base=${encodeURIComponent(API_URL)}`;
  // Use location for reliability plus hidden iframe for browsers that block
  // top-level custom-scheme navigations.
  window.location.href = deepLink;
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = deepLink;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 3000);
}

/** Public helper for the desktop connect page (manual link flow). */
export function openDesktopOrbLink(token: string): void {
  openDesktopLink(token);
}

export function desktopConnectPageUrl(): string {
  const app =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    "https://app.sendbriefly.app";
  return `${app.replace(/\/$/, "")}/desktop/connect`;
}

/** Best-effort zero-setup desktop orb handoff after web login. */
export async function ensureDesktopOrbLinked(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!canAttemptNow()) return;
  markAttempt();
  try {
    const created = await api.createCaptureToken({
      name: `Desktop Orb (${window.navigator.platform || "desktop"})`,
      platform: "desktop",
    });
    if (!created?.token) return;
    openDesktopLink(created.token);
  } catch {
    // Silent: desktop linking is opportunistic and should never block login.
  }
}

