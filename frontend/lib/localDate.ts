/** YYYY-MM-DD in the given IANA timezone (defaults to browser local). */
export function localDateString(timeZone?: string | null): string {
  const tz =
    timeZone?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function needsBriefingForToday(
  digest: { digest_date: string; total_items_shown?: number; items?: unknown[] } | null | undefined,
  digestTimezone?: string | null,
): boolean {
  const today = localDateString(digestTimezone);
  if (!digest) return true;
  if (digest.digest_date < today) return true;
  if (digest.digest_date === today) {
    // Use || not ?? — total_items_shown can be 0 (falsy integer), not just null/undefined
    const count = digest.total_items_shown || digest.items?.length || 0;
    if (count === 0) return true;
  }
  return false;
}
