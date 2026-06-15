/** Long-lived capture device token (bcap_…) for extension + mobile share sheet. */

export const CAPTURE_TOKEN_KEY = "briefly_capture_token";

export function getCaptureToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(CAPTURE_TOKEN_KEY);
}

export function setCaptureToken(token: string): void {
  localStorage.setItem(CAPTURE_TOKEN_KEY, token);
}

export function clearCaptureToken(): void {
  localStorage.removeItem(CAPTURE_TOKEN_KEY);
}

export function looksLikeCaptureToken(value: string): boolean {
  return value.startsWith("bcap_");
}
