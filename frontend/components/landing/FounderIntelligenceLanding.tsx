"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ThemeToggle } from "./ThemeToggle";

type Panel = {
  title: string;
  body: string;
  meta?: string;
  quote?: boolean;
};

type Stage = {
  id: string;
  verb: string;
  deck: string;
  linkLabel: string;
  panels: Panel[];
};

const sources = [
  "Newsletters",
  "Product launches",
  "Show HN",
  "Research",
  "Competitors",
  "Founder feeds",
] as const;

const briefPoints = [
  "What changed",
  "Why it matters",
  "Who it affects",
  "Past context",
  "Suggested action",
  "Source trail",
] as const;

const stages: Stage[] = [
  {
    id: "brief",
    verb: "Decide",
    deck: "Not another summary. Every important signal is carried through context, consequence and a concrete next move — six points, in the same order, every morning.",
    linkLabel: "See a full brief",
    panels: [
      {
        title: "What changed",
        body: "A model vendor cut agent inference pricing and opened a new batch tier.",
      },
      {
        title: "Why it matters",
        body: "The economics of your autonomous workflow just moved in your favour.",
      },
      {
        title: "Who it affects",
        body: "AI-native SaaS teams with long-running research and support agents.",
      },
      {
        title: "Past context",
        body: "This reverses the margin pressure flagged in your August 12 briefing.",
      },
      {
        title: "Suggested action",
        body: "Re-run the unit model before the next investor update.",
      },
      {
        title: "Source trail",
        body: "The primary announcement, the pricing docs and two independent analyses — each one cited.",
      },
    ],
  },
  {
    id: "memory",
    verb: "Remember",
    deck: "Today's signal is only useful if it remembers yesterday. Briefly keeps a living map of companies, people and ideas, then brings the right history forward when a development changes the story.",
    linkLabel: "Ask your market memory",
    panels: [
      {
        title: "First signal",
        meta: "Jun 18",
        body: "A competitor begins hiring for agent infrastructure.",
      },
      {
        title: "The thread strengthens",
        meta: "Jul 09",
        body: "Its changelog quietly adds long-running tasks.",
      },
      {
        title: "Briefly connects it",
        meta: "Today",
        body: "A pricing launch now changes the likely go-to-market move.",
      },
      {
        title: "Compound context",
        meta: "What you read",
        body: "“This is not an isolated launch. It completes a three-month strategic shift.”",
        quote: true,
      },
    ],
  },
  {
    id: "actions",
    verb: "Act",
    deck: "Write-back turns reading into a durable operating loop, without asking you to maintain another knowledge system.",
    linkLabel: "Start the loop",
    panels: [
      {
        title: "Track this company",
        meta: "Persistent watchlist",
        body: "Keep future moves attached to the same strategic thread.",
      },
      {
        title: "Save to market memory",
        meta: "Compound context",
        body: "Make the signal available to every future brief and every future answer.",
      },
      {
        title: "Create an idea note",
        meta: "Notion / Markdown",
        body: "Move the implication into your working system, with its sources intact.",
      },
    ],
  },
];

const layers = [
  {
    num: "01",
    name: "Curation",
    promise: "A high-signal founder brief",
    detail:
      "Selected sources become one decision-ready, cited intelligence pack every morning.",
    gate: "Earned by usefulness",
  },
  {
    num: "02",
    name: "Memory",
    promise: "Context that compounds",
    detail:
      "Companies, people, ideas and past decisions form a market memory that gets harder to replace.",
    gate: "Earned by retention",
  },
  {
    num: "03",
    name: "Ambient",
    promise: "Intelligence in your flow",
    detail:
      "Voice and proactive delivery meet founders in the commute, the inbox and the moments that cannot wait.",
    gate: "Earned by habit",
  },
  {
    num: "04",
    name: "Team",
    promise: "A shared market brain",
    detail:
      "Only after the solo loop works: shared watchlists, team briefs and an intelligence API.",
    gate: "Earned by demand",
  },
];

function ArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

// Motion primitive 1 — the nav bar cross-fades into a floating pill past 80px.
// Passive listener + rAF throttle + a boolean-flip guard so the class toggles
// once per state change rather than once per scroll event.
function useNavMorph() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;

    let floating = false;
    let ticking = false;

    const update = () => {
      const next = window.scrollY > 80;
      if (next === floating) return;
      floating = next;
      nav.classList.toggle("is-floating", floating);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return ref;
}

