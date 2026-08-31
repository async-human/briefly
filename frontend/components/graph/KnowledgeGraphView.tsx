"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { KnowledgeGraphNode, KnowledgeGraphNodeType, KnowledgeGraphResponse } from "@/lib/api";
import { applyExplorerLens, applyThreadFocusFilter, DEFAULT_EXPLORER_LENS, searchMatchIds, type ExplorerLens } from "@/lib/graphFilter";
import type { GraphTimeRange, GraphViewFilter } from "@/lib/graphLinks";
import { applyHubLayout, linkDistance, type LayoutLink, type LayoutNode } from "@/lib/graphLayout";
import { useAppTheme } from "@/components/app/AppThemeProvider";
import { useGraphHub } from "./GraphHubContext";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const NODE_COLORS: Record<KnowledgeGraphNodeType, string> = {
  topic: "#8B5CF6",
  source: "#22C55E",
  item: "#3B82F6",
  thought: "#F59E0B",
  thread: "#EC4899",
  entity: "#06B6D4",
};

const NODE_LABELS: Record<KnowledgeGraphNodeType, string> = {
  topic: "Topics",
  source: "Sources",
  item: "Articles",
  thought: "Your thoughts",
  thread: "Story threads",
  entity: "Watched",
};

const ANCHOR_TYPES = new Set<KnowledgeGraphNodeType>(["topic", "thread", "source", "entity"]);

const EDGE_LEGEND: { type: string; label: string; hint: string }[] = [
  { type: "belongs_to", label: "Brief → topic", hint: "Article matched an interest in your brief" },
  { type: "part_of", label: "Thread → topic", hint: "Story thread grouped under a topic" },
  { type: "produces", label: "Source → article", hint: "Where an article was published" },
  { type: "updates", label: "Article → thread", hint: "Article advances a story thread" },
  { type: "related_to", label: "Article ↔ article", hint: "Semantically similar (embedding match)" },
  { type: "relates_to", label: "Thought → topic", hint: "Your note relates to an interest" },
  { type: "captures", label: "Source → thought", hint: "Brain dump you saved" },
  { type: "mentioned_with", label: "Watched ↔ article", hint: "A company or person you watch appears in this story" },
  { type: "watches", label: "Watched → topic", hint: "A watched name sits in an interest cluster" },
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

const ALL_TYPES: KnowledgeGraphNodeType[] = ["entity", "topic", "thread", "source", "item", "thought"];
const TIME_RANGES: { label: string; value: GraphTimeRange | null }[] = [
  { label: "All", value: null },
  { label: "7d", value: 7 },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
];

type GraphPaint = {
  dimNode: string;
  dimAlpha: number;
  idleAlpha: number;
  neighborAlpha: number;
  ring: string;
  nodeStroke: string;
  link: string;
  linkDim: string;
  linkActive: string;
  labelBg: string;
  labelBorder: string;
  labelText: string;
  dimLabel: string;
};

const PAINT_LIGHT: GraphPaint = {
  dimNode: "rgba(92, 78, 210, 0.55)",
  dimAlpha: 0.78,
  idleAlpha: 1,
  neighborAlpha: 1,
  ring: "rgba(22, 20, 16, 0.62)",
  nodeStroke: "rgba(22, 20, 16, 0.28)",
  link: "rgba(68, 58, 168, 0.55)",
  linkDim: "rgba(68, 58, 168, 0.32)",
  linkActive: "rgba(68, 58, 168, 0.95)",
  labelBg: "#ffffff",
  labelBorder: "rgba(22, 20, 16, 0.16)",
  labelText: "#161310",
  dimLabel: "rgba(22, 20, 16, 0.78)",
};

const PAINT_DARK: GraphPaint = {
  dimNode: "rgba(176, 184, 255, 0.7)",
  dimAlpha: 0.7,
  idleAlpha: 1,
  neighborAlpha: 1,
  ring: "rgba(244, 242, 238, 0.9)",
  nodeStroke: "rgba(0, 0, 0, 0.45)",
  link: "rgba(160, 170, 255, 0.58)",
  linkDim: "rgba(160, 170, 255, 0.32)",
  linkActive: "rgba(176, 186, 255, 0.95)",
  labelBg: "rgba(22, 24, 32, 0.96)",
  labelBorder: "rgba(244, 242, 238, 0.18)",
  labelText: "#f4f2ee",
  dimLabel: "rgba(244, 242, 238, 0.86)",
};

function drawNodeLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  globalScale: number,
  emphasized: boolean,
  paint: GraphPaint,
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
    ctx.fillStyle = paint.labelBg;
    ctx.strokeStyle = paint.labelBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(left, top, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = paint.labelText;
    ctx.fillText(display, x, top + padY);
  } else {
    ctx.fillStyle = paint.dimLabel;
    ctx.fillText(display, x, y);
  }
}

