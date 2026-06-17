"use client";

import { Reveal } from "./Reveal";
import { SourceIcon } from "@/components/SourceIcon";

type Source = {
  name: string;
  type: string;
  nameOverride?: string;
};

const SOURCES: Source[] = [
  { name: "Gmail", type: "gmail" },
  { name: "YouTube", type: "youtube" },
  { name: "Reddit", type: "reddit" },
  { name: "RSS", type: "rss" },
  { name: "Substack", type: "rss", nameOverride: "Substack" },
  { name: "Readwise", type: "readwise" },
  { name: "Hacker News", type: "rss", nameOverride: "Hacker News" },
  { name: "Any URL", type: "url" },
];

/** Four identical groups → animate -25% for a seamless loop with no seam gap. */
const MARQUEE_GROUP_COUNT = 4;

function SourceChip({ name, type, nameOverride }: Source) {
  const label = nameOverride ?? name;
  return (
    <div className="source-chip">
      <span className="source-chip-logo">
        <SourceIcon type={type} name={label} size={18} />
      </span>
      <span className="source-chip-name">{name}</span>
    </div>
  );
}

function MarqueeGroup({ groupIndex }: { groupIndex: number }) {
  return (
    <div
      className="sources-marquee-group"
      aria-hidden={groupIndex > 0 ? true : undefined}
    >
      {SOURCES.map((s) => (
        <SourceChip key={`${groupIndex}-${s.name}`} {...s} />
      ))}
    </div>
  );
}

export function SourcesStrip() {
  return (
    <div className="sources-strip landing-band-base">
      <Reveal>
        <p className="sources-strip-label">Works with what you already follow</p>
        <p className="sources-strip-sub">
          You pick what Briefly ingests — not your whole inbox or account. Here&apos;s exactly what we access:
        </p>
      </Reveal>

      <div className="sources-marquee" aria-hidden>
        <div className="sources-marquee-track">
          {Array.from({ length: MARQUEE_GROUP_COUNT }, (_, i) => (
            <MarqueeGroup key={i} groupIndex={i} />
          ))}
        </div>
      </div>

      <div className="sources-strip-icons sources-strip-icons-static">
        {SOURCES.map((s) => (
          <SourceChip key={s.name} {...s} />
        ))}
      </div>
    </div>
  );
}
