import type { Digest, DigestItem, WatchedAlert, WatchedEntity } from "@/lib/api";
import { askAboutContent, askUrl } from "@/lib/askLinks";
import { detectorLabel } from "@/lib/detectors";

export type IntelKind = "change" | "pattern" | "decision";

export type GlanceMetric = {
  value: string;
  hint: string;
  direction?: "down" | "up";
};

export type IntelligenceObject = {
  id: string;
  kind: IntelKind;
  label: string;
  title: string;
  why: string;
  impact?: string;
  connected?: string;
  confidence?: number | null;
  digestId?: string | null;
  itemId?: string | null;
  signalId?: string | null;
  askHref?: string;
  readHref?: string;
  sourceUrl?: string | null;
  sourceName?: string | null;
  previousState?: string | null;
  newState?: string | null;
  corroborating?: number;
  urgent?: boolean;
  action?: string | null;
  metric?: GlanceMetric | null;
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
const MAX_NODES = 6;

const DOWN_RE = /\b(cut|lower|drop|declin|reduc|fell|fall|cheaper|discount|slash|down)\b/i;
const UP_RE = /\b(rais|increas|hike|surge|higher|climbed)\b/i;

export function shortLabel(text: string | null | undefined, max = 16): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).replace(/\s+\S*$/, "")}…`;
}

export function countPhrase(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/** Pull a real percentage out of evidence text. Returns null if none is present. */
export function extractPercentDelta(
  ...texts: Array<string | null | undefined>
): GlanceMetric | null {
  const blob = texts.filter(Boolean).join(" ");
  const m = blob.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) return null;
  const down = DOWN_RE.test(blob);
  const up = UP_RE.test(blob);
  let hint = "change";
  if (/pric/i.test(blob)) hint = "pricing";
  else if (/\bapi\b/i.test(blob)) hint = "API";
  return {
    value: `${Math.round(pct)}%`,
    hint,
    direction: down && !up ? "down" : up && !down ? "up" : undefined,
  };
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

function impactLine(kind: IntelKind, connected?: string): string | undefined {
  if (!connected) return undefined;
  const name = connected.trim();
  if (name.length < 2 || name.length > 48) return undefined;
  if (kind === "decision") return `Conflicts with ${name}.`;
  if (kind === "pattern") return `Unusually relevant to ${name}.`;
  return `Touches your ${name}.`;
}

function metricFor(args: {
  kind: IntelKind;
  title: string;
  why: string;
  previousState?: string | null;
  newState?: string | null;
  corroborating?: number;
  confidence?: number | null;
  detector?: string | null;
}): GlanceMetric | null {
  if (args.kind === "change") {
    const fromText = extractPercentDelta(
      args.previousState,
      args.newState,
      args.title,
      args.why,
    );
    if (fromText) {
      if (args.detector === "pricing_positioning") fromText.hint = "pricing";
      if (args.detector === "model_api" && fromText.hint === "change") fromText.hint = "API";
      return fromText;
    }
    return null;
  }
  if (args.kind === "pattern" && args.corroborating && args.corroborating > 1) {
    return { value: String(args.corroborating), hint: "sources" };
  }
  if (args.kind === "decision" && args.confidence != null) {
    return { value: `${Math.round(args.confidence * 100)}%`, hint: "confidence" };
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
  const connected = alert.entity_name;
  const confidence = confidenceOf(alert);
  const corroborating = alert.related_urls?.length || undefined;
  return {
    id: `alert:${alert.id}`,
    kind,
    label: kind === "change" ? "Important change" : "Emerging pattern",
    title: alert.title,
    why: why || `Update on ${alert.entity_name}.`,
    impact: impactLine(kind, connected),
    connected,
    confidence,
    digestId,
    itemId: match?.id,
    signalId: alert.signal_id || null,
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
    corroborating,
    urgent: Boolean(alert.is_urgent),
    action: alert.action && !/^none/i.test(alert.action) ? alert.action : null,
    metric: metricFor({
      kind,
      title: alert.title,
      why,
      previousState: alert.previous_state,
      newState: alert.new_state,
      corroborating,
      confidence,
      detector: alert.detector_type,
    }),
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
  const confidence = confidenceOf(item);
  const corroborating = item.duplicate_count > 1 ? item.duplicate_count : item.evidence?.length;
  const title = kind === "decision" && item.evolution_note
    ? item.headline
    : item.headline;
  return {
    id: `item:${item.id}`,
    kind,
    label: kind === "decision" ? "Reconsider?" : kind === "pattern" ? "Emerging pattern" : "Important change",
    title,
    why: why || item.headline,
    impact: impactLine(kind, connected),
    connected,
    confidence,
    digestId,
    itemId: item.id,
    signalId: item.signal_id || null,
    askHref: item.content_id
      ? askAboutContent(item.content_id, item.id, item.headline)
      : askUrl({ title: item.headline }),
    readHref: `/dashboard/read/${digestId}?item=${item.id}`,
    sourceUrl: item.source_url,
    sourceName: item.source_name,
    previousState: item.previous_state || null,
    newState: item.new_state || null,
    corroborating,
    action: item.suggested_action || null,
    metric: metricFor({
      kind,
      title: item.headline,
      why,
      previousState: item.previous_state,
      newState: item.new_state,
      corroborating,
      confidence,
      detector: item.detector_type,
    }),
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

function isEntityLit(
  ent: WatchedEntity,
  unread: WatchedAlert[],
  cards: IntelligenceObject[],
): boolean {
  if (unread.some((a) => a.entity_id === ent.id || a.entity_name === ent.name)) return true;
  const n = ent.name.trim().toLowerCase();
  if (n.length < 3) return false;
  return cards.some(
    (c) =>
      c.title.toLowerCase().includes(n) ||
      (c.connected || "").toLowerCase().includes(n),
  );
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

  const nodes: PulseNode[] = input.entities.slice(0, MAX_NODES).map((ent) => ({
    id: ent.id,
    name: ent.name,
    active: isEntityLit(ent, unread, cards),
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
