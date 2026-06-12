"use client";

import { Reveal } from "./Reveal";
import { SourceIcon } from "@/components/SourceIcon";

const SOURCES = [
  { name: "Gmail",        type: "gmail"   },
  { name: "YouTube",      type: "youtube" },
  { name: "Reddit",       type: "reddit"  },
  { name: "RSS",          type: "rss"     },
  { name: "Substack",     type: "rss",    nameOverride: "Substack"      },
  { name: "Readwise",     type: "readwise"                               },
  { name: "Hacker News",  type: "rss",    nameOverride: "Hacker News"   },
  { name: "Any URL",      type: "url"     },
];

function SourceChip({ name, type, nameOverride }: (typeof SOURCES)[number]) {
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

export function SourcesStrip() {
  const marqueeSources = [...SOURCES, ...SOURCES];

  return (
    <div className="sources-strip landing-band-base">
      <Reveal>
        <p className="sources-strip-label">Works with what you already follow</p>
      </Reveal>

      <div className="sources-marquee" aria-hidden>
        <div className="sources-marquee-track">
          {marqueeSources.map((s, i) => (
            <SourceChip key={`${s.name}-${i}`} {...s} />
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
