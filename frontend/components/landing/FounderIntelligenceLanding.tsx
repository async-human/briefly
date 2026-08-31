"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

const sources = [
  "Newsletters",
  "Product launches",
  "Show HN",
  "Research",
  "Competitors",
  "Founder feeds",
] as const;

const briefPoints = [
  ["What changed", "A model vendor cut agent inference pricing and opened a new batch tier."],
  ["Why it matters", "The economics of your autonomous workflow just moved in your favour."],
  ["Who it affects", "AI-native SaaS teams with long-running research and support agents."],
  ["Past context", "This reverses the margin pressure flagged in your August 12 briefing."],
  ["Suggested action", "Re-run the unit model before the next investor update."],
  ["Source trail", "Primary announcement, pricing docs, and two independent analyses."],
] as const;

const memoryEvents = [
  { date: "Jun 18", title: "First signal", body: "A competitor begins hiring for agent infrastructure." },
  { date: "Jul 09", title: "The thread strengthens", body: "Its changelog quietly adds long-running tasks." },
  { date: "Today", title: "Briefly connects it", body: "A pricing launch now changes the likely go-to-market move." },
] as const;

const actions = [
  ["Track this company", "Keep future moves attached to the same strategic thread.", "Persistent watchlist"],
  ["Save to market memory", "Make the signal available to every future brief and answer.", "Compound context"],
  ["Create an idea note", "Move the implication into your working system, with its sources intact.", "Notion / Markdown"],
] as const;

const layers = [
  ["Curation", "A high-signal founder brief", "Selected sources become one decision-ready, cited intelligence pack every morning.", "Earned by usefulness"],
  ["Memory", "Context that compounds", "Companies, people, ideas and past decisions form a market memory that gets harder to replace.", "Earned by retention"],
  ["Ambient", "Intelligence in your flow", "Voice and proactive delivery meet founders in the commute, inbox and moments that cannot wait.", "Earned by habit"],
  ["Team", "A shared market brain", "Only after the solo loop works: shared watchlists, team briefs and an intelligence API.", "Earned by demand"],
] as const;

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Diamond({ hidden = true }: { hidden?: boolean }) {
  return <span className="deco-diamond" aria-hidden={hidden} />;
}

function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`deco-reveal ${className}`} data-visible={visible ? "true" : "false"}>
      {children}
    </div>
  );
}

