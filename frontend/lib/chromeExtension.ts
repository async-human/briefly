/** Chrome Web Store install URL — set after the extension is published. */

export function getChromeWebStoreUrl(): string | null {
  const direct = process.env.NEXT_PUBLIC_CHROME_STORE_URL?.trim();
  if (direct) return direct;

  const extensionId = process.env.NEXT_PUBLIC_CHROME_EXTENSION_ID?.trim();
  if (extensionId) {
    return `https://chromewebstore.google.com/detail/${extensionId}`;
  }

  return null;
}

export function isDesktopChromium(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg\//.test(ua) && !/Android|iPhone|iPad|Mobile/i.test(ua);
}
