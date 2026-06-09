import type { KnowledgeGraphNode, KnowledgeGraphNodeType } from "@/lib/api";

export type LayoutEdge = {
  source: string;
  target: string;
  type?: string;
  weight?: number;
};

export type LayoutNode = KnowledgeGraphNode & {
  x: number;
  y: number;
  fx: number;
  fy: number;
};

/** Concentric rings — topics anchor sectors, children stay in-band to limit crossings. */
const BASE_RING: Record<KnowledgeGraphNodeType, number> = {
  topic: 70,
  thread: 135,
  thought: 168,
  source: 200,
  item: 285,
};

function polar(r: number, angle: number) {
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

function place(node: LayoutNode, x: number, y: number) {
  node.x = x;
  node.y = y;
  node.fx = x;
  node.fy = y;
}

function spreadAngles(count: number, center: number, span: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [center];
  const start = center - span / 2;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => start + i * step);
}

export function layoutKnowledgeGraph(
  nodes: KnowledgeGraphNode[],
  edges: LayoutEdge[],
): LayoutNode[] {
  if (nodes.length === 0) return [];

  const scale = Math.max(1, Math.sqrt(nodes.length / 18));
  const ring = (type: KnowledgeGraphNodeType) => BASE_RING[type] * scale;

  const nodeById = new Map<string, LayoutNode>();
  for (const n of nodes) {
    nodeById.set(n.id, { ...n, x: 0, y: 0, fx: 0, fy: 0 });
  }

  const topics = nodes.filter((n) => n.type === "topic").sort((a, b) => b.size - a.size);
  const threads = nodes.filter((n) => n.type === "thread");
  const sources = nodes.filter((n) => n.type === "source");
  const items = nodes.filter((n) => n.type === "item");
  const thoughts = nodes.filter((n) => n.type === "thought");

  const itemToTopic = new Map<string, string>();
  const itemToThread = new Map<string, string>();
  const threadToTopic = new Map<string, string>();
  const thoughtToTopic = new Map<string, string>();

  for (const e of edges) {
    if (e.type === "belongs_to") itemToTopic.set(e.source, e.target);
    else if (e.type === "updates") itemToThread.set(e.source, e.target);
    else if (e.type === "part_of") threadToTopic.set(e.source, e.target);
    else if (e.type === "relates_to") thoughtToTopic.set(e.source, e.target);
  }

  const topicAngles = new Map<string, number>();
  const topicCount = Math.max(topics.length, 1);
  const sector = (2 * Math.PI) / topicCount;

  if (topics.length === 0) {
    // No topic hubs — use a simple even layout on rings by type.
    spreadAngles(threads.length, -Math.PI / 2, 2 * Math.PI).forEach((angle, i) => {
      const pos = polar(ring("thread"), angle);
      place(nodeById.get(threads[i].id)!, pos.x, pos.y);
    });
    spreadAngles(sources.length, -Math.PI / 2, 2 * Math.PI).forEach((angle, i) => {
      const pos = polar(ring("source"), angle);
      place(nodeById.get(sources[i].id)!, pos.x, pos.y);
    });
    spreadAngles(thoughts.length, -Math.PI / 2, 2 * Math.PI).forEach((angle, i) => {
      const pos = polar(ring("thought"), angle);
      place(nodeById.get(thoughts[i].id)!, pos.x, pos.y);
    });
    spreadAngles(items.length, -Math.PI / 2, 2 * Math.PI).forEach((angle, i) => {
      const pos = polar(ring("item"), angle);
      place(nodeById.get(items[i].id)!, pos.x, pos.y);
    });
    if (nodes.length === 1) {
      const only = nodeById.get(nodes[0].id)!;
      place(only, 0, 0);
    }
    return Array.from(nodeById.values());
  }

  topics.forEach((t, i) => {
    const angle = -Math.PI / 2 + i * sector;
    topicAngles.set(t.id, angle);
    const pos = polar(ring("topic"), angle);
    place(nodeById.get(t.id)!, pos.x, pos.y);
  });

  const threadsByTopic = new Map<string, string[]>();
  const orphanThreads: string[] = [];
  for (const t of threads) {
    const parent = threadToTopic.get(t.id);
    if (parent && topicAngles.has(parent)) {
      const list = threadsByTopic.get(parent) ?? [];
      list.push(t.id);
      threadsByTopic.set(parent, list);
    } else {
      orphanThreads.push(t.id);
    }
  }

  for (const [topicId, threadIds] of Array.from(threadsByTopic.entries())) {
    const base = topicAngles.get(topicId)!;
    const angles = spreadAngles(threadIds.length, base, sector * 0.5);
    threadIds.forEach((id, i) => {
      const pos = polar(ring("thread"), angles[i]);
      place(nodeById.get(id)!, pos.x, pos.y);
    });
  }

  spreadAngles(orphanThreads.length, -Math.PI / 2, 2 * Math.PI).forEach((angle, i) => {
    const pos = polar(ring("thread"), angle);
    place(nodeById.get(orphanThreads[i])!, pos.x, pos.y);
  });

  spreadAngles(sources.length, -Math.PI / 2, 2 * Math.PI).forEach((angle, i) => {
    const pos = polar(ring("source"), angle);
    place(nodeById.get(sources[i].id)!, pos.x, pos.y);
  });

  thoughts.forEach((th, i) => {
    const parent = thoughtToTopic.get(th.id);
    const base = parent && topicAngles.has(parent) ? topicAngles.get(parent)! : -Math.PI / 2;
    const angle = base + ((i % 5) - 2) * 0.07;
    const pos = polar(ring("thought"), angle);
    place(nodeById.get(th.id)!, pos.x, pos.y);
  });

  const itemsByTopic = new Map<string, string[]>();
  const orphanItems: string[] = [];

  for (const item of items) {
    let topicId = itemToTopic.get(item.id);
    if (!topicId) {
      const threadId = itemToThread.get(item.id);
      if (threadId) topicId = threadToTopic.get(threadId);
    }
    if (topicId && topicAngles.has(topicId)) {
      const list = itemsByTopic.get(topicId) ?? [];
      list.push(item.id);
      itemsByTopic.set(topicId, list);
    } else {
      orphanItems.push(item.id);
    }
  }

  for (const [topicId, itemIds] of Array.from(itemsByTopic.entries())) {
    const base = topicAngles.get(topicId)!;
    const angles = spreadAngles(itemIds.length, base, sector * 0.82);
    itemIds.forEach((id, i) => {
      const r = ring("item") + (i % 4) * 10;
      const pos = polar(r, angles[i]);
      place(nodeById.get(id)!, pos.x, pos.y);
    });
  }

  spreadAngles(orphanItems.length, -Math.PI / 2, 2 * Math.PI).forEach((angle, i) => {
    const pos = polar(ring("item") + 24, angle);
    place(nodeById.get(orphanItems[i])!, pos.x, pos.y);
  });

  // Single-node graphs sit at origin without a topic ring.
  if (nodes.length === 1) {
    const only = nodeById.get(nodes[0].id)!;
    place(only, 0, 0);
  }

  return Array.from(nodeById.values());
}

/** Uniform draw radius per type (graph coordinate units). */
export const NODE_DISPLAY_RADIUS: Record<KnowledgeGraphNodeType, number> = {
  topic: 11,
  thread: 10,
  source: 9,
  item: 6.5,
  thought: 8,
};
