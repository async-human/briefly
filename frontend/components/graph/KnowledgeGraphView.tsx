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

const ALL_TYPES: KnowledgeGraphNodeType[] = ["topic", "source", "item", "thought", "thread"];

type ForceNode = KnowledgeGraphNode & { x?: number; y?: number };

type KnowledgeGraphViewProps = {
  data: KnowledgeGraphResponse;
};

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

export function KnowledgeGraphView({ data }: KnowledgeGraphViewProps) {
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [didFit, setDidFit] = useState(false);
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

  useEffect(() => {
    setDidFit(false);
  }, [filtered.nodes.length, activeTypes]);

  const focusNode = filtered.nodes.find((n) => n.id === selected?.id) ?? selected;

  return (
    <div className="kg-layout">
      <div className="kg-toolbar">
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
              >
                <span className="kg-filter-dot" style={{ background: NODE_COLORS[type] }} />
                {NODE_LABELS[type]}
                <span className="kg-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="kg-toolbar-actions">
          <button
            type="button"
            className="dash-btn dash-btn-secondary kg-fit-btn"
            onClick={() => graphRef.current?.zoomToFit(400, 48)}
          >
            Fit view
          </button>
        </div>
      </div>

      <div className="kg-main">
        <div className="kg-canvas-wrap">
          {filtered.nodes.length === 0 ? (
            <div className="kg-empty">
              <p className="kg-empty-title">No nodes to show</p>
              <p className="kg-empty-desc">Turn on a node type above, or keep reading to grow your graph.</p>
            </div>
          ) : (
            <ForceGraph2D
              ref={graphRef}
              graphData={filtered}
              backgroundColor="transparent"
              nodeRelSize={1}
              nodeVal={(n) => (n as KnowledgeGraphNode).size}
              nodeLabel={(n) => (n as KnowledgeGraphNode).label}
              nodeColor={(n) => NODE_COLORS[(n as KnowledgeGraphNode).type]}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const n = node as ForceNode;
                const size = Math.sqrt(Math.max(n.size, 4)) * 2.2;
                ctx.beginPath();
                ctx.arc(n.x ?? 0, n.y ?? 0, size, 0, 2 * Math.PI);
                ctx.fillStyle = NODE_COLORS[n.type];
                ctx.fill();
                if (globalScale > 1.1 && n.label) {
                  ctx.font = `${Math.max(10, 12 / globalScale)}px DM Sans, sans-serif`;
                  ctx.fillStyle = "#444";
                  ctx.textAlign = "center";
                  ctx.fillText(
                    n.label.length > 36 ? `${n.label.slice(0, 34)}…` : n.label,
                    n.x ?? 0,
                    (n.y ?? 0) + size + 10 / globalScale,
                  );
                }
              }}
              linkWidth={(link) => 0.5 + (link.weight ?? 0.3) * 2.5}
              linkColor={() => "rgba(94, 106, 210, 0.28)"}
              linkDirectionalParticles={0}
              onNodeClick={(node) => handleNodeClick(node as ForceNode)}
              onNodeHover={(node) => setHovered(node as KnowledgeGraphNode | null)}
              onBackgroundClick={() => setSelected(null)}
              onEngineStop={() => {
                if (!didFit) {
                  graphRef.current?.zoomToFit(400, 48);
                  setDidFit(true);
                }
              }}
              cooldownTicks={80}
              d3AlphaDecay={0.025}
              d3VelocityDecay={0.35}
            />
          )}
          {hovered && !selected ? (
            <div className="kg-hover-tip" role="status">
              {hovered.label}
            </div>
          ) : null}
        </div>

        <aside className={`kg-inspector${focusNode ? " is-open" : ""}`} aria-live="polite">
          {focusNode ? (
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
          ) : (
            <div className="kg-inspector-placeholder">
              <p className="kg-inspector-placeholder-title">Your second brain, mapped</p>
              <p className="kg-inspector-placeholder-desc">
                Drag to explore. Click any node to inspect connections Briefly discovered from your reading,
                saves, and thoughts.
              </p>
              <ul className="kg-legend">
                {ALL_TYPES.map((type) => (
                  <li key={type}>
                    <span className="kg-filter-dot" style={{ background: NODE_COLORS[type] }} />
                    {NODE_LABELS[type]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
