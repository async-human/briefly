"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { KnowledgeGraphNode, KnowledgeGraphNodeType, KnowledgeGraphResponse } from "@/lib/api";
import { api } from "@/lib/api";
import { applyThreadFocusFilter } from "@/lib/graphFilter";
import Link from "next/link";
import { askAboutContent } from "@/lib/askLinks";
import type { GraphTimeRange, GraphViewFilter } from "@/lib/graphLinks";
import { applyHubLayout, linkDistance, type LayoutLink, type LayoutNode } from "@/lib/graphLayout";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const NODE_COLORS: Record<KnowledgeGraphNodeType, string> = {
  topic: "#8B5CF6",
  source: "#22C55E",
  item: "#3B82F6",
  thought: "#F59E0B",
  thread: "#EC4899",
};

const NODE_LABELS: Record<KnowledgeGraphNodeType, string> = {
  topic: "Topics",
  source: "Sources",
  item: "Articles",
  thought: "Your thoughts",
  thread: "Story threads",
};

const ANCHOR_TYPES = new Set<KnowledgeGraphNodeType>(["topic", "thread", "source"]);

const EDGE_LEGEND: { type: string; label: string; hint: string }[] = [
  { type: "belongs_to", label: "Brief → topic", hint: "Article matched an interest in your brief" },
  { type: "part_of", label: "Thread → topic", hint: "Story thread grouped under a topic" },
  { type: "produces", label: "Source → article", hint: "Where an article was published" },
  { type: "updates", label: "Article → thread", hint: "Article advances a story thread" },
  { type: "related_to", label: "Article ↔ article", hint: "Semantically similar (embedding match)" },
  { type: "relates_to", label: "Thought → topic", hint: "Your note relates to an interest" },
  { type: "captures", label: "Source → thought", hint: "Brain dump you saved" },
];

function truncateLabel(label: string, max: number): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function linkEndpointId(endpoint: string | ForceNode): string {
  return typeof endpoint === "object" ? endpoint.id! : endpoint;
}

function neighborIds(
  nodeId: string,
  links: { source: string | ForceNode; target: string | ForceNode }[],
): Set<string> {
  const ids = new Set<string>([nodeId]);
  for (const link of links) {
    const src = linkEndpointId(link.source);
    const tgt = linkEndpointId(link.target);
    if (src === nodeId) ids.add(tgt);
    if (tgt === nodeId) ids.add(src);
  }
  return ids;
}

function shouldShowCanvasLabel(
  node: KnowledgeGraphNode,
  globalScale: number,
  hoveredId: string | null,
  selectedId: string | null,
  focusIds: Set<string> | null,
): boolean {
  if (focusIds && !focusIds.has(node.id)) return false;
  if (node.id === hoveredId || node.id === selectedId) return true;
  if (focusIds && focusIds.has(node.id)) return true;
  if (node.type === "item" || node.type === "thought") {
    return globalScale >= 1.6;
  }
  if (!ANCHOR_TYPES.has(node.type)) return false;
  return globalScale >= 0.72;
}

