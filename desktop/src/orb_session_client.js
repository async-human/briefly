"use strict";

/**
 * Dual-mode orb session client — WebSocket when live session is enabled,
 * HTTP batch fallback otherwise.
 */
class OrbSessionClient {
  constructor(deps) {
    this.deps = deps;
    this.ws = null;
    this.ready = false;
    this.onPartialTranscript = null;
    this.onTurnResult = null;
    this.onTurnStart = null;
    this.onTurnEnd = null;
    this.onSpeechFinal = null;
    this.onSessionReady = null;
    this.onError = null;
  }

  get liveEnabled() {
    try {
      return localStorage.getItem("briefly.orbLiveSession") !== "0";
    } catch (_) {
      return true;
    }
  }

  wsUrl() {
    const base = (this.deps.apiBase || "").replace(/\/$/, "");
    const wsBase = base.replace(/^http/, "ws");
    return `${wsBase}/api/v1/orb/session/live`;
  }

  async connect() {
    if (!this.liveEnabled || !this.deps.token) return false;
    if (typeof WebSocket === "undefined") return false;
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.wsUrl());
      } catch (_) {
        resolve(false);
        return;
      }
      this.ws.onopen = () => {
        this.ws.send(
          JSON.stringify({
            type: "auth",
            token: this.deps.token,
            session_id: this.deps.sessionId || null,
            thread_id: this.deps.threadId || null,
            surface: this.deps.surface || "desktop",
          })
        );
      };
      this.ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          let frame;
          try {
            frame = JSON.parse(ev.data);
          } catch (_) {
            return;
          }
          if (frame.type === "session_ready") {
            this.ready = true;
            if (frame.session_id) this.deps.setSessionId(frame.session_id);
            if (frame.thread_id) this.deps.setThreadId(frame.thread_id);
            if (this.onSessionReady) this.onSessionReady(frame);
            resolve(true);
            return;
          }
          if (frame.type === "partial_transcript" || frame.type === "transcript") {
            if (this.onPartialTranscript) this.onPartialTranscript(frame.text, frame.is_final);
            return;
          }
          if (frame.type === "speech_final") {
            if (this.onSpeechFinal) this.onSpeechFinal(frame.text);
            return;
          }
          if (frame.type === "turn_start") {
            if (this.onTurnStart) this.onTurnStart();
            return;
          }
          if (frame.type === "turn_result") {
            if (this.onTurnResult) this.onTurnResult(frame);
            return;
          }
          if (frame.type === "turn_end") {
            if (this.onTurnEnd) this.onTurnEnd(frame);
            return;
          }
          if (frame.type === "error" && this.onError) this.onError(frame.message);
        }
      };
      this.ws.onerror = () => resolve(false);
      this.ws.onclose = () => {
        this.ready = false;
      };
      setTimeout(() => {
        if (!this.ready) resolve(false);
      }, 4000);
    });
  }

  sendAudio(chunk) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  sendTextTurn(text) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "text_turn", text }));
    }
  }

  interrupt() {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }

  close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.ready = false;
  }
}
