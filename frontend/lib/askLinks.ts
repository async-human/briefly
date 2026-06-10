/** Deep links into Ask Briefly. */

export type AskScope = {
  contentId?: string;
  digestItemId?: string;
  threadId?: string;
  title?: string;
};

export function askUrl(scope?: AskScope): string {
  const params = new URLSearchParams();
  if (scope?.contentId) params.set("content", scope.contentId);
  if (scope?.digestItemId) params.set("item", scope.digestItemId);
  if (scope?.threadId) params.set("thread", scope.threadId);
  if (scope?.title) params.set("title", scope.title);
  const qs = params.toString();
  return qs ? `/ask?${qs}` : "/ask";
}

export function askAboutContent(
  contentId: string,
  digestItemId?: string,
  title?: string,
): string {
  return askUrl({ contentId, digestItemId, title });
}

/** First-turn question when user taps "Ask about this" from a briefing item. */
export function buildContextualAskQuestion(title?: string | null): string {
  const headline = title?.trim();
  if (headline) {
    return (
      `I'm reading "${headline}" from my briefing. ` +
      `Give me a concise deeper briefing: what happened, why it matters to me personally, ` +
      `and what I should watch for next. Use my sources.`
    );
  }
  return (
    "I'm asking about a story from my briefing. Summarize what happened, " +
    "why it matters to me personally, and what I should watch for next."
  );
}
