importScripts("config.js");

const DEFAULT_API_URL = BRIEFLY_CONFIG.apiUrl;
const DEFAULT_FRONTEND_URL = BRIEFLY_CONFIG.frontendUrl;

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BRIEFLY_AUTH" && message.token) {
    chrome.storage.local.set(
      {
        token: message.token,
        connectedAt: Date.now(),
      },
      () => {
        sendResponse({ ok: true });
      },
    );
    return true;
  }
  sendResponse({ ok: false });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SETTINGS") {
    chrome.storage.local.get(["apiUrl", "frontendUrl", "token"], (data) => {
      sendResponse({
        apiUrl: data.apiUrl || DEFAULT_API_URL,
        frontendUrl: data.frontendUrl || DEFAULT_FRONTEND_URL,
        token: data.token || null,
      });
    });
    return true;
  }
  return false;
});
