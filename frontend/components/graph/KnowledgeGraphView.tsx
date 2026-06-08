"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { KnowledgeGraphNode, KnowledgeGraphNodeType, KnowledgeGraphResponse } from "@/lib/api";

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

function truncateLabel(label: string, max: number): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function shouldShowCanvasLabel(
  node: KnowledgeGraphNode,
  globalScale: number,
  hoveredId: string | null,
  selectedId: string | null,
): boolean {
  if (node.id === hoveredId || node.id === selectedId) return true;
  if (node.type === "item" || node.type === "thought") return false;
  if (!ANCHOR_TYPES.has(node.type)) return false;
  return globalScale >= 1.35;
}

const ALL_TYPES: KnowledgeGraphNodeType[] = ["topic", "source", "item", "thought", "thread"];

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

type ForceNode = KnowledgeGraphNode & { x?: number; y?: number };

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
};

export function KnowledgeGraphView({ data }: KnowledgeGraphViewProps) {
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [didFit, setDidFit] = useState(false);
  const mobile = useMobileLayout();
  const canHover = useCanHover();
  const [activeTypes, setActiveTypes] = useState<Set<KnowledgeGraphNodeType>>(
    () => new Set(ALL_TYPES),
  );
  const [selected, setSelected] = useState<KnowledgeGraphNode | null>(null);
  const [hovered, setHovered] = useState<KnowledgeGraphNode | null>(null);

  const filtered = useMemo(() => {
    const nodes = data.nodes.filter((n) => activeTypes.has(n.type));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = data.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        label: e.label,
        type: e.type,
      }));
    return { nodes, links };
  }, [data, activeTypes]);

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

  const hoveredId = hovered?.id ?? null;
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    setDidFit(false);
  }, [filtered.nodes.length, activeTypes]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.pauseAnimation();
    graph.resumeAnimation();
    const timer = window.setTimeout(() => graph.pauseAnimation(), 120);
    return () => window.clearTimeout(timer);
  }, [hoveredId, selectedId]);

  const focusNode = filtered.nodes.find((n) => n.id === selected?.id) ?? selected;

  useEffect(() => {
    if (!focusNode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [focusNode]);

  const fitPadding = mobile ? 80 : 48;

  const renderNode = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as ForceNode;
      const size = Math.sqrt(Math.max(n.size, 4)) * (mobile ? 2.6 : 2.2);
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const isHovered = n.id === hoveredId;
      const isSelected = n.id === selectedId;
      const emphasized = isHovered || isSelected;

      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);
      ctx.fillStyle = NODE_COLORS[n.type];
      ctx.fill();

      if (emphasized) {
        ctx.beginPath();
        ctx.arc(x, y, size + 2.5, 0, 2 * Math.PI);
        ctx.strokeStyle = isSelected ? NODE_COLORS[n.type] : "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.stroke();
      }

      if (shouldShowCanvasLabel(n, globalScale, hoveredId, selectedId) && n.label) {
        drawNodeLabel(ctx, n.label, x, y + size + 4 / globalScale, globalScale, emphasized);
      }
    },
    [hoveredId, selectedId, mobile],
  );

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
    </>
  ) : null;

  return (
    <div className={`kg-stage${mobile ? " kg-stage-mobile" : ""}`}>
      <div className="kg-canvas-wrap">
        {filtered.nodes.length === 0 ? (
          <div className="kg-empty">
            <p className="kg-empty-title">No nodes to show</p>
            <p className="kg-empty-desc">Turn on a node type below, or keep reading to grow your graph.</p>
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
            linkWidth={(link) => 0.5 + (link.weight ?? 0.3) * 2.5}
            linkColor={() => "rgba(94, 106, 210, 0.22)"}
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
            cooldownTicks={mobile ? 60 : 80}
            d3AlphaDecay={0.03}
            d3VelocityDecay={0.4}
          />
        )}

        {canHover && hovered && !focusNode ? (
          <div className="kg-hover-tip" role="status">
            <span className="kg-hover-tip-dot" style={{ background: NODE_COLORS[hovered.type] }} />
            {hovered.label}
          </div>
        ) : null}

        {!focusNode && filtered.nodes.length > 0 ? (
          <p className="kg-float-hint">
            {mobile ? "Tap a node to inspect" : "Click a node to inspect"}
          </p>
        ) : null}
      </div>

      <div className="kg-float-bar">
        <div className="kg-float-controls">
          <div className="kg-filters-scroll">
            <div className="kg-filters" role="group" aria-label="Filter node types">
              {ALL_TYPES.map((type) => {
                const on = activeTypes.has(type);
                const count = data.nodes.filter((n) => n.type === type).length;
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
