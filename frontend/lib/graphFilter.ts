import type { KnowledgeGraphNode, KnowledgeGraphResponse } from "@/lib/api";

export type ExplorerLens = {
  companies: boolean;
  people: boolean;
  topics: boolean;
  articles: boolean;
  watchedOnly: boolean;
};

export const DEFAULT_EXPLORER_LENS: ExplorerLens = {
  companies: true,
  people: true,
  topics: true,
  articles: false,
  watchedOnly: false,
};

function entityKind(node: KnowledgeGraphNode): string {
  return String(node.meta?.kind || "company");
}

export function nodePassesLens(node: KnowledgeGraphNode, lens: ExplorerLens): boolean {
  if (node.type === "item" || node.type === "thought") return lens.articles;
  if (node.type === "source") return lens.articles;
  if (node.type === "topic" || node.type === "thread") return lens.topics;
  if (node.type === "entity") {
    const kind = entityKind(node);
    if (kind === "person") return lens.people;
    if (kind === "topic") return lens.topics;
    return lens.companies;
  }
  return false;
}

export function applyExplorerLens(
  data: KnowledgeGraphResponse,
  lens: ExplorerLens,
): KnowledgeGraphResponse {
  const passing = data.nodes.filter((n) => nodePassesLens(n, lens));
  let kept = new Set(passing.map((n) => n.id));

  if (lens.watchedOnly) {
    const watched = data.nodes.filter((n) => n.type === "entity").map((n) => n.id);
    kept = new Set(watched);
    for (const edge of data.edges) {
      if (kept.has(edge.source)) kept.add(edge.target);
      if (kept.has(edge.target)) kept.add(edge.source);
    }
    kept = new Set(
      Array.from(kept).filter((id) => {
        const node = data.nodes.find((n) => n.id === id);
        return node ? nodePassesLens(node, { ...lens, watchedOnly: false }) || node.type === "entity" : false;
      }),
    );
  }

  const nodes = data.nodes.filter((n) => kept.has(n.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  return {
    ...data,
    nodes,
    edges,
    stats: {
      ...data.stats,
      topic_count: nodes.filter((n) => n.type === "topic").length,
      thread_count: nodes.filter((n) => n.type === "thread").length,
      item_count: nodes.filter((n) => n.type === "item").length,
      thought_count: nodes.filter((n) => n.type === "thought").length,
      source_count: nodes.filter((n) => n.type === "source").length,
      entity_count: nodes.filter((n) => n.type === "entity").length,
      edge_count: edges.length,
    },
  };
}

export function searchMatchIds(
  nodes: KnowledgeGraphNode[],
  edges: { source: string | { id?: string }; target: string | { id?: string } }[],
  query: string,
): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const matched = new Set<string>();
  for (const node of nodes) {
    const hay = `${node.label} ${String(node.meta?.summary ?? "")} ${String(node.meta?.kind ?? "")}`.toLowerCase();
    if (hay.includes(q)) matched.add(node.id);
  }
  if (matched.size === 0) return matched;
  const idOf = (end: string | { id?: string }) => (typeof end === "object" ? end.id ?? "" : end);
  for (const edge of edges) {
    const src = idOf(edge.source);
    const tgt = idOf(edge.target);
    if (matched.has(src)) matched.add(tgt);
    if (matched.has(tgt)) matched.add(src);
  }
  return matched;
}

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
