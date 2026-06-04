import { localDateString } from "@/lib/localDate";

export function briefingGenStorageKey(userId: string): string {
  return `briefly_gen_${userId}`;
}

/** Mark today as successfully briefed — only call after a digest exists for today. */
export function markBriefingGeneratedToday(userId: string, digestTimezone?: string | null): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(briefingGenStorageKey(userId), localDateString(digestTimezone));
}

export function clearBriefingGeneratedToday(userId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(briefingGenStorageKey(userId));
}

export function hasBriefingGeneratedToday(userId: string, digestTimezone?: string | null): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(briefingGenStorageKey(userId)) === localDateString(digestTimezone);
}
