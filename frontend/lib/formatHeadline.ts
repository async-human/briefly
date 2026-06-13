/** Display-friendly headline trimming for dashboard cards (browser captures, social posts). */

const DEFAULT_HERO_MAX = 132;
const DEFAULT_PREVIEW_MAX = 96;

function normalizeHeadline(headline: string): string {
  return (headline || "").trim().replace(/\s+/g, " ");
}

/** Drop trailing " | Author Name" common on LinkedIn / Medium captures. */
function stripTrailingAttribution(headline: string): string {
  return headline.replace(/\s*[|·—–-]\s*[A-Z][^|·—]{0,48}$/, "").trim();
}

function truncateAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const slice = text.slice(0, maxChars);
  const sentenceBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (sentenceBreak >= maxChars * 0.45) {
    return text.slice(0, sentenceBreak + 1).trim();
  }

  const wordBreak = slice.lastIndexOf(" ");
  const cut = wordBreak >= maxChars * 0.55 ? wordBreak : maxChars;
  return `${text.slice(0, cut).trimEnd()}…`;
}

export function formatHeroHeadline(
  headline: string,
  maxChars = DEFAULT_HERO_MAX,
): { display: string; full: string; truncated: boolean } {
  const full = normalizeHeadline(headline);
  if (!full) return { display: "", full: "", truncated: false };

  const cleaned = stripTrailingAttribution(full);
  const display = truncateAtBoundary(cleaned, maxChars);
  return {
    display,
    full,
    truncated: display.length < full.length || cleaned.length < full.length,
  };
}

export function formatPreviewHeadline(headline: string, maxChars = DEFAULT_PREVIEW_MAX): string {
  const { display } = formatHeroHeadline(headline, maxChars);
  return display;
}

export function formatHeroWhy(text: string, maxChars = 200): string {
  const normalized = (text || "").trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  return truncateAtBoundary(normalized, maxChars);
}
