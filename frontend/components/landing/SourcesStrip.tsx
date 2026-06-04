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

export function SourcesStrip() {
  return (
    <div className="sources-strip landing-band-base">
      <Reveal>
        <p className="sources-strip-label">Works with what you already follow</p>
        <div className="sources-strip-icons">
          {SOURCES.map((s) => (
            <div key={s.name} className="source-chip">
              <span className="source-chip-logo">
                <SourceIcon type={s.type} name={s.nameOverride ?? s.name} size={18} />
              </span>
              <span className="source-chip-name">{s.name}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
