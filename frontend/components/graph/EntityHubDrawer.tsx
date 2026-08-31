"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type EntityHub } from "@/lib/api";
import { askAboutContent } from "@/lib/askLinks";
import { graphUrl } from "@/lib/graphLinks";
import { useLearnedToast } from "@/components/dashboard/LearnedToast";
import { useGraphHub } from "./GraphHubContext";

const KIND_LABEL: Record<string, string> = {
  company: "Company",
  person: "Person",
  product: "Product",
  topic: "Topic",
  thread: "Story thread",
  source: "Source",
  item: "Article",
  thought: "Your note",
  entity: "Watched",
};

function kindLabel(kind: string, type: string): string {
  return KIND_LABEL[kind] || KIND_LABEL[type] || type;
}

export function EntityHubDrawer() {
  const { target, closeHub, openHub, refreshWatched } = useGraphHub();
  const { showLearned } = useLearnedToast();
  const pathname = usePathname();
  const router = useRouter();
  const [hub, setHub] = useState<EntityHub | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const trackKind =
    hub?.type === "entity" || hub?.kind === "company" || hub?.kind === "person" || hub?.kind === "product"
      ? hub.kind === "person"
        ? "person"
        : hub.kind === "product"
          ? "product"
          : "company"
      : "topic";

  useEffect(() => {
    if (!target) {
      setHub(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .getEntityHub({ nodeId: target.nodeId, q: target.query })
      .then((data) => {
        if (!cancelled) setHub(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setHub(null);
          setError(err instanceof Error ? err.message : "Could not load this profile.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target?.nodeId, target?.query]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHub();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [target, closeHub]);

  if (!target) return null;

  const onGraphPage = pathname === "/graph";

  async function trackEntity() {
    if (!hub || hub.watching || tracking) return;
    setTracking(true);
    try {
      const created = await api.addWatchedEntity({ name: hub.name, kind: trackKind });
      refreshWatched();
      showLearned(`Tracking ${created.name}.`);
      setHub({ ...hub, watching: true, watched_id: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start tracking.");
    } finally {
      setTracking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="kg-sheet-backdrop"
        aria-label="Close profile"
        onClick={closeHub}
      />
      <aside className="kg-inspector-drawer hub-drawer is-open" aria-live="polite">
        <div className="kg-sheet-handle" aria-hidden />
        <div className="kg-inspector-head">
          <span className="kg-inspector-badge hub-kind">
            {hub ? kindLabel(hub.kind, hub.type) : "Profile"}
          </span>
          <button type="button" className="kg-inspector-close" onClick={closeHub} aria-label="Close">
            ×
          </button>
        </div>

        {loading ? (
          <p className="hub-status">Building this profile…</p>
        ) : error && !hub ? (
          <p className="hub-status hub-status-error">{error}</p>
        ) : hub ? (
          <>
            <h3 className="kg-inspector-title">{hub.name}</h3>
            {hub.summary ? <p className="hub-summary">{hub.summary}</p> : null}

            {hub.timeline.length > 0 ? (
              <section className="hub-section">
                <h4 className="hub-section-title">Timeline</h4>
                <ol className="hub-timeline">
                  {hub.timeline.map((entry, i) => (
                    <li key={`${entry.title}-${i}`}>
                      {entry.node_id ? (
                        <button
                          type="button"
                          className="hub-timeline-hit"
                          onClick={() => openHub({ nodeId: entry.node_id! })}
                        >
                          <span className="hub-when">{entry.when}</span>
                          <span className="hub-timeline-title">{entry.title}</span>
                          {entry.linked.length > 0 ? (
                            <span className="hub-linked">Linked to: {entry.linked.join(", ")}</span>
                          ) : null}
                        </button>
                      ) : (
                        <div className="hub-timeline-hit">
                          <span className="hub-when">{entry.when}</span>
                          <span className="hub-timeline-title">{entry.title}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {hub.connected.length > 0 ? (
              <section className="hub-section">
                <h4 className="hub-section-title">Connected</h4>
                <div className="hub-chips">
                  {hub.connected.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      className="hub-chip"
                      title={chip.edge_label || chip.type}
                      onClick={() => openHub({ nodeId: chip.id })}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {hub.memory.length > 0 ? (
              <section className="hub-section">
                <h4 className="hub-section-title">Your memory</h4>
                <ul className="hub-memory">
                  {hub.memory.map((note, i) => (
                    <li key={`${note.text}-${i}`}>
                      <p className="hub-memory-text">{note.text}</p>
                      <span className="hub-memory-meta">{note.saved_at}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="hub-actions">
              {!hub.watching ? (
                <button
                  type="button"
                  className="kg-action-btn kg-action-btn-primary"
                  onClick={() => void trackEntity()}
                  disabled={tracking}
                >
                  {tracking ? "Tracking…" : `Track ${hub.name}`}
                </button>
              ) : (
                <p className="hub-watching">Watching</p>
              )}
              {(hub.type === "item" || hub.type === "thought") && hub.id.includes(":") ? (
                <Link
                  href={askAboutContent(hub.id.replace(/^(item|thought):/, ""), undefined, hub.name)}
                  className="dash-btn dash-btn-secondary kg-inspector-link"
                  onClick={closeHub}
                >
                  Ask about this
                </Link>
              ) : null}
              {hub.meta.url ? (
                <a
                  href={String(hub.meta.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dash-btn dash-btn-secondary kg-inspector-link"
                >
                  Open article
                </a>
              ) : null}
              {!onGraphPage ? (
                <button
                  type="button"
                  className="kg-action-btn"
                  onClick={() => {
                    closeHub();
                    router.push(graphUrl(hub.id));
                  }}
                >
                  Open in Network
                </button>
              ) : null}
            </div>
            {error ? <p className="hub-status hub-status-error">{error}</p> : null}
          </>
        ) : null}
      </aside>
    </>
  );
}
