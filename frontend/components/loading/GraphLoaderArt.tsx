import type { CSSProperties } from "react";

type NodeKind = "hub" | "topic" | "source" | "item" | "thought" | "thread";

type GraphNode = {
  id: string;
  x: number;
  y: number;
  r: number;
  kind: NodeKind;
  delay: number;
};

type GraphEdge = {
  from: string;
  to: string;
  delay: number;
  pulse?: boolean;
};

/** Organic mini-graph — mirrors real knowledge-graph node types. */
const NODES: GraphNode[] = [
  { id: "hub", x: 120, y: 120, r: 7, kind: "hub", delay: 0 },
  { id: "t1", x: 120, y: 46, r: 5, kind: "topic", delay: 0.28 },
  { id: "s1", x: 180, y: 78, r: 4.5, kind: "source", delay: 0.38 },
  { id: "i1", x: 196, y: 132, r: 4, kind: "item", delay: 0.48 },
  { id: "r1", x: 162, y: 186, r: 4.5, kind: "thread", delay: 0.44 },
  { id: "o1", x: 78, y: 184, r: 4, kind: "thought", delay: 0.52 },
  { id: "i2", x: 44, y: 126, r: 4, kind: "item", delay: 0.46 },
  { id: "t2", x: 54, y: 74, r: 4.5, kind: "topic", delay: 0.36 },
  { id: "s2", x: 90, y: 40, r: 3.5, kind: "source", delay: 0.42 },
  { id: "i3", x: 170, y: 106, r: 3.5, kind: "item", delay: 0.5 },
  { id: "i4", x: 70, y: 150, r: 3, kind: "item", delay: 0.54 },
];

const EDGES: GraphEdge[] = [
  { from: "hub", to: "t1", delay: 0.12, pulse: true },
  { from: "hub", to: "s1", delay: 0.18, pulse: true },
  { from: "hub", to: "i1", delay: 0.24 },
  { from: "hub", to: "r1", delay: 0.2 },
  { from: "hub", to: "o1", delay: 0.22 },
  { from: "hub", to: "i2", delay: 0.16, pulse: true },
  { from: "hub", to: "t2", delay: 0.14 },
  { from: "t1", to: "s2", delay: 0.34 },
  { from: "t1", to: "t2", delay: 0.32 },
  { from: "s1", to: "i3", delay: 0.4 },
  { from: "s1", to: "i1", delay: 0.38 },
  { from: "i1", to: "r1", delay: 0.46 },
  { from: "r1", to: "o1", delay: 0.48 },
  { from: "o1", to: "i2", delay: 0.5 },
  { from: "i2", to: "i4", delay: 0.52 },
  { from: "i2", to: "t2", delay: 0.44 },
  { from: "t2", to: "s2", delay: 0.42 },
  { from: "i3", to: "i1", delay: 0.54 },
  { from: "o1", to: "i4", delay: 0.56 },
];

const NODE_INDEX = Object.fromEntries(NODES.map((n, i) => [n.id, i]));

function edgePath(from: GraphNode, to: GraphNode): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

export function GraphLoaderArt() {
  return (
    <div className="hm-graph-loader" aria-hidden>
      <span className="hm-graph-loader-ambient" />
      <svg className="hm-graph-loader-svg" viewBox="0 0 240 240" fill="none">
        <defs>
          <filter id="hm-graph-node-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="hm-graph-loader-network">
          <g className="hm-graph-loader-edges">
            {EDGES.map((edge, i) => {
              const a = NODES[NODE_INDEX[edge.from]];
              const b = NODES[NODE_INDEX[edge.to]];
              const pathId = `hm-graph-edge-${i}`;
              return (
                <g key={pathId}>
                  <path
                    id={pathId}
                    d={edgePath(a, b)}
                    className="hm-graph-loader-edge"
                    pathLength={1}
                    style={{ animationDelay: `${edge.delay}s` }}
                  />
                  {edge.pulse ? (
                    <circle r="2" className="hm-graph-loader-pulse">
                      <animateMotion
                        dur="2.6s"
                        repeatCount="indefinite"
                        begin={`${edge.delay + 0.85}s`}
                        calcMode="spline"
                        keyTimes="0;1"
                        keySplines="0.45 0 0.55 1"
                        rotate="auto"
                      >
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  ) : null}
                </g>
              );
            })}
          </g>

          <g className="hm-graph-loader-nodes" filter="url(#hm-graph-node-glow)">
            {NODES.map((node) => (
              <g
                key={node.id}
                className={`hm-graph-loader-node hm-graph-loader-node--${node.kind}`}
                transform={`translate(${node.x} ${node.y})`}
                style={
                  {
                    "--node-delay": `${node.delay}s`,
                    "--float-phase": `${node.delay * 3.7}s`,
                  } as CSSProperties
                }
              >
                <circle className="hm-graph-loader-node-ring" r={node.r + 5} />
                <circle className="hm-graph-loader-node-core" r={node.r} />
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
