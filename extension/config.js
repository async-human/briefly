/** Production defaults — also used when loading unpacked for testing against live Briefly. */
const BRIEFLY_CONFIG = {
  apiUrl: "https://api.sendbriefly.app",
  frontendUrl: "https://www.sendbriefly.app",
};

// Dev overrides: set in chrome.storage.local or use manifest host_permissions for localhost
const BRIEFLY_CONFIG_DEV = {
  apiUrl: "http://localhost:8000",
  frontendUrl: "http://localhost:3000",
};
