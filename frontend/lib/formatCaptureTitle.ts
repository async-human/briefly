/** Clean noisy page titles (X/Twitter, etc.) for display in saved lists. */
export function formatCaptureTitle(title: string, url?: string | null): string {
  let t = title.trim();
  if (!t) return "Saved article";

  const xTweet = t.match(/^.+?\s+on\s+X:\s*(.+?)(?:\s*\/\s*X)?$/i);
  if (xTweet) {
    t = xTweet[1].replace(/^["']|["']$/g, "").trim();
  } else {
    t = t.replace(/\s*\/\s*X\s*$/i, "").trim();
  }

  if (t.length > 80) {
    const pipe = t.match(/^(.+?)\s+\|\s+[^|]+$/);
    if (pipe && pipe[1].length >= 40) t = pipe[1].trim();

    const dash = t.match(/^(.+?)\s+[-–—]\s+[^-–—]+$/);
    if (dash && dash[1].length >= 40) t = dash[1].trim();
  }

  t = t.replace(/\s*https?:\/\/t\.co\/\w+\s*/gi, " ").trim();
  t = t.replace(/\s+/g, " ").trim();

  return t || title.trim();
}
