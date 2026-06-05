const $ = (id) => document.getElementById(id);

const panels = {
  connect: $("state-connect"),
  loading: $("state-loading"),
  success: $("state-success"),
  error: $("state-error"),
};

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

async function captureCurrentTab(note) {
  if (!lastTab?.url) throw new Error("No page URL found.");
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
    const detail = typeof data.detail === "string" ? data.detail : "Capture failed.";
    throw new Error(detail);
  }
  return data;
}

function renderSuccess(data) {
  lastCapture = data;
  $("result-title").textContent = `"${data.title}"`;

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

  $("btn-view").href = `${settings.frontendUrl}/dashboard`;
  $("note-input").value = data.user_note || "";
  showPanel("success");
}

async function runCapture(note) {
  showPanel("loading");
  $("loading-url").textContent = lastTab?.url || "";

  try {
    const data = await captureCurrentTab(note);
    renderSuccess(data);
  } catch (err) {
    $("error-message").textContent = err.message || "Something went wrong.";
    showPanel("error");
  }
}

async function init() {
  settings = await getSettings();
  lastTab = await getActiveTab();

  if (!settings.token) {
    showPanel("connect");
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
    $("note-section").classList.add("hidden");
  } catch (err) {
    $("error-message").textContent = err.message || "Could not save note.";
    showPanel("error");
  } finally {
    $("btn-save-note").disabled = false;
    $("btn-save-note").textContent = "Save note";
  }
});

void init();
