"use client";

import { useEffect, useRef, useState } from "react";
import { api, type TelegramStatus } from "@/lib/api";

export function TelegramConnectCard() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void api.getTelegramStatus().then(setStatus).catch(() => setStatus(null));
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function startPolling() {
    setWaiting(true);
    let elapsed = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      elapsed += 3;
      try {
        const s = await api.getTelegramStatus();
        if (s.connected) {
          setStatus(s);
          setWaiting(false);
          setMsg({ kind: "ok", text: "Connected! You can now chat with Briefly on Telegram." });
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        /* keep polling */
      }
      if (elapsed >= 180 && pollRef.current) {
        clearInterval(pollRef.current);
        setWaiting(false);
      }
    }, 3000);
  }

  async function handleConnect() {
    setBusy(true);
    setMsg(null);
    try {
      const { deep_link } = await api.createTelegramLinkCode();
      window.open(deep_link, "_blank", "noopener,noreferrer");
      startPolling();
      setMsg({ kind: "info", text: "Telegram opened — tap Start in the chat, then come back here." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not start the connection." });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setMsg(null);
    try {
      await api.disconnectTelegram();
      setStatus({ connected: false, voice_replies: true, proactive_enabled: true });
      setMsg({ kind: "info", text: "Disconnected from Telegram." });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Could not disconnect." });
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoice() {
    if (!status) return;
    const next = !status.voice_replies;
    setStatus({ ...status, voice_replies: next });
    try {
      const s = await api.updateTelegramPrefs({ voice_replies: next });
      setStatus(s);
    } catch {
      setStatus({ ...status, voice_replies: !next });
    }
  }

  const connected = status?.connected ?? false;

  return (
    <div className="push-card">
      <div className="push-card-status">
        <span className={`push-status-dot ${connected ? "is-on" : ""}`} aria-hidden />
        <span className="push-status-text">
          {connected
            ? `Connected${status?.username ? ` as @${status.username}` : ""}.`
            : "Not connected — link Telegram to get your brief and ask Briefly by text or voice."}
        </span>
      </div>

      <div className="push-card-actions">
        {connected ? (
          <>
            <label className="telegram-voice-toggle">
              <input
                type="checkbox"
                checked={status?.voice_replies ?? true}
                onChange={() => void toggleVoice()}
              />
              Voice-note replies
            </label>
            <button type="button" className="dash-btn dash-btn-secondary" onClick={handleDisconnect} disabled={busy}>
              Disconnect
            </button>
          </>
        ) : (
          <button type="button" className="dash-btn dash-btn-primary" onClick={handleConnect} disabled={busy || waiting}>
            {waiting ? "Waiting for Telegram…" : busy ? "Working…" : "Connect Telegram"}
          </button>
        )}
      </div>

      {msg && <p className={`push-card-msg push-card-msg--${msg.kind}`}>{msg.text}</p>}
    </div>
  );
}
