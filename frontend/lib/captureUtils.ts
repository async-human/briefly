import type { BrowserCapture, UrlCaptureResponse } from "@/lib/api";

export function captureResponseToBrowserCapture(res: UrlCaptureResponse): BrowserCapture {
  return {
    id: res.id,
    title: res.title,
    url: res.url,
    summary: res.summary,
    user_note: res.user_note,
    created_at: res.created_at,
    in_briefing: false,
    connection_sentence: res.enrichment.connection_sentence ?? null,
    thread_label: res.enrichment.thread_label ?? null,
    why_relevant: res.enrichment.why_relevant ?? null,
  };
}

export function enrichmentConnectionText(
  enrichment: UrlCaptureResponse["enrichment"],
): string | null {
  if (enrichment.connection_sentence) return enrichment.connection_sentence;
  if (enrichment.briefing_message) return enrichment.briefing_message;
  if (enrichment.thread_label) {
    const count =
      enrichment.thread_item_count != null ? ` (${enrichment.thread_item_count} this week)` : "";
    return `Connects to your ${enrichment.thread_label} thread${count}`;
  }
  return null;
}
