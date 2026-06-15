/** Production defaults — mirror extension/config.js. Override apiUrl in the UI for dev. */
window.BRIEFLY_PWA_CONFIG = {
  apiUrl: "https://api.sendbriefly.app",
  frontendUrl: "https://www.sendbriefly.app",
  // Where users mint a capture device token (Settings → Connected devices).
  tokenSettingsPath: "/settings#capture-devices",
};
