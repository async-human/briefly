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