type ForceNode = LayoutNode;

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
}: KnowledgeGraphViewProps) {
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [didFit, setDidFit] = useState(false);
  const mobile = useMobileLayout();
  const canHover = useCanHover();
  const { theme } = useAppTheme();
  const paint = theme === "dark" ? PAINT_DARK : PAINT_LIGHT;
  const { openHub, closeHub, target } = useGraphHub();
  const threadFocus = viewFilter === "thread";
  const [lens, setLens] = useState<ExplorerLens>(DEFAULT_EXPLORER_LENS);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<KnowledgeGraphNode | null>(null);
  const [hovered, setHovered] = useState<KnowledgeGraphNode | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  useEffect(() => {
    setSelected(null);
  }, [threadFocus]);

  const viewData = useMemo(() => {
    const base = threadFocus ? applyThreadFocusFilter(data) : data;
    if (threadFocus) return base;
    return applyExplorerLens(base, lens);
  }, [data, threadFocus, lens]);

  const filtered = useMemo(() => {
    const nodes = viewData.nodes.map((n) => ({ ...n })) as LayoutNode[];
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
  }, [viewData]);

  const toggleLens = useCallback((key: keyof ExplorerLens) => {
    setLens((prev) => ({ ...prev, [key]: !prev[key] }));
    setSelected(null);
  }, []);

  const handleNodeClick = useCallback(
    (node: ForceNode) => {
      const next = {
        id: node.id,
        type: node.type,
        label: node.label,
        size: node.size,
        meta: node.meta,
      };
      setSelected(next);
      openHub({ nodeId: node.id });
    },
    [openHub],
  );

  useEffect(() => {
    if (!initialFocusNodeId) return;
    const node = viewData.nodes.find((n) => n.id === initialFocusNodeId);
    if (node) {
      setSelected(node);
      openHub({ nodeId: node.id });
      setDidFit(false);
    }
  }, [initialFocusNodeId, viewData, openHub]);

  useEffect(() => {
    if (!target?.nodeId) return;
    const node = viewData.nodes.find((n) => n.id === target.nodeId);
    if (node) setSelected(node);
  }, [target?.nodeId, viewData]);

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

  const hoveredId = hovered?.id ?? null;
  const selectedId = selected?.id ?? null;

  const searchIds = useMemo(
    () => searchMatchIds(filtered.nodes, filtered.links, search),
    [filtered.nodes, filtered.links, search],
  );

  const focusIds = useMemo(() => {
    if (selectedId) return neighborIds(selectedId, filtered.links);
    return searchIds && searchIds.size > 0 ? searchIds : null;
  }, [selectedId, filtered.links, searchIds]);

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
  }, [filtered.nodes.length, lens, search]);

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
  }, [hoveredId, selectedId, paint]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 40);
    return () => window.clearTimeout(timer);
  }, [target?.nodeId]);

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
        Math.sqrt(Math.max(n.size, 4)) *
        (mobile ? 2.8 : 2.4) *
        (isSelected ? 1.38 : isNeighbor ? 1.08 : inFocus ? 1 : 0.92);

      const x = n.x ?? 0;
      const y = n.y ?? 0;

      ctx.save();
      ctx.globalAlpha = inFocus ? (isSelected ? 1 : isNeighbor ? paint.neighborAlpha : paint.idleAlpha) : paint.dimAlpha;

      if (isSelected) {
        ctx.shadowColor = NODE_COLORS[n.type];
        ctx.shadowBlur = Math.max(8, 14 / globalScale);
      }

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = NODE_COLORS[n.type];
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = paint.nodeStroke;
      ctx.lineWidth = 1 / Math.max(globalScale, 0.5);
      ctx.stroke();

      if (emphasized && inFocus) {
        ctx.beginPath();
        ctx.arc(x, y, size + (isSelected ? 3.5 : 2), 0, 2 * Math.PI);
        ctx.strokeStyle = isSelected ? NODE_COLORS[n.type] : paint.ring;
        ctx.lineWidth = (isSelected ? 2.5 : 1.5) / globalScale;
        ctx.stroke();
      }

      if (shouldShowCanvasLabel(n, globalScale, hoveredId, selectedId, focusIds) && n.label) {
        drawNodeLabel(ctx, n.label, x, y + size + 4 / globalScale, globalScale, Boolean(emphasized), paint);
      }

      ctx.restore();
    },
    [hoveredId, selectedId, focusIds, mobile, paint],
  );

  const linkColor = useCallback(
    (link: object) => {
      const l = link as { source?: string | ForceNode; target?: string | ForceNode };
      if (!focusIds || !l.source || !l.target) return paint.link;
      const src = linkEndpointId(l.source);
      const tgt = linkEndpointId(l.target);
      const active = focusIds.has(src) && focusIds.has(tgt);
      return active ? paint.linkActive : paint.linkDim;
    },
    [focusIds, paint],
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
      return (active ? base * 1.65 : base * 0.7) * thin;
    },
    [focusIds],
  );

  const linkCurvature = useCallback((link: object) => {
    const l = link as { type?: string };
    return l.type === "related_to" ? 0.22 : 0;
  }, []);

  const linkLabel = useCallback((link: object) => {
    const l = link as { label?: string | null; type?: string };
    return l.label || l.type || "";
  }, []);

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
                  : "Nothing matches these filters. Try Topics, or turn on Articles."}
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
            linkLabel={linkLabel}
            linkDirectionalParticles={selectedId && filtered.links.length < 90 ? 2 : 0}
            linkDirectionalParticleWidth={1.6}
            linkDirectionalParticleSpeed={0.005}
            onNodeClick={(node) => handleNodeClick(node as ForceNode)}
            onNodeHover={canHover ? (node) => setHovered(node as KnowledgeGraphNode | null) : undefined}
            onBackgroundClick={() => {
              setSelected(null);
              closeHub();
            }}
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

        {canHover && hovered ? (
          <div className="kg-hover-tip" role="status">
            <span className="kg-hover-tip-dot" style={{ background: NODE_COLORS[hovered.type] }} />
            <span>
              {hovered.label}
              <span className="kg-hover-tip-kind">
                {hovered.type === "entity"
                  ? String(hovered.meta.kind || "watched")
                  : NODE_LABELS[hovered.type].replace(/s$/, "")}
              </span>
            </span>
          </div>
        ) : null}

        {filtered.nodes.length > 0 ? (
          <p className="kg-float-hint">
            {focusIds
              ? mobile
                ? "Tap empty space to show full graph"
                : "Click empty space to show full graph"
              : mobile
                ? "Tap a node to open its profile"
                : "Clusters stay quiet until you click — open a node for the story"}
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
                Topics and watched names sit in clusters. Articles stay hidden until you ask for them.
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
          <div className="kg-view-pills" role="group" aria-label="Explorer view">
            <button
              type="button"
              className={`kg-view-pill${!threadFocus ? " is-active" : ""}`}
              aria-pressed={!threadFocus}
              onClick={() => onViewChange?.({ filter: null })}
            >
              Network
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
          <label className="kg-search">
            <span className="sr-only">Search the network</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              aria-label="Highlight related nodes"
            />
          </label>
          {!threadFocus ? (
            <div className="kg-filters-scroll">
              <div className="kg-filters" role="group" aria-label="Filter clusters">
                <button
                  type="button"
                  className={`kg-filter-btn${lens.companies ? " is-active" : ""}`}
                  aria-pressed={lens.companies}
                  onClick={() => toggleLens("companies")}
                >
                  Companies
                </button>
                <button
                  type="button"
                  className={`kg-filter-btn${lens.people ? " is-active" : ""}`}
                  aria-pressed={lens.people}
                  onClick={() => toggleLens("people")}
                >
                  People
                </button>
                <button
                  type="button"
                  className={`kg-filter-btn${lens.topics ? " is-active" : ""}`}
                  aria-pressed={lens.topics}
                  onClick={() => toggleLens("topics")}
                >
                  Topics
                </button>
                <button
                  type="button"
                  className={`kg-filter-btn${lens.watchedOnly ? " is-active" : ""}`}
                  aria-pressed={lens.watchedOnly}
                  onClick={() => toggleLens("watchedOnly")}
                >
                  Only watched
                </button>
                <button
                  type="button"
                  className={`kg-filter-btn${lens.articles ? " is-active" : ""}`}
                  aria-pressed={lens.articles}
                  onClick={() => toggleLens("articles")}
                >
                  Articles
                </button>
              </div>
            </div>
          ) : null}
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
    </div>
  );
}
