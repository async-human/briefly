import { ThemeToggle } from "./ThemeToggle";

const briefPoints = [
  ["What changed", "A model vendor cut agent inference pricing and opened a new batch tier."],
  ["Why it matters", "The economics of your autonomous workflow just moved in your favour."],
  ["Who it affects", "AI-native SaaS teams with long-running research and support agents."],
  ["Past context", "This reverses the margin pressure flagged in your August 12 briefing."],
  ["Suggested action", "Re-run the unit model before the next investor update."],
  ["Source trail", "Primary announcement · pricing docs · two independent analyses"],
] as const;

const memoryEvents = [
  { date: "Jun 18", title: "First signal", body: "A competitor begins hiring for agent infrastructure." },
  { date: "Jul 09", title: "The thread strengthens", body: "Its changelog quietly adds long-running tasks." },
  { date: "Today", title: "Briefly connects it", body: "A pricing launch now changes the likely go-to-market move." },
] as const;

const direction = [
  { layer: "01", name: "Curation", promise: "A high-signal founder brief", detail: "Selected sources become one decision-ready, cited intelligence pack every morning.", gate: "Earned by usefulness" },
  { layer: "02", name: "Memory", promise: "Context that compounds", detail: "Companies, people, ideas and past decisions form a market memory that gets harder to replace.", gate: "Earned by retention" },
  { layer: "03", name: "Ambient", promise: "Intelligence in your flow", detail: "Voice and proactive delivery meet founders in the commute, inbox and moments that cannot wait.", gate: "Earned by habit" },
  { layer: "04", name: "Team", promise: "A shared market brain", detail: "Only after the solo loop works: shared watchlists, team briefs and an intelligence API.", gate: "Earned by demand" },
] as const;

function ArrowIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10 3.3 3.3L15.5 6" /></svg>;
}

