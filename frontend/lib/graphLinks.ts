/** Deep links into the knowledge graph. Node ids match backend graph builder. */

export type GraphViewFilter = "thread";
export type GraphTimeRange = 7 | 30 | 90;

export function graphUrl(
  nodeId?: string,
  filter?: GraphViewFilter,
  days?: GraphTimeRange | null,
): string {
  const params = new URLSearchParams();
  if (nodeId) params.set("node", nodeId);
  if (filter) params.set("filter", filter);
  if (days) params.set("days", String(days));
  const qs = params.toString();
  return qs ? `/graph?${qs}` : "/graph";
}

export function graphItemUrl(contentId: string): string {
  return graphUrl(`item:${contentId}`);
}

export function graphThoughtUrl(contentId: string): string {
  return graphUrl(`thought:${contentId}`);
}

export function graphTopicUrl(topicLabel: string): string {
  const slug = topicLabel
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return graphUrl(`topic:${slug || "unknown"}`);
}

export function graphThreadUrl(threadKey: string, options?: { filter?: GraphViewFilter }): string {
  const slug = threadKey
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return graphUrl(`thread:${slug || "unknown"}`, options?.filter ?? "thread");
}

export function graphThreadViewUrl(nodeId?: string, days?: GraphTimeRange | null): string {
  return graphUrl(nodeId, "thread", days);
}
