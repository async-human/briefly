/** Canonical digest section labels — must match backend digest_sections.py */
export const SECTION_WHATS_NEW = "What's new";
export const SECTION_HIGHLY_RELEVANT = "Highly relevant to you";
export const SECTION_YOUR_THOUGHTS = "Your thoughts";

export const DIGEST_SECTION_ORDER = [
  SECTION_YOUR_THOUGHTS,
  SECTION_WHATS_NEW,
  SECTION_HIGHLY_RELEVANT,
] as const;

export type DigestSectionLabel = (typeof DIGEST_SECTION_ORDER)[number] | string;

export function groupDigestItemsBySection<T extends { section?: string | null }>(
  items: T[],
): { section: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const section = item.section?.trim() || "Today's briefing";
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section)!.push(item);
  }

  const ordered: { section: string; items: T[] }[] = [];
  for (const section of DIGEST_SECTION_ORDER) {
    const batch = groups.get(section);
    if (batch?.length) {
      ordered.push({ section, items: batch });
      groups.delete(section);
    }
  }
  Array.from(groups.entries()).forEach(([section, batch]) => {
    if (batch.length) ordered.push({ section, items: batch });
  });
  return ordered;
}

export function sectionBadgeClass(section: string): string {
  if (section === SECTION_WHATS_NEW) return "briefing-section-badge briefing-section-badge-fresh";
  if (section === SECTION_HIGHLY_RELEVANT) return "briefing-section-badge briefing-section-badge-relevant";
  if (section === SECTION_YOUR_THOUGHTS) return "briefing-section-badge briefing-section-badge-thoughts";
  return "briefing-section-badge";
}
