import type { DigestItem } from "@/lib/api";

const GENERIC_SOURCES = /^(hacker news|show hn|product hunt|reddit|medium|the batch|yc blog)$/i;

export function guessTrackName(item: DigestItem): string {
  const source = (item.source_name || "").trim();
  if (source && !GENERIC_SOURCES.test(source)) {
    return source.slice(0, 80);
  }

  const fromHeadline = item.headline.match(
    /\b([A-Z][A-Za-z0-9.&'-]*(?:\s+[A-Z][A-Za-z0-9.&'-]*){0,3})\b/,
  );
  if (fromHeadline?.[1]) {
    return fromHeadline[1].slice(0, 80);
  }

  return (source || item.headline.split(/\s+/).slice(0, 3).join(" ")).slice(0, 80);
}
