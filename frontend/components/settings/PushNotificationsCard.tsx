"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  disablePush,
  enablePush,
  getPushState,
  type PushState,
} from "@/lib/push";

export function PushNotificationsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  async function refresh() {
    setState(await getPushState());
  }

  async function handleEnable() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await enablePush();
      if (res.ok) {
        setMsg({ kind: "ok", text: "Notifications on. Try the test below." });
      } else {
        setMsg({ kind: "err", text: res.reason ?? "Could not enable notifications." });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not enable notifications." });
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setMsg(null);
    try {
      await disablePush();
      setMsg({ kind: "info", text: "Notifications turned off for this device." });
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMsg(null);
    try {
      const { sent } = await api.sendTestPush();
      setMsg(
        sent > 0
          ? { kind: "ok", text: `Test sent to ${sent} device${sent === 1 ? "" : "s"} — watch for it.` }
          : { kind: "err", text: "No active subscription received it. Enable notifications first." },
      );
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not send test." });
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    setBusy(true);
    setMsg(null);
    try {
      const { queued, delivered } = await api.triggerProactive();
      if (delivered > 0) {
        setMsg({ kind: "ok", text: `Sent ${delivered} real alert${delivered === 1 ? "" : "s"} — watch for it.` });
      } else if (queued > 0) {
        setMsg({ kind: "info", text: "Queued an alert, but no device received it — enable notifications first." });
      } else {
        setMsg({
          kind: "info",
          text: "Nothing to surface yet — run a digest (and connect Calendar) so Briefly has relevant content to alert on.",
        });
      }
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not preview alerts." });
    } finally {
      setBusy(false);
    }
  }

  if (state && !state.supported) {
    return (
      <p className="dash-surface-desc">
        This browser doesn&apos;t support web push notifications. Try Chrome, Edge, or Firefox on
        desktop, or install Briefly to your home screen on mobile.
      </p>
    );
  }

  const subscribed = state?.subscribed ?? false;
  const blocked = state?.permission === "denied";

  return (
    <div className="push-card">
      <div className="push-card-status">
        <span className={`push-status-dot ${subscribed ? "is-on" : ""}`} aria-hidden />
        <span className="push-status-text">
          {blocked
            ? "Notifications are blocked in your browser settings."
            : subscribed
              ? "On for this device."
              : "Off — turn on to get proactive pings."}
        </span>
      </div>

      <div className="push-card-actions">
        {subscribed ? (
          <>
            <button type="button" className="dash-btn dash-btn-primary" onClick={handleTest} disabled={busy}>
              Send test notification
            </button>
            <button type="button" className="dash-btn dash-btn-secondary" onClick={handlePreview} disabled={busy}>
              Preview a real alert
            </button>
            <button type="button" className="dash-btn dash-btn-secondary" onClick={handleDisable} disabled={busy}>
              Turn off
            </button>
          </>
        ) : (
          <button type="button" className="dash-btn dash-btn-primary" onClick={handleEnable} disabled={busy || blocked}>
            {busy ? "Working…" : "Enable notifications"}
          </button>
        )}
      </div>

      {state && !state.enabledServerSide && (
        <p className="push-card-note">
          Heads up: the server has no VAPID keys set yet, so pushes won&apos;t send until
          <code> VAPID_PUBLIC_KEY</code> / <code>VAPID_PRIVATE_KEY</code> are configured.
        </p>
      )}

      {msg && <p className={`push-card-msg push-card-msg--${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}
