/* Save to Briefly — PWA share target.
 *
 * Flow:
 *  - First run: user pastes a capture device token (bcap_…) from Briefly settings.
 *  - When a link is shared to the installed app, the OS opens index.html with the
 *    shared title/text/url as query params (Web Share Target, GET). We extract the
 *    URL and POST it to /api/v1/capture/url with the stored token.
 */
(function () {
  "use strict";

  const CONFIG = window.BRIEFLY_PWA_CONFIG || {};
  const TOKEN_KEY = "briefly.captureToken";
  const $ = (id) => document.getElementById(id);

  const panels = { capture: $("capture"), connect: $("connect"), idle: $("idle") };
  function show(name) {
    Object.entries(panels).forEach(([k, el]) => el.classList.toggle("hidden", k !== name));
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ }
  }
  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  const URL_RE = /\bhttps?:\/\/[^\s]+/i;

  // A shared link can land in `url`, or be embedded in `text` (common on Android).
  function sharedUrlFrom(params) {
    const direct = (params.get("url") || "").trim();
    if (URL_RE.test(direct)) return direct;
    const text = (params.get("text") || "").trim();
    const match = text.match(URL_RE);
    if (match) return match[0];
    if (URL_RE.test(text)) return text;
    return null;
  }

  async function capture(url, title) {
    const token = getToken();
    if (!token) throw new Error("Not connected.");
    const res = await fetch(`${CONFIG.apiUrl}/api/v1/capture/url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url, title: title || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data.detail === "string" ? data.detail : "Couldn't save this link.";
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function renderResult(data) {
    show("capture");
    $("capture-status").textContent = data.already_saved ? "Already saved ✓" : "Saved ✓";
    $("capture-title").textContent = data.title ? `"${data.title}"` : "";
    const enrichment = data.enrichment || {};
    const connection =
      enrichment.connection_sentence ||
      (enrichment.thread_label ? `Connects to your ${enrichment.thread_label} thread` : null);
    const connEl = $("capture-connection");
    if (connection) { connEl.textContent = connection; connEl.classList.remove("hidden"); }
    $("capture-note").textContent = enrichment.briefing_message || "It'll appear in tomorrow's briefing.";
    const open = $("capture-open");
    open.href = `${CONFIG.frontendUrl}/dashboard`;
    open.classList.remove("hidden");
  }

  async function runShare(url, title) {
    show("capture");
    $("capture-status").textContent = "Saving…";
    $("capture-title").textContent = url;
    try {
      renderResult(await capture(url, title));
    } catch (err) {
      $("capture-status").textContent = "Couldn't save";
      $("capture-note").textContent = err.message || "Something went wrong.";
      if (err.status === 401) {
        clearToken();
        setTimeout(() => initConnect("Your device token was rejected — reconnect this device."), 1200);
      }
    }
  }

  function initConnect(errorMsg) {
    show("connect");
    const link = $("get-token-link");
    link.href = `${CONFIG.frontendUrl}${CONFIG.tokenSettingsPath || "/settings"}`;
    const errEl = $("connect-error");
    if (errorMsg) { errEl.textContent = errorMsg; errEl.classList.remove("hidden"); }

    $("token-save").onclick = () => {
      const value = $("token-input").value.trim();
      if (!value.startsWith("bcap_")) {
        errEl.textContent = "That doesn't look like a device token (starts with bcap_).";
        errEl.classList.remove("hidden");
        return;
      }
      setToken(value);
      start(); // re-evaluate now that we're connected
    };
  }

  function initIdle() {
    show("idle");
    $("manual-save").onclick = async () => {
      const url = $("manual-url").value.trim();
      if (!URL_RE.test(url)) return;
      await runShare(url, null);
    };
    $("disconnect").onclick = () => { clearToken(); initConnect(); };
  }

  function start() {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = sharedUrlFrom(params);
    const title = (params.get("title") || "").trim() || null;

    if (!getToken()) { initConnect(); return; }
    if (sharedUrl) { runShare(sharedUrl, title); return; }
    initIdle();
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* non-fatal */ });
  }

  start();
})();
