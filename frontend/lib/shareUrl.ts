/** Extract article URL from PWA share_target query params (url, text, title). */
export function urlFromShareParams(params: URLSearchParams): string {
  const direct = params.get("url")?.trim();
  if (direct) return direct;

  const text = params.get("text")?.trim() ?? "";
  const title = params.get("title")?.trim() ?? "";
  const combined = `${text} ${title}`;
  const match = combined.match(/https?:\/\/[^\s]+/i);
  return match ? match[0].replace(/[)\],.]+$/, "") : "";
}

export function titleFromShareParams(params: URLSearchParams): string | undefined {
  const title = params.get("title")?.trim();
  return title || undefined;
}