export function FounderIntelligenceLanding() {
  const year = new Date().getFullYear();

  return (
    <div className="mi-page">
      <header className="mi-nav">
        <a className="mi-brand" href="#top" aria-label="Briefly home">
          <span className="mi-brand-mark" aria-hidden="true">B</span>
          <span className="mi-brand-name">Briefly</span>
          <span className="mi-brand-descriptor">Intelligence for AI founders</span>
        </a>
        <div className="mi-nav-actions">
          <ThemeToggle compact />
          <a className="mi-link-button mi-link-button--small" href="/login">Founding access <ArrowIcon /></a>
        </div>
      </header>

      <main id="top">
        <section className="mi-hero" aria-labelledby="mi-hero-title">
          <div className="mi-hero-copy">
            <p className="mi-overline">AI market intelligence, before the day starts</p>
            <h1 id="mi-hero-title">Your market moved overnight. Briefly already read it.</h1>
            <p className="mi-hero-lede">One personal intelligence brief for AI founders and solo builders—curated from the sources that move your market, connected to what came before, and shaped into the next decision.</p>
            <div className="mi-hero-actions">
              <a className="mi-link-button" href="/login">Build my founder brief <ArrowIcon /></a>
              <a className="mi-text-link" href="#method">See the method</a>
            </div>
            <p className="mi-hero-note">Built for a small founding cohort. Signal first; features second.</p>
          </div>

          <figure className="mi-dossier" aria-label="Example six-point founder intelligence brief">
            <figcaption className="mi-dossier-head">
              <span>Example founder brief / 08:00</span>
              <span className="mi-live-label"><i aria-hidden="true" /> Signals resolved</span>
            </figcaption>
            <div className="mi-dossier-story">
              <div className="mi-dossier-source">Infrastructure · developing story</div>
              <h2>The cost curve for autonomous agents just shifted.</h2>
              <p>Three announcements point to a cheaper, longer-running agent stack—and a narrower window for teams still pricing against last quarter.</p>
            </div>
            <div className="mi-dossier-rail" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>
            <div className="mi-dossier-action">
              <span>Suggested move</span>
              <strong>Revisit your usage assumptions before Thursday.</strong>
            </div>
          </figure>
        </section>

        <section className="mi-signal-band" id="method" aria-labelledby="mi-method-title">
          <div className="mi-signal-band-head">
            <p className="mi-overline">The input is noisy. The output cannot be.</p>
            <h2 id="mi-method-title">From scattered signals to one founder-grade brief.</h2>
          </div>
          <div className="mi-signal-flow" aria-label="Briefly intelligence workflow">
            <div className="mi-source-cloud">
              {["Newsletters", "Product launches", "Show HN", "Research", "Competitors", "Founder feeds"].map((source) => <span key={source}>{source}</span>)}
            </div>
            <div className="mi-flow-line" aria-hidden="true"><span /></div>
            <div className="mi-agent-node">
              <span className="mi-agent-glyph" aria-hidden="true">B</span>
              <p><strong>Briefly</strong><br />deduplicates · scores · remembers</p>
            </div>
            <div className="mi-flow-line" aria-hidden="true"><span /></div>
            <div className="mi-output-node"><span>08:00</span><strong>One market brief</strong><small>cited · personal · actionable</small></div>
          </div>
        </section>

        <section className="mi-stage mi-stage--brief" id="brief" aria-labelledby="mi-brief-title">
          <div className="mi-stage-intro">
            <p className="mi-stage-number">1.0 / DECIDE</p>
            <h2 id="mi-brief-title">Not another summary. A six-point decision brief.</h2>
            <p>Most digests stop at what happened. Briefly carries every important signal through context, consequence and a concrete next move.</p>
          </div>
          <ol className="mi-brief-points">
            {briefPoints.map(([label, body], index) => (
              <li key={label}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{label}</h3><p>{body}</p></div></li>
            ))}
          </ol>
        </section>

        <section className="mi-stage mi-stage--memory" id="memory" aria-labelledby="mi-memory-title">
          <div className="mi-stage-intro">
            <p className="mi-stage-number">2.0 / REMEMBER</p>
            <h2 id="mi-memory-title">Today’s signal is only useful if it remembers yesterday.</h2>
            <p>Briefly builds a living map of companies, people and ideas—then brings the right history forward when a new development changes the story.</p>
            <a className="mi-text-link" href="/login">Ask your market memory</a>
          </div>
          <div className="mi-memory-thread">
            <div className="mi-thread-label">Illustrative tracked thread / agent infrastructure</div>
            {memoryEvents.map((event, index) => (
              <article key={event.date} className={index === memoryEvents.length - 1 ? "is-current" : undefined}>
                <div className="mi-thread-date">{event.date}</div><div className="mi-thread-dot" aria-hidden="true" /><div><h3>{event.title}</h3><p>{event.body}</p></div>
              </article>
            ))}
            <div className="mi-memory-result"><span>Compound context</span><p>“This is not an isolated launch. It completes a three-month strategic shift.”</p></div>
          </div>
        </section>

        <section className="mi-actions" id="actions" aria-labelledby="mi-actions-title">
          <div className="mi-actions-head">
            <p className="mi-stage-number">3.0 / ACT</p>
            <h2 id="mi-actions-title">Intelligence should change what happens next.</h2>
            <p>Write-back turns reading into a durable operating loop, without asking you to maintain another knowledge system.</p>
          </div>
          <div className="mi-action-list">
            {[
              ["Track this company", "Keep future moves attached to the same strategic thread.", "Persistent watchlist"],
              ["Save to market memory", "Make the signal available to every future brief and answer.", "Compound context"],
              ["Create an idea note", "Move the implication into your working system, with its sources intact.", "Notion / Markdown direction"],
            ].map(([name, body, meta], index) => (
              <article key={name}><span className="mi-action-index">0{index + 1}</span><div><h3>{name}</h3><p>{body}</p></div><span className="mi-action-meta"><CheckIcon /> {meta}</span></article>
            ))}
          </div>
        </section>

        <section className="mi-direction" id="direction" aria-labelledby="mi-direction-title">
          <div className="mi-direction-head">
            <p className="mi-overline">The product direction</p>
            <h2 id="mi-direction-title">A market intelligence layer, earned one habit at a time.</h2>
            <p>Briefly is not racing to become a generic assistant. Each layer ships only when the one before it proves that founders would miss it.</p>
          </div>
          <ol className="mi-direction-list">
            {direction.map((item) => (
              <li key={item.layer}><div className="mi-direction-number">{item.layer}</div><div className="mi-direction-copy"><span>{item.name}</span><h3>{item.promise}</h3><p>{item.detail}</p></div><div className="mi-direction-gate">{item.gate}</div></li>
            ))}
          </ol>
        </section>

        <section className="mi-access" aria-labelledby="mi-access-title">
          <div><p className="mi-overline">Founding access</p><h2 id="mi-access-title">Start with the brief you would actually miss.</h2></div>
          <div className="mi-access-copy"><p>Bring the market, companies and questions you track. Briefly will turn them into one morning intelligence loop—and get sharper as your context compounds.</p><a className="mi-link-button mi-link-button--paper" href="/login">Build my first brief <ArrowIcon /></a></div>
        </section>
      </main>

      <footer className="mi-footer">
        <p className="mi-footer-statement">Stop carrying the market in your head.</p>
        <div className="mi-footer-meta"><span>Briefly · {year}</span><nav aria-label="Footer navigation"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/login">Sign in</a></nav></div>
      </footer>
    </div>
  );
}