// Motion primitive 3 — the sticky pane reports which panel the reader is on.
// A narrow horizontal band across the viewport middle keeps exactly one panel
// active at a time.
function useActivePanel<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;

    const panels = Array.from(
      list.querySelectorAll<HTMLElement>("[data-panel]"),
    );
    if (!panels.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.panel);
          if (Number.isFinite(index)) setActive(index);
        }
      },
      { rootMargin: "-48% 0px -48% 0px", threshold: 0 },
    );

    panels.forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, []);

  return { ref, active };
}

function LoopStage({ stage }: { stage: Stage }) {
  const { ref, active } = useActivePanel<HTMLOListElement>();
  const total = stage.panels.length;

  return (
    <article className="mi-stage mi-shell" id={stage.id}>
      <div className="mi-stage__pane">
        <h2 className="mi-stage__verb">{stage.verb}</h2>
        <p className="mi-stage__deck">{stage.deck}</p>
        <a className="mi-textlink" href="/login">
          <span>{stage.linkLabel}</span>
          <ArrowIcon />
        </a>
        <div className="mi-meter" aria-hidden>
          <span className="mi-meter__count">
            {String(active + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <span className="mi-meter__rail">
            {stage.panels.map((panel, index) => (
              <i key={panel.title} data-on={index <= active ? "" : undefined} />
            ))}
          </span>
        </div>
      </div>

      <ol className="mi-panels" ref={ref}>
        {stage.panels.map((panel, index) => (
          <li
            key={panel.title}
            className={panel.quote ? "mi-panel mi-panel--quote" : "mi-panel"}
            data-panel={index}
            data-active={index === active ? "true" : "false"}
          >
            <span className="mi-panel__index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h3>{panel.title}</h3>
              <p>{panel.body}</p>
            </div>
            {panel.meta ? (
              <span className="mi-panel__meta">{panel.meta}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </article>
  );
}

export function FounderIntelligenceLanding() {
  const year = new Date().getFullYear();
  const navRef = useNavMorph();

  return (
    <div className="mi">
      <header className="mi-nav" ref={navRef}>
        <div className="mi-nav__inner">
          <a className="mi-wordmark" href="#top" aria-label="Briefly home">
            <span className="mi-wordmark__mark" aria-hidden>
              B
            </span>
            <span className="mi-wordmark__name">Briefly</span>
          </a>
          <nav className="mi-nav__rail" aria-label="Page sections">
            <a href="#loop">The loop</a>
            <a href="#direction">Direction</a>
          </nav>
          <div className="mi-nav__actions">
            <ThemeToggle compact />
            <a className="mi-btn mi-nav__cta" href="/login">
              Founding access
              <ArrowIcon />
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="mi-hero mi-shell" aria-labelledby="mi-hero-title">
          <div className="mi-hero__copy">
            <h1
              id="mi-hero-title"
              className="mi-enter"
              style={{ "--i": 0 } as CSSProperties}
            >
              Your market moved overnight.
            </h1>
            <p
              className="mi-hero__lede mi-enter"
              style={{ "--i": 1 } as CSSProperties}
            >
              <strong>Briefly already read it.</strong> One personal
              intelligence brief for AI founders and solo builders — curated
              from the sources that move your market, connected to what came
              before, and shaped into your next decision.
            </p>
            <div
              className="mi-hero__actions mi-enter"
              style={{ "--i": 2 } as CSSProperties}
            >
              <a className="mi-btn mi-btn--lg" href="/login">
                Build my founder brief
                <ArrowIcon />
              </a>
              <a className="mi-textlink" href="#loop">
                <span>See the loop</span>
                <ArrowIcon />
              </a>
            </div>
            <p
              className="mi-hero__note mi-enter"
              style={{ "--i": 3 } as CSSProperties}
            >
              Built for a small founding cohort. Signal first; features second.
            </p>
          </div>

          <div
            className="mi-hero__aside mi-enter"
            style={{ "--i": 4 } as CSSProperties}
          >
            <figure
              className="mi-card"
              aria-label="Example six-point founder intelligence brief"
            >
              <figcaption className="mi-card__head">
                <span>Example brief / 08:00</span>
                <span className="mi-card__live">
                  <i aria-hidden /> Signals resolved
                </span>
              </figcaption>
              <p className="mi-card__kicker">
                Infrastructure · developing story
              </p>
              <h2>The cost curve for autonomous agents just shifted.</h2>
              <p className="mi-card__body">
                Three announcements point to a cheaper, longer-running agent
                stack — and a narrower window for teams still pricing against
                last quarter.
              </p>
              <ul className="mi-card__points">
                {briefPoints.map((point) => (
                  <li key={point}>
                    <CheckIcon />
                    {point}
                  </li>
                ))}
              </ul>
              <div className="mi-card__action">
                <span>Suggested move</span>
                <strong>Revisit your usage assumptions before Thursday.</strong>
              </div>
            </figure>
            <p className="mi-hero__caption">
              Illustrative brief. Yours is built from the market, companies and
              questions you actually track.
            </p>
          </div>
        </section>

        <section className="mi-sources" id="method" aria-label="Sources">
          <div className="mi-sources__inner mi-shell">
            <p className="mi-sources__lead">
              Six classes of source in. One brief out, at 08:00.
            </p>
            <ul className="mi-sources__list">
              {sources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </div>
        </section>

        <div id="loop">
          <div className="mi-loop__head mi-shell">
            <h2>Decide, remember, act — one loop every morning.</h2>
            <p>
              Briefly deduplicates and scores what happened, holds it against
              everything it already knows about your market, and hands you
              somewhere to put the answer.
            </p>
          </div>

          {stages.map((stage) => (
            <LoopStage key={stage.id} stage={stage} />
          ))}
        </div>

        <section
          className="mi-direction mi-shell"
          id="direction"
          aria-labelledby="mi-direction-title"
        >
          <div className="mi-direction__head">
            <h2 id="mi-direction-title">
              A market intelligence layer, earned one habit at a time.
            </h2>
            <p>
              Briefly is not racing to become a generic assistant. Each layer
              ships only when the one before it proves that founders would miss
              it.
            </p>
          </div>
          <ol className="mi-layers">
            {layers.map((layer) => (
              <li key={layer.num}>
                <span className="mi-layers__num">{layer.num}</span>
                <div className="mi-layers__name">
                  <h3>{layer.promise}</h3>
                  <span>{layer.name}</span>
                </div>
                <p className="mi-layers__detail">{layer.detail}</p>
                <span className="mi-layers__gate">{layer.gate}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mi-close" aria-labelledby="mi-close-title">
          <div className="mi-shell">
            <div className="mi-close__inner">
              <h2 id="mi-close-title">
                Start with the brief you would actually miss.
              </h2>
              <p>
                Bring the market, companies and questions you track. Briefly
                turns them into one morning intelligence loop — and gets sharper
                as your context compounds.
              </p>
              <a className="mi-btn mi-btn--lg" href="/login">
                Build my first brief
                <ArrowIcon />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="mi-foot">
        <div className="mi-foot__main mi-shell">
          <div className="mi-foot__brand">
            <a className="mi-foot__wordmark" href="#top" aria-label="Briefly home">
              <span className="mi-wordmark__mark" aria-hidden>
                B
              </span>
              <span>Briefly</span>
            </a>
            <p className="mi-foot__tagline">
              Stop carrying the market in your head.
            </p>
            <p className="mi-foot__description">
              Personal, cited market intelligence for AI founders and solo
              builders.
            </p>
          </div>

          <nav className="mi-foot__nav" aria-label="Footer navigation">
            <div className="mi-foot__group">
              <p>Explore</p>
              <a href="#loop">The intelligence loop</a>
              <a href="#brief">Decision briefs</a>
              <a href="#memory">Market memory</a>
              <a href="#direction">Product direction</a>
            </div>
            <div className="mi-foot__group">
              <p>Access</p>
              <a href="/login">Founding access</a>
              <a href="/login">Sign in</a>
            </div>
            <div className="mi-foot__group">
              <p>Legal</p>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
            </div>
          </nav>
        </div>

        <div className="mi-foot__bottom mi-shell">
          <p>© {year} Briefly</p>
          <p>Intelligence for AI founders</p>
          <a href="#top">
            Back to top
            <span aria-hidden>↑</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
