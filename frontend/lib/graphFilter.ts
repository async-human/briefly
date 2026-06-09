import type { KnowledgeGraphResponse } from "@/lib/api";

/** Thread-focused view: story threads and their connected topics & articles. */
export function applyThreadFocusFilter(data: KnowledgeGraphResponse): KnowledgeGraphResponse {
  const threadIds = new Set(data.nodes.filter((n) => n.type === "thread").map((n) => n.id));
  if (threadIds.size === 0) {
    return { ...data, nodes: [], edges: [], stats: { ...data.stats, thread_focus: true } };
  }

  const kept = new Set(threadIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of data.edges) {
      if (kept.has(edge.source) && !kept.has(edge.target)) {
        kept.add(edge.target);
        changed = true;
      } else if (kept.has(edge.target) && !kept.has(edge.source)) {
        kept.add(edge.source);
        changed = true;
      }
    }
  }

  const nodes = data.nodes.filter(
    (n) => kept.has(n.id) && n.type !== "source" && n.type !== "thought",
  );
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  return {
    ...data,
    nodes,
    edges,
    stats: {
      ...data.stats,
      thread_focus: true,
      topic_count: nodes.filter((n) => n.type === "topic").length,
      thread_count: nodes.filter((n) => n.type === "thread").length,
      item_count: nodes.filter((n) => n.type === "item").length,
      thought_count: 0,
      source_count: 0,
      edge_count: edges.length,
    },
  };
}
