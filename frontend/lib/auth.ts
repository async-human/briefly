export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const TOKEN_KEY = "briefly_token";
const AUTH_NEXT_KEY = "briefly_auth_next";

export function setAuthNext(path: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_NEXT_KEY, path);
}

export function consumeAuthNext(): string | null {
  if (typeof window === "undefined") return null;
  const path = localStorage.getItem(AUTH_NEXT_KEY);
  localStorage.removeItem(AUTH_NEXT_KEY);
  return path;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_KEY}=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax${secure}`;
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0${secure}`;
}

export function googleLoginUrl(): string {
  return `${API_URL}/api/v1/auth/google`;
}
