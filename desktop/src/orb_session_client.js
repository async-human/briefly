"use strict";

/**
 * Production WebSocket session for the voice orb — live STT, streaming LLM turns,
 * auto-reconnect, and client-side TTS.
 */
class OrbSessionClient {
  constructor(deps) {
    this.deps = deps;
    this.ws = null;
    this.ready = false;
    this.streamingStt = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.intentionalClose = false;

    this.onPartialTranscript = null;
    this.onTurnStart = null;
    this.onTurnMeta = null;
    this.onTurnDelta = null;
    this.onTurnComplete = null;
    this.onTurnEnd = null;
    this.onSpeechFinal = null;
    this.onSessionReady = null;
    this.onSttReady = null;
    this.onError = null;
    this.onDisconnected = null;
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

  _clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.intentionalClose || !this.liveEnabled || !this._token()) return;
    const delay = Math.min(30000, 800 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  _startPing() {
    this._clearTimers();
    this.pingTimer = setInterval(() => {
      this.sendJson({ type: "ping" });
    }, 25000);
  }

  sendJson(payload) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  async connect() {
    const token = this._token();
    if (!this.liveEnabled || !token) return false;
    if (typeof WebSocket === "undefined") return false;

    this.intentionalClose = false;
    this._clearTimers();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      try {
        if (this.ws) {
          try { this.ws.close(); } catch (_) {}
          this.ws = null;
        }
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
          }),
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
        this._handleFrame(frame, finish);
      };

      this.ws.onerror = () => {
        if (!settled) finish(false);
      };

      this.ws.onclose = () => {
        this.ready = false;
        this._clearTimers();
        if (this.onDisconnected) this.onDisconnected();
        if (!this.intentionalClose) this._scheduleReconnect();
        if (!settled) finish(false);
      };

      setTimeout(() => finish(false), 6000);
    });
  }

  _handleFrame(frame, connectFinish) {
    const type = frame.type;
    if (type === "session_ready") {
      this.ready = true;
      this.reconnectAttempts = 0;
      this.streamingStt = !!frame.streaming_stt;
      if (frame.session_id) this.deps.setSessionId(frame.session_id);
      if (frame.thread_id) this.deps.setThreadId(frame.thread_id);
      if (this.onSessionReady) this.onSessionReady(frame);
      this._startPing();
      if (connectFinish) connectFinish(true);
      return;
    }
    if (type === "stt_ready") {
      this.streamingStt = !!frame.streaming_stt;
      if (this.onSttReady) this.onSttReady(frame);
      if (this._prepareListenResolve) {
        this._prepareListenResolve(this.streamingStt);
        this._prepareListenResolve = null;
      }
      return;
    }
    if (type === "error") {
      if (this.onError) this.onError(frame.message || "WebSocket error");
      if (connectFinish) connectFinish(false);
      return;
    }
    if (type === "pong") return;

    if (type === "partial_transcript" || type === "transcript") {
      if (this.onPartialTranscript) {
        this.onPartialTranscript(frame.text, type === "transcript" || frame.is_final);
      }
      return;
    }
    if (type === "speech_final") {
      if (this.onSpeechFinal) this.onSpeechFinal(frame.text);
      return;
    }
    if (type === "turn_start") {
      if (this.onTurnStart) this.onTurnStart(frame);
      return;
    }
    if (type === "turn_meta") {
      if (this.onTurnMeta) this.onTurnMeta(frame);
      return;
    }
    if (type === "turn_delta") {
      if (this.onTurnDelta) this.onTurnDelta(frame.content || "");
      return;
    }
    if (type === "turn_complete") {
      if (this.onTurnComplete) this.onTurnComplete(frame);
      return;
    }
    if (type === "turn_end") {
      if (this.onTurnEnd) this.onTurnEnd(frame);
      return;
    }
    // Legacy batch turn_result (fallback)
    if (type === "turn_result") {
      if (this.onTurnComplete) this.onTurnComplete(frame);
    }
  }

  sendAudio(chunk) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN && chunk) {
      this.ws.send(chunk);
    }
  }

  sendEndUtterance() {
    this.sendJson({ type: "end_utterance" });
  }

  prepareListen() {
    if (!this.ready) return Promise.resolve(false);
    return new Promise((resolve) => {
      if (this._prepareListenResolve) {
        this._prepareListenResolve(false);
      }
      this._prepareListenResolve = resolve;
      this.sendJson({ type: "prepare_listen" });
      setTimeout(() => {
        if (this._prepareListenResolve === resolve) {
          this._prepareListenResolve = null;
          resolve(this.streamingStt);
        }
      }, 4000);
    });
  }

  sendTextTurn(text) {
    this.sendJson({ type: "text_turn", text });
  }

  interrupt() {
    this.sendJson({ type: "interrupt" });
  }

  close() {
    this.intentionalClose = true;
    this._clearTimers();
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.ready = false;
    this.streamingStt = false;
  }
}
