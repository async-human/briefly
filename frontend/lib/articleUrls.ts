/** True when a URL points at Gmail inbox UI, not a public article. */
export function isGmailInboxUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/mail\.google\.com\//i.test(url.trim());
}

export function isReadableArticleUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.trim().toLowerCase();
  if (isGmailInboxUrl(u)) return false;
  if (u.startsWith("mailto:")) return false;
  return u.startsWith("http://") || u.startsWith("https://");
}
