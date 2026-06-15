const $ = (id) => document.getElementById(id);

const panels = {
  connect: $("state-connect"),
  loading: $("state-loading"),
  success: $("state-success"),
  error: $("state-error"),
};

const NON_PAGE_PREFIXES = [
  "chrome:",
  "chrome-extension:",
  "edge:",
  "about:",
  "devtools:",
  "view-source:",
  "chrome-devtools:",
];

let settings = {
  apiUrl: BRIEFLY_CONFIG.apiUrl,
  frontendUrl: BRIEFLY_CONFIG.frontendUrl,
  token: null,
};
let lastCapture = null;
let lastTab = null;

function showPanel(name) {
  Object.entries(panels).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, resolve);
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSaveableUrl(url) {
  if (!url) return false;
  if (NON_PAGE_PREFIXES.some((prefix) => url.startsWith(prefix))) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

function pageErrorMessage() {
  const url = lastTab?.url ?? "";
  if (!url) return "No page URL found.";
  if (!isSaveableUrl(url)) {
    return "Open a normal web page (article, blog, or news story) and try again.";
  }
  return "Something went wrong.";
}

async function captureCurrentTab(note) {
  if (!isSaveableUrl(lastTab?.url)) {
    throw new Error(pageErrorMessage());
  }
  if (!settings.token) throw new Error("Not connected to Briefly.");

  const body = {
    url: lastTab.url,
    title: lastTab.title || undefined,
  };
  if (note) body.note = note;

  const res = await fetch(`${settings.apiUrl}/api/v1/capture/url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      const err = new Error("AUTH_EXPIRED");
      err.code = "AUTH_EXPIRED";
      throw err;
    }
    const detail = typeof data.detail === "string" ? data.detail : "Capture failed.";
    throw new Error(detail);
  }
  return data;
}

function renderSuccess(data) {
  lastCapture = data;
  $("success-label").textContent = data.already_saved ? "Already in Briefly" : "Added to Briefly";
  $("result-title").textContent = data.title ? `"${data.title}"` : "Saved";

  const enrichment = data.enrichment || {};
  const connectionEl = $("result-connection");
  const connectionText =
    enrichment.connection_sentence ||
    (enrichment.thread_label
      ? `Connects to your ${enrichment.thread_label} thread${
          enrichment.thread_item_count ? ` (${enrichment.thread_item_count} this week)` : ""
        }`
      : null);

  if (connectionText) {
    connectionEl.textContent = connectionText;
    connectionEl.classList.remove("hidden");
  } else {
    connectionEl.classList.add("hidden");
  }

  $("result-briefing").textContent =
    enrichment.briefing_message || "Will appear in tomorrow's briefing.";

  $("btn-view").href = `${settings.frontendUrl}/saved`;
  $("note-input").value = data.user_note || "";
  $("note-section").classList.add("hidden");
  $("btn-add-thought").classList.remove("hidden");
  showPanel("success");
}

function showConnect(message) {
  $("connect-lead").textContent = message;
  showPanel("connect");
}

function showError(err, { allowReconnect = false } = {}) {
  const isAuth = err?.code === "AUTH_EXPIRED" || err?.message === "AUTH_EXPIRED";
  $("error-message").textContent = isAuth
    ? "Your connection expired. Reconnect to keep saving articles."
    : err?.message || pageErrorMessage();
  $("btn-reconnect").classList.toggle("hidden", !isAuth && !allowReconnect);
  $("btn-retry").classList.toggle("hidden", isAuth);
  showPanel("error");
}

async function runCapture(note) {
  showPanel("loading");
  $("loading-url").textContent = lastTab?.url || "";

  try {
    const data = await captureCurrentTab(note);
    renderSuccess(data);
  } catch (err) {
    if (err?.code === "AUTH_EXPIRED") {
      showError(err);
      return;
    }
    showError(err);
  }
}

async function init() {
  settings = await getSettings();
  lastTab = await getActiveTab();

  if (!settings.token) {
    showConnect("Connect your account once — then save any article with one click.");
    return;
  }

  if (!isSaveableUrl(lastTab?.url)) {
    showError(new Error(pageErrorMessage()));
    $("btn-retry").classList.add("hidden");
    return;
  }

  await runCapture();
}

$("btn-connect").addEventListener("click", () => {
  const extId = chrome.runtime.id;
  const url = `${settings.frontendUrl}/extension/connect?ext=${encodeURIComponent(extId)}`;
  chrome.tabs.create({ url });
  window.close();
});

$("btn-reconnect").addEventListener("click", () => {
  $("btn-reconnect").classList.add("hidden");
  $("btn-retry").classList.remove("hidden");
  showConnect("Your connection expired. Sign in and connect again.");
});

$("btn-retry").addEventListener("click", () => {
  void runCapture();
});

$("btn-add-thought").addEventListener("click", () => {
  $("note-section").classList.remove("hidden");
  $("btn-add-thought").classList.add("hidden");
  $("note-input").focus();
});

$("btn-save-note").addEventListener("click", async () => {
  const note = $("note-input").value.trim();
  if (!note || !lastCapture) return;

  $("btn-save-note").disabled = true;
  $("btn-save-note").textContent = "Saving…";

  try {
    const data = await captureCurrentTab(note);
    renderSuccess(data);
  } catch (err) {
    showError(err);
  } finally {
    $("btn-save-note").disabled = false;
    $("btn-save-note").textContent = "Save note";
  }
});

void init();
