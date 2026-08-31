import type { Digest, DigestItem, WatchedAlert, WatchedEntity } from "@/lib/api";
import { askAboutContent, askUrl } from "@/lib/askLinks";
import { detectorLabel } from "@/lib/detectors";

export type IntelKind = "change" | "pattern" | "decision";

export type IntelligenceObject = {
  id: string;
  kind: IntelKind;
  label: string;
  title: string;
  why: string;
  connected?: string;
  confidence?: number | null;
  digestId?: string | null;
  itemId?: string | null;
  askHref?: string;
  readHref?: string;
  sourceUrl?: string | null;
  sourceName?: string | null;
  previousState?: string | null;
  newState?: string | null;
  corroborating?: number;
  urgent?: boolean;
  action?: string | null;
};

export type PulseNode = {
  id: string;
  name: string;
  active: boolean;
};

export type MorningPulseModel = {
  line: string;
  changeCount: number;
  decisionCount: number;
  urgentCount: number;
  nodes: PulseNode[];
  connectionLabel: string | null;
  cards: IntelligenceObject[];
  action: { label: string; href: string } | null;
};

const MAX_CARDS = 3;
const MAX_NODES = 5;

export function shortLabel(text: string | null | undefined, max = 16): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).replace(/\s+\S*$/, "")}…`;
}

export function countPhrase(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

function confidenceOf(item: DigestItem | WatchedAlert): number | null {
  if ("signal_confidence" in item && typeof item.signal_confidence === "number" && item.signal_confidence > 0) {
    return item.signal_confidence;
  }
  if ("confidence" in item && typeof item.confidence === "number" && item.confidence > 0) {
    return item.confidence;
  }
  return null;
}

function itemMatchingAlert(digest: Digest | null, alert: WatchedAlert): DigestItem | undefined {
  const items = digest?.items ?? [];
  if (alert.signal_id) {
    const bySignal = items.find((i) => i.signal_id && i.signal_id === alert.signal_id);
    if (bySignal) return bySignal;
  }
  const title = alert.title.trim().toLowerCase();
  return items.find((i) => i.headline.trim().toLowerCase() === title);
}

function fromAlert(alert: WatchedAlert, digest: Digest | null): IntelligenceObject {
  const kind: IntelKind = alert.detector_type ? "change" : "pattern";
  const why = (alert.why_it_matters || alert.what_changed || "").trim();
  const match = itemMatchingAlert(digest, alert);
  const digestId = digest?.id ?? null;
  return {
    id: `alert:${alert.id}`,
    kind,
    label: kind === "change" ? "Important change" : "Emerging",
    title: alert.title,
    why: why || `Update on ${alert.entity_name}.`,
    connected: alert.entity_name,
    confidence: confidenceOf(alert),
    digestId,
    itemId: match?.id,
    askHref: match?.content_id
      ? askAboutContent(match.content_id, match.id, match.headline)
      : askUrl({ title: alert.title }),
    readHref: match && digestId
      ? `/dashboard/read/${digestId}?item=${match.id}`
      : digestId
        ? `/dashboard/read/${digestId}`
        : undefined,
    sourceUrl: alert.source_url?.startsWith("pool:") ? null : alert.source_url,
    sourceName: alert.source_name || alert.entity_name,
    previousState: alert.previous_state || null,
    newState: alert.new_state || null,
    corroborating: alert.related_urls?.length || undefined,
    urgent: Boolean(alert.is_urgent),
    action: alert.action && !/^none/i.test(alert.action) ? alert.action : null,
  };
}

function fromItem(item: DigestItem, digestId: string): IntelligenceObject {
  const isDecision = Boolean(item.contradiction_flag || item.evolution_note);
  const isPattern = !isDecision && (item.duplicate_count || 0) > 1;
  const kind: IntelKind = isDecision ? "decision" : isPattern ? "pattern" : "change";
  const detector = detectorLabel(item.detector_type);
  const why = (item.why_it_matters || item.summary || "").trim();
  const connected =
    item.memory_reference ||
    item.memory_connections?.[0]?.description ||
    detector ||
    undefined;
  return {
    id: `item:${item.id}`,
    kind,
    label: kind === "decision" ? "Reconsider?" : kind === "pattern" ? "Emerging" : "Important change",
    title: item.headline,
    why: why || item.headline,
    connected,
    confidence: confidenceOf(item),
    digestId,
    itemId: item.id,
    askHref: item.content_id
      ? askAboutContent(item.content_id, item.id, item.headline)
      : askUrl({ title: item.headline }),
    readHref: `/dashboard/read/${digestId}?item=${item.id}`,
    sourceUrl: item.source_url,
    sourceName: item.source_name,
    previousState: item.previous_state || null,
    newState: item.new_state || null,
    corroborating: item.duplicate_count > 1 ? item.duplicate_count : item.evidence?.length,
    action: item.suggested_action || null,
  };
}

function pickCards(
  alerts: WatchedAlert[],
  digest: Digest | null,
): IntelligenceObject[] {
  const unread = alerts.filter((a) => !a.is_read);
  const fromWatch = unread.slice(0, 3).map((a) => fromAlert(a, digest));
  const items = digest?.items ?? [];
  const digestId = digest?.id;
  const decisions = digestId
    ? items.filter((i) => i.contradiction_flag || i.evolution_note).map((i) => fromItem(i, digestId))
    : [];
  const patterned = digestId
    ? items.filter((i) => (i.duplicate_count || 0) > 1).map((i) => fromItem(i, digestId))
    : [];
  const rest = digestId ? items.map((i) => fromItem(i, digestId)) : [];

  const picked: IntelligenceObject[] = [];
  const seen = new Set<string>();
  const take = (obj: IntelligenceObject | undefined) => {
    if (!obj || picked.length >= MAX_CARDS) return;
    const key = obj.title.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(obj);
  };

  take(fromWatch.find((c) => c.kind === "change") || fromWatch[0]);
  take(decisions[0]);
  take(patterned.find((c) => !seen.has(c.title.toLowerCase())) || fromWatch.find((c) => c.kind !== "change"));
  for (const obj of [...fromWatch, ...rest]) take(obj);
  return picked;
}

export function buildMorningPulse(input: {
  digest: Digest | null;
  alerts: WatchedAlert[];
  entities: WatchedEntity[];
  generating: boolean;
}): MorningPulseModel {
  const cards = pickCards(input.alerts, input.digest);
  const unread = input.alerts.filter((a) => !a.is_read);
  const changeCount = unread.length || cards.filter((c) => c.kind === "change").length;
  const decisionCount =
    (input.digest?.items ?? []).filter((i) => i.contradiction_flag || i.evolution_note).length ||
    cards.filter((c) => c.kind === "decision").length;
  const urgentCount = unread.filter((a) => a.is_urgent).length;

  const activeNames = new Set(
    unread.map((a) => a.entity_name).filter(Boolean),
  );
  const nodes: PulseNode[] = input.entities.slice(0, MAX_NODES).map((ent) => ({
    id: ent.id,
    name: ent.name,
    active: activeNames.has(ent.name) || unread.some((a) => a.entity_id === ent.id),
  }));

  let line = "Nothing needs you yet.";
  if (input.generating) line = "Briefly is reading your world.";
  else if (urgentCount > 0) line = "Something urgent landed.";
  else if (changeCount > 0 || cards.length > 0) line = "Your world moved a little today.";

  const firstAction = cards.find((c) => c.action)?.action;
  const actionHref = cards.find((c) => c.readHref)?.readHref
    || (input.digest?.id ? `/dashboard/read/${input.digest.id}` : null);

  const connected = cards[0]?.connected ?? null;

  return {
    line,
    changeCount,
    decisionCount,
    urgentCount,
    nodes,
    connectionLabel: connected ? shortLabel(connected, 22) : null,
    cards,
    action: firstAction && actionHref
      ? { label: firstAction, href: actionHref }
      : actionHref && cards.length
        ? { label: "Open the briefing", href: actionHref }
        : null,
  };
}
