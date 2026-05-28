export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const TOKEN_KEY = "briefly_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  document.cookie = `${TOKEN_KEY}=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0`;
}

export function googleLoginUrl(): string {
  return `${API_URL}/api/v1/auth/google`;
}
