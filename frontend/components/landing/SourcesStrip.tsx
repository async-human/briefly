import { Reveal } from "./Reveal";

/* Real brand SVG logos — inline for zero external requests */
const logos = [
  {
    name: "Gmail",
    svg: (
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <path d="M2 6.5C2 5.4 2.9 4.5 4 4.5h16c1.1 0 2 .9 2 2v11c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6.5z" fill="#fff" stroke="#e0e0e0" strokeWidth="0.5"/>
        <path d="M2 6.5l10 7 10-7" stroke="#EA4335" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M2 6.5L12 13.5" stroke="#34A853" strokeWidth="1.5"/>
        <path d="M22 6.5L12 13.5" stroke="#4285F4" strokeWidth="1.5"/>
        <path d="M4 19.5V9.5L12 14.5 20 9.5V19.5" fill="#fff"/>
        <path d="M4 9.5L12 14.5 20 9.5" stroke="#FBBC04" strokeWidth="0.5" fill="none"/>
      </svg>
    ),
  },
  {
    name: "YouTube",
    svg: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5a3 3 0 0 0-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8z" fill="#FF0000"/>
        <path d="M9.6 15.6V8.4l6.2 3.6-6.2 3.6z" fill="#fff"/>
      </svg>
    ),
  },
  {
    name: "Reddit",
    svg: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <circle cx="12" cy="12" r="12" fill="#FF4500"/>
        <path d="M20 12a2 2 0 0 0-2-2 2 2 0 0 0-1.3.5C15.5 9.7 14 9.2 12.3 9.1l.9-4.1 2.8.6a1.4 1.4 0 1 0 .1-.6L13.2 4.4l-1 4.7c-1.7.1-3.2.6-4.4 1.4A2 2 0 0 0 4 12a2 2 0 0 0 .9 1.7 4 4 0 0 0 0 .6c0 2.8 3.2 5 7.1 5s7.1-2.2 7.1-5a4 4 0 0 0 0-.6A2 2 0 0 0 20 12zm-13.5.8a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0zm6.8 3.2a4 4 0 0 1-2.3.6 4 4 0 0 1-2.3-.6.3.3 0 0 1 .4-.4 3.4 3.4 0 0 0 1.9.5 3.4 3.4 0 0 0 1.9-.5.3.3 0 0 1 .4.4zm-.3-2a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0z" fill="#fff"/>
      </svg>
    ),
  },
  {
    name: "RSS",
    svg: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <rect width="24" height="24" rx="5" fill="#F26522"/>
        <circle cx="6.5" cy="17.5" r="2.5" fill="#fff"/>
        <path d="M4 12.5a7.5 7.5 0 0 1 7.5 7.5h2.5A10 10 0 0 0 4 10v2.5z" fill="#fff"/>
        <path d="M4 7A13 13 0 0 1 17 20h2.5A15.5 15.5 0 0 0 4 4.5V7z" fill="#fff"/>
      </svg>
    ),
  },
  {
    name: "Substack",
    svg: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <rect width="24" height="24" rx="4" fill="#FF6719"/>
        <path d="M4 7.5h16v2H4zM4 11.5h16v2H4zM4 15.5l8 4 8-4V17H4z" fill="#fff"/>
      </svg>
    ),
  },
  {
    name: "Readwise",
    svg: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <rect width="24" height="24" rx="4" fill="#3B82F6"/>
        <path d="M6 17V8h12l-4 4.5 4 4.5H6z" fill="#fff" opacity="0.9"/>
      </svg>
    ),
  },
  {
    name: "Hacker News",
    svg: (
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <rect width="24" height="24" rx="3" fill="#FF6600"/>
        <path d="M6 5l4 7.5V19h4v-6.5L18 5h-2.5L12 11.5 8.5 5z" fill="#fff"/>
      </svg>
    ),
  },
  {
    name: "Any URL",
    svg: (
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
        <circle cx="12" cy="12" r="9.5" stroke="#6b7280" strokeWidth="1.5"/>
        <path d="M2.5 12h19M12 2.5c-3 3-4.5 6-4.5 9.5s1.5 6.5 4.5 9.5M12 2.5c3 3 4.5 6 4.5 9.5s-1.5 6.5-4.5 9.5" stroke="#6b7280" strokeWidth="1.5"/>
      </svg>
    ),
  },
];

export function SourcesStrip() {
  return (
    <div className="sources-strip">
      <Reveal>
        <p className="sources-strip-label">Works with what you already follow</p>
        <div className="sources-strip-icons">
          {logos.map((s) => (
            <div key={s.name} className="source-chip">
              <span className="source-chip-logo">{s.svg}</span>
              <span className="source-chip-name">{s.name}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </div>
  );
}
