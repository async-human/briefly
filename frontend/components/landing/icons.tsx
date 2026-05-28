type IconProps = { size?: number; className?: string };

export function ArrowRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <path d="M2 8h12M8 2l6 6-6 6" />
    </svg>
  );
}

export function ArrowDownIcon({ size = 14, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      width={size}
      height={size}
      className={className}
      aria-hidden
    >
      <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
  );
}

export function CollectIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M4 8h16M4 8l2-4h12l2 4M6 8v10a2 2 0 002 2h8a2 2 0 002-2V8" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

export function CleanIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M4 6h16M7 6V4a1 1 0 011-1h8a1 1 0 011 1v2M10 11v6M14 11v6M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14" />
    </svg>
  );
}

export function DeduplicateIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function ScoreIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function RememberIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M12 3a6 6 0 00-4 10.5V17a2 2 0 002 2h4a2 2 0 002-2v-3.5A6 6 0 0012 3z" />
      <path d="M9 21h6M10 17h4" />
    </svg>
  );
}

export function WriteIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export function VerifyIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M9 12l2 2 4-4" />
      <path d="M12 3l7 3v6c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V6l7-3z" />
    </svg>
  );
}

export function DeliverIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export function PersonalizeIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M6 20v-1a6 6 0 0112 0v1" />
      <path d="M12 12v2" />
    </svg>
  );
}

export function MemoryIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h10M7 12h6M7 16h8" />
    </svg>
  );
}

export function SourcesIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  );
}

export function FilterIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </svg>
  );
}

export function ChatIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

export function CitationIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width={size} height={size} className={className} aria-hidden>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
      <path d="M8 21h8" />
    </svg>
  );
}
