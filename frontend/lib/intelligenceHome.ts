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
  entityId?: string | null;
  entityName?: string | null;
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
  belief?: string | null;
  previousConfidence?: number | null;
  decisionThreadId?: string | null;
};

export type PulseNode = {
  id: string;
  name: string;
  active: boolean;
  monitoringActive: boolean;
  lastCheckedAt: string | null;
  signalCount: number;
  urgentCount: number;
  changeCount: number;
  decisionCount: number;
  latestSignal: string | null;
  cardIds: string[];
  reviewHref: string | null;
  askHref: string;
  networkHref: string;
};

export type MorningPulseModel = {
  line: string;
  changeCount: number;
  decisionCount: number;
  urgentCount: number;
  watchCount: number;
  pendingCheckCount: number;
  lastCheckedAt: string | null;
  nodes: PulseNode[];
  connectionLabel: string | null;
  cards: IntelligenceObject[];
  action: { label: string; href: string } | null;
};

const MAX_CARDS = 3;
const MAX_NODES = 6;
const NEGATIVE_SIGNAL_LABELS = new Set(["irrelevant", "duplicate", "incorrect"]);

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
  previousConfidence?: number | null;
  detector?: string | null;
}): GlanceMetric | null {
  if (args.kind === "change") {
    const prev = (args.previousState || "").trim();
    const next = (args.newState || "").trim();
    if (prev && next && prev.toLowerCase() !== next.toLowerCase()) {
      const fromPct = prev.match(/(\d+(?:\.\d+)?)\s*%/);
      const toPct = next.match(/(\d+(?:\.\d+)?)\s*%/);
      if (fromPct && toPct && fromPct[1] !== toPct[1]) {
        const from = Number(fromPct[1]);
        const to = Number(toPct[1]);
        return {
          value: `${Math.round(from)}% → ${Math.round(to)}%`,
          hint: args.detector === "model_api" ? "API" : "pricing",
          direction: to < from ? "down" : to > from ? "up" : undefined,
        };
      }
      return null;
    }
    const fromText = extractPercentDelta(args.newState);
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
  if (args.kind === "decision") {
    if (
      args.previousConfidence != null &&
      args.confidence != null &&
      args.previousConfidence !== args.confidence
    ) {
      const from = Math.round(args.previousConfidence * 100);
      const to = Math.round(args.confidence * 100);
      return {
        value: `${from}% → ${to}%`,
        hint: "belief",
        direction: to < from ? "down" : to > from ? "up" : undefined,
      };
    }
    if (args.confidence != null) {
      return { value: `${Math.round(args.confidence * 100)}%`, hint: "belief" };
    }
  }
  return null;
}

type ThreadTouch = {
  id: string | null;
  title: string | null;
  belief: string | null;
  confidence: number | null;
  previous: number | null;
  status: string | null;
  stance: string | null;
};

function threadOf(item: DigestItem | WatchedAlert): ThreadTouch {
  return {
    id: item.decision_thread_id || null,
    title: item.decision_title || null,
    belief: item.decision_belief || null,
    confidence: typeof item.decision_confidence === "number" ? item.decision_confidence : null,
    previous:
      typeof item.decision_previous_confidence === "number"
        ? item.decision_previous_confidence
        : null,
    status: item.decision_status || null,
    stance: item.decision_stance || null,
  };
}

function isDecisionTouch(item: DigestItem | WatchedAlert): boolean {
  const t = threadOf(item);
  return Boolean(t.id && (t.stance === "contradicting" || t.status === "reconsider"));
}

function threadImpact(thread: ThreadTouch): string | undefined {
  const name = (thread.title || "").trim();
  if (!name || name.length > 48) return undefined;
  if (thread.stance === "contradicting" || thread.status === "reconsider") {
    return `Conflicts with ${name}.`;
  }
  return `Touches your ${name} decision.`;
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
  const thread = threadOf(alert);
  const isDecision = isDecisionTouch(alert);
  const kind: IntelKind = isDecision
    ? "decision"
    : alert.is_material_change
      ? "change"
      : "pattern";
  const why = (alert.why_it_matters || alert.what_changed || "").trim();
  const match = itemMatchingAlert(digest, alert);
  const digestId = digest?.id ?? null;
  const connected = thread.title || alert.entity_name;
  const confidence = isDecision ? thread.confidence : confidenceOf(alert);
  const corroborating = alert.related_urls?.length || undefined;
  return {
    id: `alert:${alert.id}`,
    entityId: alert.entity_id,
    entityName: alert.entity_name,
    kind,
    label: kind === "decision" ? "Reconsider?" : kind === "change" ? "Important change" : "Emerging pattern",
    title: alert.title,
    why: why || `Update on ${alert.entity_name}.`,
    impact: threadImpact(thread) || impactLine(kind, connected),
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
    belief: thread.belief,
    previousConfidence: thread.previous,
    decisionThreadId: thread.id,
    metric: metricFor({
      kind,
      title: alert.title,
      why,
      previousState: alert.previous_state,
      newState: alert.new_state,
      corroborating,
      confidence,
      previousConfidence: thread.previous,
      detector: alert.detector_type,
    }),
  };
}

function fromItem(item: DigestItem, digestId: string): IntelligenceObject {
  const thread = threadOf(item);
  const isDecision = isDecisionTouch(item) || Boolean(item.contradiction_flag || item.evolution_note);
  const isPattern = !isDecision && (item.duplicate_count || 0) > 1;
  const kind: IntelKind = isDecision
    ? "decision"
    : isPattern
      ? "pattern"
      : item.is_material_change
        ? "change"
        : "pattern";
  const detector = detectorLabel(item.detector_type);
  const why = (item.why_it_matters || item.summary || "").trim();
  const connected =
    thread.title ||
    item.memory_reference ||
    item.memory_connections?.[0]?.description ||
    detector ||
    undefined;
  const confidence = isDecision ? thread.confidence : confidenceOf(item);
  const corroborating = item.duplicate_count > 1 ? item.duplicate_count : item.evidence?.length;
  return {
    id: `item:${item.id}`,
    kind,
    label: kind === "decision" ? "Reconsider?" : kind === "pattern" ? "Emerging pattern" : "Important change",
    title: item.headline,
    why: why || item.headline,
    impact: threadImpact(thread) || impactLine(kind, connected),
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
    belief: thread.belief,
    previousConfidence: thread.previous,
    decisionThreadId: thread.id,
    metric: metricFor({
      kind,
      title: item.headline,
      why,
      previousState: item.previous_state,
      newState: item.new_state,
      corroborating,
      confidence,
      previousConfidence: thread.previous,
      detector: item.detector_type,
    }),
  };
}

function pickCards(
  alerts: WatchedAlert[],
  digest: Digest | null,
): IntelligenceObject[] {
  const unread = alerts.filter(
    (a) => !a.is_read && !NEGATIVE_SIGNAL_LABELS.has(a.signal_label || ""),
  );
  const fromWatch = unread
    .map((a) => fromAlert(a, digest))
    .filter((card) => card.kind === "decision" || card.kind === "change" || (card.corroborating || 0) > 1)
    .sort((a, b) => cardPriority(b) - cardPriority(a));
  const items = digest?.items ?? [];
  const visibleItems = items.filter(
    (item) => !NEGATIVE_SIGNAL_LABELS.has(item.signal_label || ""),
  );
  const digestId = digest?.id;
  const threadDecisions = digestId
    ? visibleItems.filter((i) => isDecisionTouch(i)).map((i) => fromItem(i, digestId))
    : [];
  const decisions = digestId
    ? visibleItems.filter((i) => i.contradiction_flag || i.evolution_note).map((i) => fromItem(i, digestId))
    : [];
  const patterned = digestId
    ? visibleItems.filter((i) => (i.duplicate_count || 0) > 1).map((i) => fromItem(i, digestId))
    : [];
  const rest = digestId
    ? visibleItems
        .filter(
          (i) => isDecisionTouch(i)
            || Boolean(i.contradiction_flag || i.evolution_note)
            || Boolean(i.is_material_change)
            || (i.duplicate_count || 0) > 1,
        )
        .map((i) => fromItem(i, digestId))
        .sort((a, b) => cardPriority(b) - cardPriority(a))
    : [];

  const picked: IntelligenceObject[] = [];
  const seen = new Set<string>();
  const take = (obj: IntelligenceObject | undefined) => {
    if (!obj || picked.length >= MAX_CARDS) return;
    const key = obj.signalId ? `signal:${obj.signalId}` : `title:${obj.title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    picked.push(obj);
  };

  take(fromWatch.find((c) => c.kind === "change") || fromWatch[0]);
  take(threadDecisions[0] || decisions[0]);
  take(patterned.find((c) => !seen.has(c.signalId ? `signal:${c.signalId}` : `title:${c.title.toLowerCase()}`)) || fromWatch.find((c) => c.kind !== "change"));
  for (const obj of [...fromWatch, ...rest]) take(obj);
  return picked;
}

function cardPriority(card: IntelligenceObject): number {
  return (card.kind === "decision" ? 100 : card.kind === "change" ? 60 : 30)
    + (card.urgent ? 30 : 0)
    + Math.round((card.confidence || 0) * 10)
    + Math.min(card.corroborating || 0, 5);
}

function uniqueCount<T>(rows: T[], keyOf: (row: T) => string): number {
  return new Set(rows.map(keyOf).filter(Boolean)).size;
}

function isEntityLit(
  ent: WatchedEntity,
  unread: WatchedAlert[],
  cards: IntelligenceObject[],
): boolean {
  if (unread.some((a) => alertMatchesEntity(a, ent))) return true;
  return cards.some((card) => cardMatchesEntity(card, ent));
}

function alertMatchesEntity(alert: WatchedAlert, ent: WatchedEntity): boolean {
  return alert.entity_id === ent.id
    || alert.entity_name.trim().toLowerCase() === ent.name.trim().toLowerCase();
}

function cardMatchesEntity(card: IntelligenceObject, ent: WatchedEntity): boolean {
  if (card.entityId) return card.entityId === ent.id;
  if (card.entityName?.trim().toLowerCase() === ent.name.trim().toLowerCase()) return true;
  const n = ent.name.trim().toLowerCase();
  if (n.length < 3) return false;
  return card.title.toLowerCase().includes(n)
    || (card.connected || "").toLowerCase().includes(n);
}

function alertTimestamp(alert: WatchedAlert): number {
  const value = alert.created_at || alert.published_at;
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildMorningPulse(input: {
  digest: Digest | null;
  alerts: WatchedAlert[];
  entities: WatchedEntity[];
  generating: boolean;
}): MorningPulseModel {
  const cards = pickCards(input.alerts, input.digest);
  const unread = input.alerts.filter(
    (a) => !a.is_read && !NEGATIVE_SIGNAL_LABELS.has(a.signal_label || ""),
  );
  const materialAlerts = unread.filter((a) => a.is_material_change && !isDecisionTouch(a));
  const materialItems = (input.digest?.items ?? []).filter(
    (i) => i.is_material_change
      && !isDecisionTouch(i)
      && !NEGATIVE_SIGNAL_LABELS.has(i.signal_label || ""),
  );
  const changeCount = uniqueCount(
    [...materialAlerts, ...materialItems],
    (row) => row.signal_id || `title:${("title" in row ? row.title : row.headline).toLowerCase()}`,
  );
  const decisionRows = [
    ...(input.digest?.items ?? []).filter(
      (i) => !NEGATIVE_SIGNAL_LABELS.has(i.signal_label || "")
        && (isDecisionTouch(i) || i.contradiction_flag || i.evolution_note),
    ),
    ...unread.filter((a) => isDecisionTouch(a)),
  ];
  const decisionCount = uniqueCount(
    decisionRows,
    (row) => row.decision_thread_id || row.signal_id || `decision:${"title" in row ? row.title : row.headline}`,
  ) || uniqueCount(cards.filter((card) => card.kind === "decision"), (card) => card.id);
  const urgentCount = unread.filter((a) => a.is_urgent).length;

  const monitoringEntities = input.entities.filter((entity) => entity.is_active !== false);
  const rankedEntities = [...monitoringEntities].sort((a, b) => {
    const score = (ent: WatchedEntity) => unread.reduce((total, alert) => {
      if (!alertMatchesEntity(alert, ent)) return total;
      return total
        + 1
        + (alert.is_urgent ? 4 : 0)
        + (alert.is_material_change ? 2 : 0)
        + (isDecisionTouch(alert) ? 3 : 0);
    }, 0);
    return score(b) - score(a);
  });
  const nodes: PulseNode[] = rankedEntities.slice(0, MAX_NODES).map((ent) => {
    const entityAlerts = unread
      .filter((alert) => alertMatchesEntity(alert, ent))
      .sort((a, b) => alertTimestamp(b) - alertTimestamp(a));
    const relatedCards = cards.filter((card) => cardMatchesEntity(card, ent));
    const latestAlert = entityAlerts[0];
    const latestCard = relatedCards[0];

    return {
      id: ent.id,
      name: ent.name,
      active: isEntityLit(ent, unread, cards),
      monitoringActive: ent.is_active !== false,
      lastCheckedAt: ent.last_checked || null,
      signalCount: entityAlerts.length,
      urgentCount: entityAlerts.filter((alert) => alert.is_urgent).length,
      changeCount: entityAlerts.filter(
        (alert) => alert.is_material_change && !isDecisionTouch(alert),
      ).length,
      decisionCount: entityAlerts.filter((alert) => isDecisionTouch(alert)).length,
      latestSignal: latestAlert
        ? (latestAlert.why_it_matters
          || latestAlert.what_changed
          || latestAlert.summary
          || latestAlert.title).trim()
        : latestCard?.why || null,
      cardIds: relatedCards.map((card) => card.id),
      reviewHref: relatedCards.find((card) => card.readHref)?.readHref || null,
      askHref: latestCard?.askHref || askUrl({ title: ent.name }),
      networkHref: `/graph?node=${encodeURIComponent(ent.id)}`,
    };
  });

  let line = "Nothing needs you yet.";
  if (input.generating) line = "Briefly is reading your world.";
  else if (urgentCount > 0) line = "Something urgent landed.";
  else if (changeCount > 0 || cards.length > 0) line = "Your world moved a little today.";

  const firstAction = cards.find((c) => c.action)?.action;
  const actionHref = cards.find((c) => c.readHref)?.readHref
    || (input.digest?.id ? `/dashboard/read/${input.digest.id}` : null);

  const connected = cards[0]?.connected ?? null;
  const lastCheckedAt = monitoringEntities.reduce<string | null>((latest, entity) => {
    if (!entity.last_checked) return latest;
    if (!latest) return entity.last_checked;
    return Date.parse(entity.last_checked) > Date.parse(latest) ? entity.last_checked : latest;
  }, null);
  const pendingCheckCount = monitoringEntities.filter((entity) => !entity.last_checked).length;

  return {
    line,
    changeCount,
    decisionCount,
    urgentCount,
    watchCount: monitoringEntities.length,
    pendingCheckCount,
    lastCheckedAt,
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
