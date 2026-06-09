import type { Digest, DigestItem } from "@/lib/api";

export type DigestOutcome = {
  saved_minutes?: number;
  filtered_count?: number;
  top_priority_content_ids?: string[];
  catch_up_topics?: string[];
  goal?: string | null;
  skipped_note?: string;
  items_shown?: number;
  items_scanned?: number;
};

export function getDigestOutcome(digest: Digest | null): DigestOutcome | null {
  const outcome = digest?.meta?.outcome;
  if (!outcome || typeof outcome !== "object") return null;
  return outcome as DigestOutcome;
}

export function splitTopPriorityItems(
  digest: Digest,
  outcome: DigestOutcome | null,
): { topItems: DigestItem[]; restItems: DigestItem[] } {
  const topIds = outcome?.top_priority_content_ids ?? [];
  if (topIds.length > 0) {
    const byContentId = new Map(
      digest.items
        .filter((item) => item.content_id)
        .map((item) => [item.content_id as string, item]),
    );
    const topItems = topIds
      .map((id) => byContentId.get(id))
      .filter((item): item is DigestItem => Boolean(item));
    if (topItems.length > 0) {
      const topSet = new Set(topItems.map((i) => i.id));
      return {
        topItems,
        restItems: digest.items.filter((i) => !topSet.has(i.id)),
      };
    }
  }
  return {
    topItems: digest.items.slice(0, 3),
    restItems: digest.items.slice(3),
  };
}
