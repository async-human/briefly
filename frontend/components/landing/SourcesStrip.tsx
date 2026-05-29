import { Reveal } from "./Reveal";

const sources = [
  { name: "Gmail",     icon: "M" },
  { name: "YouTube",   icon: "▶" },
  { name: "Reddit",    icon: "R" },
  { name: "RSS Feeds", icon: "⊕" },
  { name: "Substack",  icon: "S" },
  { name: "Readwise",  icon: "W" },
  { name: "Hacker News", icon: "Y" },
  { name: "Any URL",   icon: "↗" },
];

export function SourcesStrip() {
  return (
    <div className="sources-strip">
      <Reveal>
        <p className="sources-strip-label">Works with what you already follow</p>
        <div className="sources-strip-icons">
          {sources.map((s) => (
            <div key={s.name} className="source-chip">
              <span className="source-chip-icon">{s.icon}</span>
              <span className="source-chip-name">{s.name}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
