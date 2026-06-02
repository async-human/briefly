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
  const topIds = new Set(outcome?.top_priority_content_ids ?? []);
  const topItems = digest.items.filter(
    (item) => item.content_id && topIds.has(item.content_id),
  );
  if (topItems.length > 0) {
    const topSet = new Set(topItems.map((i) => i.id));
    return {
      topItems,
      restItems: digest.items.filter((i) => !topSet.has(i.id)),
    };
  }
  return {
    topItems: digest.items.slice(0, 3),
    restItems: digest.items.slice(3),
  };
}
