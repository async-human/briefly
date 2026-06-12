import type { KnowledgeGraphNode, KnowledgeGraphNodeType } from "@/lib/api";

export type LayoutLink = {
  source: string;
  target: string;
  type?: string;
  weight?: number;
  label?: string | null;
};

export type LayoutNode = KnowledgeGraphNode & {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

const FIXED_TYPES = new Set<KnowledgeGraphNodeType>(["topic", "source"]);

function linkNodeId(endpoint: string | LayoutNode): string {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

function primaryTopicForItem(
  itemId: string,
  links: LayoutLink[],
  topicIds: string[],
): string | null {
  const matches: string[] = [];
  for (const link of links) {
    if (link.type !== "belongs_to") continue;
    const src = linkNodeId(link.source);
    const tgt = linkNodeId(link.target);
    if (src === itemId && topicIds.includes(tgt)) matches.push(tgt);
  }
  return matches[0] ?? topicIds[0] ?? null;
}

/**
 * Hub layout: topics anchor the map, articles cluster around their topic,
 * sources sit on an outer ring, threads between topics and their articles.
 */
export function applyHubLayout(nodes: LayoutNode[], links: LayoutLink[]): void {
  if (!nodes.length) return;

  const topics = nodes.filter((n) => n.type === "topic");
  const threads = nodes.filter((n) => n.type === "thread");
  const items = nodes.filter((n) => n.type === "item");
  const sources = nodes.filter((n) => n.type === "source");
  const thoughts = nodes.filter((n) => n.type === "thought");
  const topicIds = topics.map((t) => t.id);

  const topicRadius = 55 + topics.length * 6;
  topics.forEach((topic, i) => {
    const angle = (2 * Math.PI * i) / Math.max(topics.length, 1) - Math.PI / 2;
    const x = Math.cos(angle) * topicRadius;
    const y = Math.sin(angle) * topicRadius;
    topic.x = x;
    topic.y = y;
    topic.fx = x;
    topic.fy = y;
  });

  const topicPos = new Map(topics.map((t) => [t.id, { x: t.x ?? 0, y: t.y ?? 0 }]));
  const itemsByTopic = new Map<string, LayoutNode[]>();
  for (const item of items) {
    const tid = primaryTopicForItem(item.id, links, topicIds);
    if (!tid) continue;
    if (!itemsByTopic.has(tid)) itemsByTopic.set(tid, []);
    itemsByTopic.get(tid)!.push(item);
  }

  Array.from(itemsByTopic.entries()).forEach(([tid, group]) => {
    const hub = topicPos.get(tid) ?? { x: 0, y: 0 };
    const clusterR = 42 + Math.sqrt(group.length) * 14;
    group.forEach((item: LayoutNode, i: number) => {
      const angle = (2 * Math.PI * i) / group.length - Math.PI / 4;
      item.x = hub.x + Math.cos(angle) * clusterR;
      item.y = hub.y + Math.sin(angle) * clusterR;
    });
  });

  const orphanItems = items.filter((item) => item.x == null);
  orphanItems.forEach((item, i) => {
    const angle = (2 * Math.PI * i) / Math.max(orphanItems.length, 1);
    const r = topicRadius + 90;
    item.x = Math.cos(angle) * r;
    item.y = Math.sin(angle) * r;
  });

  threads.forEach((thread, i) => {
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const link of links) {
      if (link.type !== "part_of" && link.type !== "updates") continue;
      const src = linkNodeId(link.source);
      const tgt = linkNodeId(link.target);
      if (src === thread.id && topicPos.has(tgt)) {
        const p = topicPos.get(tgt)!;
        cx += p.x;
        cy += p.y;
        n += 1;
      } else if (tgt === thread.id && topicPos.has(src)) {
        const p = topicPos.get(src)!;
        cx += p.x;
        cy += p.y;
        n += 1;
      }
    }
    if (n > 0) {
      thread.x = cx / n;
      thread.y = cy / n + 28 + (i % 3) * 8;
    } else {
      const angle = (2 * Math.PI * i) / Math.max(threads.length, 1);
      thread.x = Math.cos(angle) * (topicRadius + 35);
      thread.y = Math.sin(angle) * (topicRadius + 35);
    }
  });

  const sourceRadius = topicRadius + 120 + items.length * 0.6;
  sources.forEach((source, i) => {
    const angle = (2 * Math.PI * i) / Math.max(sources.length, 1) - Math.PI / 2;
    const x = Math.cos(angle) * sourceRadius;
    const y = Math.sin(angle) * sourceRadius;
    source.x = x;
    source.y = y;
    source.fx = x;
    source.fy = y;
  });

  const thoughtSource = sources.find((s) => s.id.includes("brain_dump"));
  thoughts.forEach((thought, i) => {
    const base = thoughtSource ?? { x: 0, y: sourceRadius * 0.85 };
    const angle = (2 * Math.PI * i) / Math.max(thoughts.length, 1);
    thought.x = (base.x ?? 0) + Math.cos(angle) * 36;
    thought.y = (base.y ?? 0) + Math.sin(angle) * 36;
  });
}

export function releaseFixedAnchors(nodes: LayoutNode[]): void {
  for (const node of nodes) {
    if (FIXED_TYPES.has(node.type)) {
      node.fx = undefined;
      node.fy = undefined;
    }
  }
}

export function linkDistance(link: LayoutLink): number {
  switch (link.type) {
    case "belongs_to":
      return 48;
    case "part_of":
      return 56;
    case "produces":
      return 72;
    case "updates":
      return 52;
    case "captures":
      return 40;
    case "relates_to":
      return 44;
    case "related_to":
      return 88;
    default:
      return 60;
  }
}