const ALL_TYPES: KnowledgeGraphNodeType[] = ["topic", "source", "item", "thought", "thread"];
const THREAD_FOCUS_TYPES: KnowledgeGraphNodeType[] = ["thread", "item", "topic"];
const TIME_RANGES: { label: string; value: GraphTimeRange | null }[] = [
  { label: "All", value: null },
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  globalScale: number,
  emphasized: boolean,
) {
  const fontSize = emphasized
    ? Math.max(10, Math.min(12, 12 / globalScale))
    : Math.max(8, Math.min(10, 10 / globalScale));
  const maxLen = emphasized ? 42 : 18;
  const display = truncateLabel(text, maxLen);

  ctx.font = `${fontSize}px DM Sans, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  if (emphasized) {
    const metrics = ctx.measureText(display);
    const padX = 6;
    const padY = 3;
    const w = metrics.width + padX * 2;
    const h = fontSize + padY * 2;
    const left = x - w / 2;
    const top = y;
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    ctx.strokeStyle = "rgba(15, 15, 15, 0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(left, top, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1a1a1a";
    ctx.fillText(display, x, top + padY);
  } else {
    ctx.fillStyle = "rgba(26, 26, 26, 0.72)";
    ctx.fillText(display, x, y);
  }
}

type ForceNode = LayoutNode;

function connectionsForNode(
  nodeId: string,
  links: LayoutLink[],
  nodesById: Map<string, KnowledgeGraphNode>,
) {
  return links
    .filter((link) => link.source === nodeId || link.target === nodeId)
    .map((link) => {
      const outbound = link.source === nodeId;
      const otherId = outbound ? link.target : link.source;
      const other = nodesById.get(otherId);
      return {
        id: `${link.type}:${otherId}`,
        label: link.label ?? link.type ?? "Connected",
        otherLabel: other?.label ?? otherId,
        otherType: other?.type,
        edgeType: link.type,
      };
    })
    .sort((a, b) => a.otherLabel.localeCompare(b.otherLabel));
}

const FILTER_SHORT: Record<KnowledgeGraphNodeType, string> = {
  topic: "Topics",
  source: "Sources",
  item: "Articles",
  thought: "Thoughts",
  thread: "Threads",
};

function useMobileLayout() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 56rem)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return mobile;
}

function useCanHover() {
  const [canHover, setCanHover] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return canHover;
}

function nodeDetail(node: KnowledgeGraphNode): { label: string; value: string }[] {
  const meta = node.meta;
  const rows: { label: string; value: string }[] = [];

  if (node.type === "topic") {
    if (meta.strength_pct != null) rows.push({ label: "Strength", value: `${meta.strength_pct}%` });
    if (meta.item_count != null) rows.push({ label: "Items tracked", value: String(meta.item_count) });
    if (meta.source) rows.push({ label: "Origin", value: String(meta.source) });
  } else if (node.type === "thread") {
    if (meta.appearances != null) rows.push({ label: "Appearances", value: String(meta.appearances) });
    if (meta.latest_headline) rows.push({ label: "Latest", value: String(meta.latest_headline) });
    if (meta.health) rows.push({ label: "Status", value: String(meta.health) });
  } else if (node.type === "source") {
    if (meta.source_type) rows.push({ label: "Type", value: String(meta.source_type) });
    if (meta.weight != null) rows.push({ label: "Weight", value: String(meta.weight) });
  } else if (node.type === "item") {
    if (meta.source_name) rows.push({ label: "Source", value: String(meta.source_name) });
    if (meta.digest_date) rows.push({ label: "Briefing", value: String(meta.digest_date) });
    if (meta.connection_sentence) rows.push({ label: "Connection", value: String(meta.connection_sentence) });
    else if (meta.why_relevant) rows.push({ label: "Why relevant", value: String(meta.why_relevant) });
    if (meta.summary) rows.push({ label: "Summary", value: String(meta.summary) });
  } else if (node.type === "thought") {
    if (meta.intent_type) rows.push({ label: "Intent", value: String(meta.intent_type) });
    if (Array.isArray(meta.keywords) && meta.keywords.length) {
      rows.push({ label: "Keywords", value: meta.keywords.join(", ") });
    }
    if (meta.summary) rows.push({ label: "Summary", value: String(meta.summary) });
  }

  return rows;
}

type KnowledgeGraphViewProps = {
  data: KnowledgeGraphResponse;
  initialFocusNodeId?: string | null;
  viewFilter?: GraphViewFilter | null;
  timeRangeDays?: GraphTimeRange | null;
  onViewChange?: (next: { filter?: GraphViewFilter | null; days?: GraphTimeRange | null }) => void;
  onGraphUpdated?: () => void;
};

export function KnowledgeGraphView({
  data,
  initialFocusNodeId,
  viewFilter,
  timeRangeDays,
  onViewChange,
  onGraphUpdated,
}: KnowledgeGraphViewProps) {
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [didFit, setDidFit] = useState(false);
  const mobile = useMobileLayout();
  const canHover = useCanHover();
  const threadFocus = viewFilter === "thread";
  const [activeTypes, setActiveTypes] = useState<Set<KnowledgeGraphNodeType>>(
    () => new Set(threadFocus ? THREAD_FOCUS_TYPES : ALL_TYPES),
  );

  useEffect(() => {
    setActiveTypes(new Set(threadFocus ? THREAD_FOCUS_TYPES : ALL_TYPES));
    setSelected(null);
  }, [threadFocus]);

  const viewData = useMemo(
    () => (threadFocus ? applyThreadFocusFilter(data) : data),
    [data, threadFocus],
  );
  const [selected, setSelected] = useState<KnowledgeGraphNode | null>(null);
  const [hovered, setHovered] = useState<KnowledgeGraphNode | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  const filtered = useMemo(() => {
    const nodes = viewData.nodes
      .filter((n) => activeTypes.has(n.type))
      .map((n) => ({ ...n })) as LayoutNode[];
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links: LayoutLink[] = viewData.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        label: e.label,
        type: e.type,
      }));
    applyHubLayout(nodes, links);
    return { nodes, links };
  }, [viewData, activeTypes]);

  const nodesById = useMemo(
    () => new Map(viewData.nodes.map((n) => [n.id, n])),
    [viewData.nodes],
  );

  const toggleType = useCallback((type: KnowledgeGraphNodeType) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        if (next.size === 1) return prev;
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setSelected(null);
  }, []);

  const handleNodeClick = useCallback((node: ForceNode) => {
    setSelected({
      id: node.id,
      type: node.type,
      label: node.label,
      size: node.size,
      meta: node.meta,
    });
  }, []);

  const focusNode =
    filtered.nodes.find((n) => n.id === selected?.id) ??
    viewData.nodes.find((n) => n.id === selected?.id) ??
    selected;

  useEffect(() => {
    if (!initialFocusNodeId) return;
    const node = viewData.nodes.find((n) => n.id === initialFocusNodeId);
    if (node) {
      setSelected(node);
      setDidFit(false);
    }
  }, [initialFocusNodeId, viewData]);

  useEffect(() => {
    if (!initialFocusNodeId || !didFit) return;
    const timer = window.setTimeout(() => {
      const graph = graphRef.current;
      if (!graph) return;
      graph.zoomToFit(
        500,
        mobile ? 48 : 32,
        (node) => (node as ForceNode).id === initialFocusNodeId,
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [initialFocusNodeId, didFit, mobile]);

  async function runTopicAction(action: "boost" | "mute") {
    if (!focusNode || focusNode.type !== "topic") return;
    setActionPending(true);
    setActionMessage("");
    try {
      const res = await api.graphTopicAction({ topic: focusNode.label, action });
      setActionMessage(
        action === "boost"
          ? `Boosted — ${Math.round(res.strength * 100)}% strength`
          : "Muted — fewer items like this in future briefs",
      );
      onGraphUpdated?.();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionPending(false);
    }
  }

  async function runSourceAction(action: "prioritize" | "deprioritize") {
    if (!focusNode || focusNode.type !== "source") return;
    const sourceId = focusNode.meta.source_id;
    if (typeof sourceId !== "string") return;
    setActionPending(true);
    setActionMessage("");
    try {
      await api.graphSourceAction({ source_id: sourceId, action });
      setActionMessage(
        action === "prioritize"
          ? "Source prioritized for future briefs"
          : "Source deprioritized",
      );
      onGraphUpdated?.();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionPending(false);
    }
  }

  const hoveredId = hovered?.id ?? null;
  const selectedId = selected?.id ?? null;

  const focusIds = useMemo(
    () => (selectedId ? neighborIds(selectedId, filtered.links) : null),
    [selectedId, filtered.links],
  );

  const nodeConnections = useMemo(
    () => (selectedId ? connectionsForNode(selectedId, filtered.links, nodesById) : []),
    [selectedId, filtered.links, nodesById],
  );

  const accuracyNote = useMemo(() => {
    const stats = data.stats;
    const parts: string[] = [];
    if (
      stats.items_total_candidates != null &&
      stats.items_displayed != null &&
      stats.items_total_candidates > stats.items_displayed
    ) {
      parts.push(
        `Top ${stats.items_displayed} of ${stats.items_total_candidates} articles`,
      );
    }
    if (stats.digests_scanned) {
      parts.push(`from last ${stats.digests_scanned} briefings`);
    }
    if (stats.similarity_edges_capped) {
      parts.push("similarity links capped for clarity");
    }
    return parts.length ? parts.join(" · ") : null;
  }, [data.stats]);

  const tuneGraphForces = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const charge = graph.d3Force("charge") as unknown as {
      strength: (v: number) => void;
      distanceMax: (v: number) => void;
    } | undefined;
    charge?.strength(-110);
    charge?.distanceMax(340);
    const link = graph.d3Force("link") as unknown as {
      distance: (fn: (l: LayoutLink) => number) => void;
      strength: (fn: (l: LayoutLink) => number) => void;
    } | undefined;
    link?.distance((l) => linkDistance(l));
    link?.strength((l) => {
      if (l.type === "related_to") return 0.12;
      if (l.type === "belongs_to" || l.type === "produces") return 0.55;
      return 0.38;
    });
    const center = graph.d3Force("center") as unknown as { strength: (v: number) => void } | undefined;
    center?.strength(0.035);
    graph.d3ReheatSimulation();
  }, []);

  useEffect(() => {
    setDidFit(false);
  }, [filtered.nodes.length, activeTypes]);

  useEffect(() => {
    const timer = window.setTimeout(() => tuneGraphForces(), 0);
    return () => window.clearTimeout(timer);
  }, [filtered, tuneGraphForces]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.pauseAnimation();
    graph.resumeAnimation();
    const timer = window.setTimeout(() => graph.pauseAnimation(), 120);
    return () => window.clearTimeout(timer);
  }, [hoveredId, selectedId]);

  useEffect(() => {
    if (!mobile || !focusNode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobile, focusNode]);

  const fitPadding = mobile ? 80 : 48;

  const renderNode = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as ForceNode;
      const inFocus = !focusIds || focusIds.has(n.id);
      const isHovered = n.id === hoveredId;
      const isSelected = n.id === selectedId;
      const isNeighbor = Boolean(focusIds && inFocus && !isSelected);
      const emphasized = isHovered || isSelected || (focusIds && isNeighbor);

      const size =
        Math.sqrt(Math.max(n.size, 4)) * (mobile ? 2.6 : 2.2) * (inFocus ? 1 : 0.82);

      const x = n.x ?? 0;
      const y = n.y ?? 0;

      ctx.save();
      ctx.globalAlpha = inFocus ? (isSelected ? 1 : isNeighbor ? 0.92 : 0.78) : 0.1;

      if (isSelected) {
        ctx.shadowColor = NODE_COLORS[n.type];
        ctx.shadowBlur = Math.max(8, 14 / globalScale);
      }

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = inFocus ? NODE_COLORS[n.type] : "rgba(148, 155, 175, 0.55)";
      ctx.fill();
      ctx.shadowBlur = 0;

      if (emphasized && inFocus) {
        ctx.beginPath();
        ctx.arc(x, y, size + (isSelected ? 3.5 : 2), 0, 2 * Math.PI);
        ctx.strokeStyle = isSelected ? NODE_COLORS[n.type] : "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = (isSelected ? 2.5 : 1.5) / globalScale;
        ctx.stroke();
      }

      if (shouldShowCanvasLabel(n, globalScale, hoveredId, selectedId, focusIds) && n.label) {
        drawNodeLabel(ctx, n.label, x, y + size + 4 / globalScale, globalScale, Boolean(emphasized));
      }

      ctx.restore();
    },
    [hoveredId, selectedId, focusIds, mobile],
  );

  const linkColor = useCallback(
    (link: object) => {
      const l = link as { source?: string | ForceNode; target?: string | ForceNode };
      if (!focusIds || !l.source || !l.target) return "rgba(94, 106, 210, 0.22)";
      const src = linkEndpointId(l.source);
      const tgt = linkEndpointId(l.target);
      const active = focusIds.has(src) && focusIds.has(tgt);
      return active ? "rgba(94, 106, 210, 0.72)" : "rgba(94, 106, 210, 0.04)";
    },
    [focusIds],
  );

  const linkWidth = useCallback(
    (link: object) => {
      const l = link as { weight?: number; type?: string; source?: string | ForceNode; target?: string | ForceNode };
      const base = 0.5 + (l.weight ?? 0.3) * 2.5;
      const thin = l.type === "related_to" ? 0.75 : 1;
      if (!focusIds || !l.source || !l.target) return base * thin;
      const src = linkEndpointId(l.source);
      const tgt = linkEndpointId(l.target);
      const active = focusIds.has(src) && focusIds.has(tgt);
      return (active ? base * 1.65 : base * 0.35) * thin;
    },
    [focusIds],
  );

  const linkCurvature = useCallback((link: object) => {
    const l = link as { type?: string };
    return l.type === "related_to" ? 0.22 : 0;
  }, []);

  const inspectorContent = focusNode ? (
    <>
      <div className="kg-inspector-head">
        <span
          className="kg-inspector-badge"
          style={{ background: `${NODE_COLORS[focusNode.type]}22`, color: NODE_COLORS[focusNode.type] }}
        >
          {NODE_LABELS[focusNode.type].replace(/s$/, "")}
        </span>
        <button type="button" className="kg-inspector-close" onClick={() => setSelected(null)} aria-label="Close">
          ×
        </button>
      </div>
      {mobile ? <div className="kg-sheet-handle" aria-hidden /> : null}
      <h3 className="kg-inspector-title">{focusNode.label}</h3>
      <dl className="kg-inspector-meta">
        {nodeDetail(focusNode).map((row) => (
          <div key={row.label} className="kg-inspector-row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {nodeConnections.length > 0 ? (
        <div className="kg-inspector-connections">
          <p className="kg-inspector-connections-title">Connections ({nodeConnections.length})</p>
          <ul className="kg-inspector-connections-list">
            {nodeConnections.map((conn) => (
              <li key={conn.id} className="kg-inspector-connection">
                <span
                  className="kg-inspector-connection-dot"
                  style={{
                    background: conn.otherType ? NODE_COLORS[conn.otherType] : "var(--app-muted)",
                  }}
                />
                <span className="kg-inspector-connection-text">
                  <span className="kg-inspector-connection-edge">{conn.label}</span>
                  <span className="kg-inspector-connection-node">{conn.otherLabel}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {focusNode.type === "item" || focusNode.type === "thought" ? (
        <Link
          href={askAboutContent(
            focusNode.id.replace(/^(item|thought):/, ""),
            undefined,
            focusNode.label,
          )}
          className="dash-btn dash-btn-secondary kg-inspector-link"
        >
          Ask about this
        </Link>
      ) : null}
      {focusNode.type === "item" && focusNode.meta.url ? (
        <a
          href={String(focusNode.meta.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="dash-btn dash-btn-secondary kg-inspector-link"
        >
          Open article
        </a>
      ) : null}
      {focusNode.type === "topic" ? (
        <div className="kg-inspector-actions">
          <button
            type="button"
            className="kg-action-btn kg-action-btn-primary"
            disabled={actionPending}
            onClick={() => void runTopicAction("boost")}
          >
            Boost in briefs
          </button>
          <button
            type="button"
            className="kg-action-btn"
            disabled={actionPending}
            onClick={() => void runTopicAction("mute")}
          >
            Mute topic
          </button>
        </div>
      ) : null}
      {focusNode.type === "source" && focusNode.meta.source_id ? (
        <div className="kg-inspector-actions">
          <button
            type="button"
            className="kg-action-btn kg-action-btn-primary"
            disabled={actionPending}
            onClick={() => void runSourceAction("prioritize")}
          >
            Prioritize source
          </button>
          <button
            type="button"
            className="kg-action-btn"
            disabled={actionPending}
            onClick={() => void runSourceAction("deprioritize")}
          >
            Deprioritize
          </button>
        </div>
      ) : null}
      {actionMessage ? <p className="kg-action-feedback">{actionMessage}</p> : null}
    </>
  ) : null;

  return (
    <div className={`kg-stage${mobile ? " kg-stage-mobile" : ""}${focusIds ? " kg-stage-focused" : ""}`}>
      {accuracyNote ? (
        <p className="kg-accuracy-note" title="Graph shows your highest-engagement content within sampling limits">
          {accuracyNote}
        </p>
      ) : null}
      <div className={`kg-canvas-wrap${focusIds ? " is-focused" : ""}`}>
        {filtered.nodes.length === 0 ? (
          <div className="kg-empty">
            <p className="kg-empty-title">No nodes to show</p>
            <p className="kg-empty-desc">
              {threadFocus
                ? "No story threads yet — keep reading and Briefly will map evolving narratives here."
                : timeRangeDays
                  ? `Nothing in the last ${timeRangeDays} days. Try a wider time range or keep reading.`
                  : "Turn on a node type below, or keep reading to grow your graph."}
            </p>
          </div>
        ) : (
          <ForceGraph2D
            ref={graphRef}
            graphData={filtered}
            backgroundColor="transparent"
            nodeRelSize={1}
            nodeVal={(n) => (n as KnowledgeGraphNode).size}
            nodeLabel=""
            nodeColor={(n) => NODE_COLORS[(n as KnowledgeGraphNode).type]}
            nodeCanvasObject={renderNode}
            nodeCanvasObjectMode={() => "replace"}
            nodePointerAreaPaint={(node, color, ctx) => {
              const n = node as ForceNode;
              const hit = Math.sqrt(Math.max(n.size, 4)) * (mobile ? 3.4 : 2.8);
              ctx.beginPath();
              ctx.arc(n.x ?? 0, n.y ?? 0, hit, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            linkWidth={linkWidth}
            linkColor={linkColor}
            linkCurvature={linkCurvature}
            linkDirectionalParticles={0}
            onNodeClick={(node) => handleNodeClick(node as ForceNode)}
            onNodeHover={canHover ? (node) => setHovered(node as KnowledgeGraphNode | null) : undefined}
            onBackgroundClick={() => setSelected(null)}
            onEngineStop={() => {
              if (!didFit) {
                graphRef.current?.zoomToFit(400, fitPadding);
                setDidFit(true);
              }
            }}
            cooldownTicks={mobile ? 80 : 120}
            warmupTicks={mobile ? 40 : 60}
            d3AlphaDecay={0.022}
            d3VelocityDecay={0.45}
          />
        )}

        {canHover && hovered && !focusNode ? (
          <div className="kg-hover-tip" role="status">
            <span className="kg-hover-tip-dot" style={{ background: NODE_COLORS[hovered.type] }} />
            {hovered.label}
          </div>
        ) : null}

        {filtered.nodes.length > 0 ? (
          <p className="kg-float-hint">
            {focusIds
              ? mobile
                ? "Tap empty space to show full graph"
                : "Click empty space to show full graph"
              : mobile
                ? "Tap a node to inspect connections"
                : "Topics anchor the map · click a node to inspect"}
          </p>
        ) : null}

        <div className={`kg-legend${legendOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="kg-legend-toggle"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
          >
            {legendOpen ? "Hide legend" : "How to read this"}
          </button>
          {legendOpen ? (
            <div className="kg-legend-body">
              <p className="kg-legend-intro">
                Topics sit at the center; articles cluster around the interest they matched in your brief.
              </p>
              <ul className="kg-legend-nodes">
                {ALL_TYPES.map((type) => (
                  <li key={type}>
                    <span className="kg-legend-dot" style={{ background: NODE_COLORS[type] }} />
                    {NODE_LABELS[type]}
                  </li>
                ))}
              </ul>
              <ul className="kg-legend-edges">
                {EDGE_LEGEND.map((edge) => (
                  <li key={edge.type}>
                    <span className="kg-legend-edge-type">{edge.label}</span>
                    <span className="kg-legend-edge-hint">{edge.hint}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="kg-float-bar">
        <div className="kg-float-controls">
          <div className="kg-view-pills" role="group" aria-label="Graph view mode">
            <button
              type="button"
              className={`kg-view-pill${!threadFocus ? " is-active" : ""}`}
              aria-pressed={!threadFocus}
              onClick={() => onViewChange?.({ filter: null })}
            >
              Full map
            </button>
            <button
              type="button"
              className={`kg-view-pill${threadFocus ? " is-active" : ""}`}
              aria-pressed={threadFocus}
              onClick={() => onViewChange?.({ filter: "thread" })}
            >
              Threads
            </button>
          </div>
          <div className="kg-time-pills" role="group" aria-label="Time range">
            {TIME_RANGES.map(({ label, value }) => {
              const active = timeRangeDays === value || (!timeRangeDays && value === null);
              return (
                <button
                  key={label}
                  type="button"
                  className={`kg-time-pill${active ? " is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => onViewChange?.({ days: value })}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="kg-filters-scroll">
            <div className="kg-filters" role="group" aria-label="Filter node types">
              {(threadFocus ? THREAD_FOCUS_TYPES : ALL_TYPES).map((type) => {
                const on = activeTypes.has(type);
                const count = viewData.nodes.filter((n) => n.type === type).length;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`kg-filter-btn${on ? " is-active" : ""}`}
                    onClick={() => toggleType(type)}
                    aria-pressed={on}
                    title={NODE_LABELS[type]}
                  >
                    <span className="kg-filter-dot" style={{ background: NODE_COLORS[type] }} />
                    <span className="kg-filter-label">{mobile ? FILTER_SHORT[type] : NODE_LABELS[type]}</span>
                    <span className="kg-filter-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="kg-fit-btn"
            onClick={() => graphRef.current?.zoomToFit(400, fitPadding)}
            title="Fit graph to view"
          >
            {mobile ? "Fit" : "Fit view"}
          </button>
        </div>
      </div>

      {focusNode ? (
        <>
          <button
            type="button"
            className="kg-sheet-backdrop"
            aria-label="Close details"
            onClick={() => setSelected(null)}
          />
          <aside className="kg-inspector kg-inspector-drawer is-open" aria-live="polite">
            {inspectorContent}
          </aside>
        </>
      ) : null}
    </div>
  );
}
