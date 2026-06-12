"use client";

import { useMemo, useState } from "react";
import {
  filterCatalog,
  MAX_TRACKED_TOPICS,
  normalizeTopic,
  ROLE_STARTER_PACKS,
  type TopicCategory,
} from "@/lib/topicCatalog";

type Props = {
  topics: string[];
  onChange: (topics: string[]) => void;
  role?: string;
  /** Topics Briefly inferred from reading — emerging or strong clusters */
  suggestedFromReading?: string[];
};

function canAdd(topics: string[], topic: string): boolean {
  const n = normalizeTopic(topic);
  return Boolean(n) && !topics.includes(n) && topics.length < MAX_TRACKED_TOPICS;
}

function addTopic(topics: string[], topic: string): string[] {
  const n = normalizeTopic(topic);
  if (!canAdd(topics, n)) return topics;
  return [...topics, n];
}

function addMany(topics: string[], incoming: string[]): string[] {
  let next = [...topics];
  for (const t of incoming) {
    if (next.length >= MAX_TRACKED_TOPICS) break;
    next = addTopic(next, t);
  }
  return next;
}

function TopicChip({
  label,
  selected,
  onClick,
  variant = "pick",
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
  variant?: "pick" | "suggested";
}) {
  return (
    <button
      type="button"
      className={`topics-pick-chip${selected ? " is-selected" : ""}${variant === "suggested" ? " topics-pick-chip--suggested" : ""}`}
      onClick={onClick}
      disabled={selected}
      aria-pressed={selected}
    >
      {selected ? "✓ " : "+ "}
      {label}
    </button>
  );
}

function CategoryBlock({
  category,
  topics,
  onAdd,
  defaultOpen = false,
}: {
  category: TopicCategory;
  topics: string[];
  onAdd: (t: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const available = category.topics.filter((t) => !topics.includes(normalizeTopic(t)));

  if (!available.length) return null;

  return (
    <div className={`topics-category${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="topics-category-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="topics-category-label">{category.label}</span>
        <span className="topics-category-hint">{category.hint}</span>
        <span className="topics-category-count">{available.length} available</span>
      </button>
      {open ? (
        <div className="topics-category-body">
          {available.map((t) => (
            <TopicChip
              key={t}
              label={t}
              selected={topics.includes(normalizeTopic(t))}
              onClick={() => onAdd(t)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TopicsToTrackEditor({
  topics,
  onChange,
  role,
  suggestedFromReading = [],
}: Props) {
  const [val, setVal] = useState("");
  const [search, setSearch] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);

  const rolePack = ROLE_STARTER_PACKS[role ?? "Other"] ?? ROLE_STARTER_PACKS.Other;

  const readingSuggestions = useMemo(() => {
    const tracked = new Set(topics.map((t) => t.toLowerCase()));
    return suggestedFromReading
      .map(normalizeTopic)
      .filter((t) => t && !tracked.has(t))
      .slice(0, 8);
  }, [suggestedFromReading, topics]);

  const roleSuggestions = useMemo(() => {
    return rolePack.topics.filter((t) => !topics.includes(normalizeTopic(t)));
  }, [rolePack.topics, topics]);

  const filteredCatalog = useMemo(() => filterCatalog(search), [search]);

  const atLimit = topics.length >= MAX_TRACKED_TOPICS;

  function add(raw: string) {
    const next = addTopic(topics, raw);
    if (next !== topics) onChange(next);
    setVal("");
  }

  function remove(t: string) {
    onChange(topics.filter((x) => x !== t));
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (val) add(val);
    }
    if (e.key === "Backspace" && !val && topics.length) remove(topics[topics.length - 1]);
  }

  return (
    <div className="topics-track-editor">
      <div className="topics-track-meta">
        <p className="topics-track-count">
          <strong>{topics.length}</strong> of {MAX_TRACKED_TOPICS} topics
        </p>
        <p className="topics-track-tip">
          Specific beats broad — &ldquo;AI agents&rdquo; works better than &ldquo;tech&rdquo;.
        </p>
      </div>

      <div className={`tag-input-wrap${atLimit ? " tag-input-wrap--limit" : ""}`}>
        {topics.map((t) => (
          <span key={t} className="tag-chip">
            {t}
            <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t}`}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            if (val) add(val);
          }}
          placeholder={topics.length === 0 ? "Type a topic or pick below…" : atLimit ? "Limit reached" : "Add another…"}
          disabled={atLimit}
          aria-label="Add a topic to track"
        />
      </div>

      {readingSuggestions.length > 0 ? (
        <section className="topics-suggest-block topics-suggest-block--reading">
          <div className="topics-suggest-head">
            <div className="topics-suggest-copy">
              <h3 className="topics-suggest-title">From your reading</h3>
              <p className="topics-suggest-desc">
                Topics Briefly sees you engaging with — add any you want in every brief.
              </p>
            </div>
          </div>
          <div className="topics-suggest-chips">
            {readingSuggestions.map((t) => (
              <TopicChip
                key={t}
                label={t}
                variant="suggested"
                onClick={() => add(t)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {roleSuggestions.length > 0 ? (
        <section className="topics-suggest-block">
          <div className="topics-suggest-head">
            <div className="topics-suggest-copy">
              <h3 className="topics-suggest-title">{rolePack.label}</h3>
            </div>
            <button
              type="button"
              className="topics-add-pack-btn"
              disabled={atLimit}
              onClick={() => onChange(addMany(topics, rolePack.topics))}
            >
              Add all
            </button>
          </div>
          <div className="topics-suggest-chips">
            {roleSuggestions.slice(0, 10).map((t) => (
              <TopicChip key={t} label={t} onClick={() => add(t)} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="topics-browse">
        <button
          type="button"
          className="topics-browse-toggle"
          onClick={() => setBrowseOpen((v) => !v)}
          aria-expanded={browseOpen}
        >
          Browse all topics
          <span className="topics-browse-chevron" aria-hidden>
            {browseOpen ? "−" : "+"}
          </span>
        </button>

        {browseOpen ? (
          <div className="topics-browse-panel">
            <input
              type="search"
              className="topics-browse-search onboard-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search topics…"
              aria-label="Search topic catalog"
            />
            <div className="topics-category-list">
              {filteredCatalog.length === 0 ? (
                <p className="topics-browse-empty">No topics match &ldquo;{search}&rdquo;</p>
              ) : (
                filteredCatalog.map((cat, i) => (
                  <CategoryBlock
                    key={cat.id}
                    category={cat}
                    topics={topics}
                    onAdd={add}
                    defaultOpen={Boolean(search.trim()) || i === 0}
                  />
                ))
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