export function FounderIntelligenceLanding() {
  const year = new Date().getFullYear();

  return (
    <div className="deco">
      <header className="deco-nav">
        <div className="deco-nav__inner">
          <nav className="deco-nav__links" aria-label="Page sections">
            <a href="#method">Method</a>
            <a href="#memory">Memory</a>
          </nav>
          <a className="deco-brand" href="#top" aria-label="Briefly home">
            <Diamond />
            <span>Briefly</span>
            <Diamond />
          </a>
          <div className="deco-nav__actions">
            <ThemeToggle compact />
            <a className="deco-button deco-nav__cta" href="/login">
              Founding access
              <ArrowIcon />
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="deco-hero deco-shell" aria-labelledby="deco-hero-title">
          <div className="deco-hero__ornament mi-enter" style={{ "--i": 0 } as CSSProperties} aria-hidden>
            <span />
            <Diamond />
            <span />
          </div>
          <div className="deco-hero__copy">
            <p className="deco-hero__issue mi-enter" style={{ "--i": 1 } as CSSProperties}>
              Founder intelligence · delivered at 08:00
            </p>
            <h1 id="deco-hero-title" className="mi-enter" style={{ "--i": 2 } as CSSProperties}>
              The market, distilled <span>before morning.</span>
            </h1>
            <p className="deco-hero__lede mi-enter" style={{ "--i": 3 } as CSSProperties}>
              One personal intelligence brief for AI founders and solo builders—curated from the sources that move your market, connected to what came before, and shaped into the next decision.
            </p>
            <div className="deco-hero__actions mi-enter" style={{ "--i": 4 } as CSSProperties}>
              <a className="deco-button deco-button--large" href="/login">
                Build my founder brief
                <ArrowIcon />
              </a>
              <a className="deco-link" href="#method">
                Discover the method
                <ArrowIcon />
              </a>
            </div>
          </div>

          <div className="deco-hero__brief mi-enter" style={{ "--i": 5 } as CSSProperties}>
            <div className="deco-frame">
              <figure className="deco-brief" aria-label="Example founder intelligence brief">
                <figcaption>
                  <span>Morning brief</span>
                  <time>08:00</time>
                </figcaption>
                <div className="deco-rule" aria-hidden><Diamond /></div>
                <p className="deco-brief__category">Infrastructure · developing story</p>
                <h2>The cost curve for autonomous agents just shifted.</h2>
                <p className="deco-brief__summary">
                  Three announcements point to a cheaper, longer-running agent stack—and a narrower window for teams still pricing against last quarter.
                </p>
                <div className="deco-brief__move">
                  <span>Suggested move</span>
                  <strong>Revisit your usage assumptions before Thursday.</strong>
                </div>
              </figure>
            </div>
            <p className="deco-caption">Illustrative brief, shaped by the market and questions you track.</p>
          </div>
        </section>

        <section className="deco-sources" aria-label="Intelligence sources">
          <div className="deco-shell deco-sources__inner">
            <p>Many signals enter. One clear brief leaves.</p>
            <ul>
              {sources.map((source) => <li key={source}>{source}</li>)}
            </ul>
          </div>
        </section>

        <section className="deco-method deco-shell" id="method" aria-labelledby="deco-method-title">
          <Reveal className="deco-method__intro">
            <h2 id="deco-method-title">From market noise to a decision worth making.</h2>
            <p>Briefly does not stop at what happened. It carries every meaningful signal through consequence, context, and action.</p>
          </Reveal>
          <Reveal className="deco-method__points">
            <ol>
              {briefPoints.map(([title, body], index) => (
                <li key={title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        <section className="deco-memory" id="memory" aria-labelledby="deco-memory-title">
          <div className="deco-shell deco-memory__inner">
            <Reveal className="deco-memory__copy">
              <h2 id="deco-memory-title">Today’s signal remembers yesterday.</h2>
              <p>Briefly builds a living map of companies, people, and ideas—then brings the right history forward when a development changes the story.</p>
              <a className="deco-link deco-link--light" href="/login">
                Ask your market memory
                <ArrowIcon />
              </a>
            </Reveal>
            <Reveal className="deco-thread">
              {memoryEvents.map((event) => (
                <article key={event.date}>
                  <time>{event.date}</time>
                  <div>
                    <h3>{event.title}</h3>
                    <p>{event.body}</p>
                  </div>
                </article>
              ))}
              <blockquote>
                “This is not an isolated launch. It completes a three-month strategic shift.”
              </blockquote>
            </Reveal>
          </div>
        </section>

        <section className="deco-actions deco-shell" id="actions" aria-labelledby="deco-actions-title">
          <Reveal className="deco-actions__head">
            <h2 id="deco-actions-title">Reading becomes an operating loop.</h2>
          </Reveal>
          <div className="deco-actions__grid">
            {actions.map(([title, body, meta], index) => (
              <Reveal className={`deco-action deco-action--${index + 1}`} key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{body}</p>
                <small>{meta}</small>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="deco-direction deco-shell" id="direction" aria-labelledby="deco-direction-title">
          <Reveal className="deco-direction__head">
            <h2 id="deco-direction-title">A market intelligence layer, earned one habit at a time.</h2>
            <p>Each layer ships only when the one before it proves that founders would miss it.</p>
          </Reveal>
          <ol className="deco-layers">
            {layers.map(([name, promise, detail, gate], index) => (
              <li key={name}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{name}</small>
                  <h3>{promise}</h3>
                  <p>{detail}</p>
                </div>
                <em>{gate}</em>
              </li>
            ))}
          </ol>
        </section>

        <section className="deco-close" aria-labelledby="deco-close-title">
          <div className="deco-shell deco-close__inner">
            <div className="deco-close__ornament" aria-hidden>
              <span />
              <Diamond />
              <span />
            </div>
            <Reveal>
              <h2 id="deco-close-title">Begin with the brief you would actually miss.</h2>
              <p>Bring the market, companies, and questions you track. Briefly turns them into one morning intelligence ritual—and gets sharper as your context compounds.</p>
              <a className="deco-button deco-button--large" href="/login">
                Build my first brief
                <ArrowIcon />
              </a>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="deco-footer">
        <div className="deco-shell">
          <div className="deco-footer__rule" aria-hidden><Diamond /></div>
          <div className="deco-footer__main">
            <div className="deco-footer__brand">
              <p className="deco-footer__wordmark">Briefly</p>
              <p>Stop carrying the market in your head.</p>
              <small>Personal, cited intelligence for AI founders.</small>
            </div>
            <nav className="deco-footer__nav" aria-label="Footer navigation">
              <div>
                <p>Explore</p>
                <a href="#method">Method</a>
                <a href="#memory">Memory</a>
                <a href="#actions">Actions</a>
              </div>
              <div>
                <p>Access</p>
                <a href="/login">Founding access</a>
                <a href="/login">Sign in</a>
              </div>
              <div>
                <p>Legal</p>
                <a href="/privacy">Privacy</a>
                <a href="/terms">Terms</a>
              </div>
            </nav>
          </div>
          <div className="deco-footer__bottom">
            <span>© {year} Briefly</span>
            <span>Intelligence for AI founders</span>
            <a href="#top">Back to top ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
