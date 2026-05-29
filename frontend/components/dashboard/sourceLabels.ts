export const SOURCE_TYPE_LABELS: Record<string, string> = {
  rss: "RSS",
  youtube: "YouTube",
  youtube_account: "YouTube",
  reddit: "Reddit",
  reddit_account: "Reddit",
  email: "Email",
  url: "Web",
  gmail: "Gmail",
};

export function sourceDisplayName(source: { name: string | null; identifier: string }) {
  return source.name ?? source.identifier;
}

export function matchItemToSource(
  item: { source_name: string | null },
  sources: { id: string; name: string | null; identifier: string }[],
) {
  if (!item.source_name) return null;

  const exact = sources.find((s) => sourceDisplayName(s) === item.source_name);
  if (exact) return exact;

  const normalized = item.source_name.toLowerCase();
  return (
    sources.find((s) => {
      const label = sourceDisplayName(s).toLowerCase();
      return normalized.includes(label) || label.includes(normalized);
    }) ?? null
  );
}
