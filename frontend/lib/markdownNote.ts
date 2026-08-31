import type { DigestItem } from "@/lib/api";

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

export function digestItemToMarkdown(item: DigestItem): string {
  const sourceName = clean(item.source_name) || "Original source";
  const sourceUrl = clean(item.source_url);
  const source = sourceUrl ? `[${sourceName}](${sourceUrl})` : sourceName;
  const context = [
    clean(item.memory_reference),
    ...(item.memory_connections ?? []).map((connection) => clean(connection.description)),
  ].filter((value, index, values) => value && values.indexOf(value) === index);

  const sections = [
    `# ${clean(item.headline) || "Briefly idea note"}`,
    `Source: ${source}`,
    "",
    "## What changed",
    clean(item.summary) || "Add your summary here.",
    "",
    "## Why it matters",
    clean(item.why_it_matters) || "Add the implication here.",
  ];

  const who = clean(item.who_it_affects);
  if (who) {
    sections.push("", "## Who it affects", who);
  }

  const action = clean(item.suggested_action);
  if (action) {
    sections.push("", "## Suggested action", action);
  }

  if (context.length > 0) {
    sections.push("", "## Related context", context.map((line) => `- ${line}`).join("\n"));
  }

  sections.push("", "## Idea", "");
  return `${sections.join("\n")}\n`;
}

export async function copyMarkdownNote(item: DigestItem): Promise<void> {
  const markdown = digestItemToMarkdown(item);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(markdown);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = markdown;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard access is unavailable.");
  }
}
