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

  _apiBase() {
    if (typeof this.deps.getApiBase === "function") return this.deps.getApiBase();
    return this.deps.apiBase || "";
  }

  _token() {
    if (typeof this.deps.getToken === "function") return this.deps.getToken();
    return this.deps.token || "";
  }

  _sessionId() {
    if (typeof this.deps.getSessionId === "function") return this.deps.getSessionId();
    return this.deps.sessionId || null;
  }

  _threadId() {
    if (typeof this.deps.getThreadId === "function") return this.deps.getThreadId();
    return this.deps.threadId || null;
  }

  wsUrl() {
    const base = this._apiBase().replace(/\/$/, "");
    const wsBase = base.replace(/^http/, "ws");
    return `${wsBase}/api/v1/orb/session/live`;
  }

  async connect() {
    const token = this._token();
    if (!this.liveEnabled || !token) return false;
    if (typeof WebSocket === "undefined") return false;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        this.ws = new WebSocket(this.wsUrl());
      } catch (_) {
        finish(false);
        return;
      }
      this.ws.onopen = () => {
        this.ws.send(
          JSON.stringify({
            type: "auth",
            token,
            session_id: this._sessionId(),
            thread_id: this._threadId(),
            surface: this.deps.surface || "desktop",
          })
        );
      };
      this.ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
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
          finish(true);
          return;
        }
        if (frame.type === "error") {
          if (this.onError) this.onError(frame.message || "WebSocket error");
          finish(false);
          return;
        }
        if (frame.type === "partial_transcript" || frame.type === "transcript") {
          if (this.onPartialTranscript) {
            this.onPartialTranscript(frame.text, frame.type === "transcript" || frame.is_final);
          }
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
        }
      };
      this.ws.onerror = () => finish(false);
      this.ws.onclose = () => {
        this.ready = false;
        finish(false);
      };
      setTimeout(() => finish(false), 4000);
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
