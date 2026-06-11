"use client";

import { Reveal } from "./Reveal";

type CellValue = { kind: "yes" | "no" | "note" | "text"; value: string };

type CompareRow = {
  feature: string;
  briefly: CellValue;
  readless: CellValue;
  meco: CellValue;
  readwise: CellValue;
  pulse: CellValue;
};

const COMPETITORS = ["Briefly", "Readless", "Meco", "Readwise Reader", "ChatGPT Pulse"] as const;

const ROWS: CompareRow[] = [
  {
    feature: "What it is",
    briefly: { kind: "text", value: "One synthesized daily brief from everything you follow" },
    readless: { kind: "text", value: "Consolidated newsletter and RSS digest" },
    meco: { kind: "text", value: "A cleaner inbox for reading newsletters" },
    readwise: { kind: "text", value: "Read-later library with highlights" },
    pulse: { kind: "text", value: "Daily AI cards inside ChatGPT" },
  },
  {
    feature: "Built from your own sources — newsletters, YouTube, Reddit, RSS, web saves",
    briefly: { kind: "yes", value: "Yes — all of them" },
    readless: { kind: "note", value: "Newsletters + RSS" },
    meco: { kind: "note", value: "Newsletters" },
    readwise: { kind: "note", value: "What you save manually" },
    pulse: { kind: "note", value: "Open web + your chats, Gmail, Calendar" },
  },
  {
    feature: "One brief instead of thirty reads",
    briefly: { kind: "yes", value: "Yes" },
    readless: { kind: "yes", value: "Yes" },
    meco: { kind: "no", value: "No — you read each one" },
    readwise: { kind: "no", value: "No — you read each one" },
    pulse: { kind: "yes", value: "Yes" },
  },
  {
    feature: "Learns from what you click, save and skip",
    briefly: { kind: "yes", value: "Yes — relevance adapts nightly" },
    readless: { kind: "no", value: "—" },
    meco: { kind: "no", value: "—" },
    readwise: { kind: "no", value: "—" },
    pulse: { kind: "note", value: "Thumbs up/down feedback" },
  },
  {
    feature: "Follows stories across days and weeks",
    briefly: { kind: "yes", value: "Yes — story threads" },
    readless: { kind: "no", value: "—" },
    meco: { kind: "no", value: "—" },
    readwise: { kind: "no", value: "—" },
    pulse: { kind: "no", value: "—" },
  },
  {
    feature: "Flags contradictions and blind spots in your sources",
    briefly: { kind: "yes", value: "Yes" },
    readless: { kind: "no", value: "—" },
    meco: { kind: "no", value: "—" },
    readwise: { kind: "no", value: "—" },
    pulse: { kind: "no", value: "—" },
  },
  {
    feature: "Ask questions across everything you've read",
    briefly: { kind: "yes", value: "Yes — with citations to your sources" },
    readless: { kind: "no", value: "—" },
    meco: { kind: "no", value: "—" },
    readwise: { kind: "note", value: "Per-article AI assistant" },
    pulse: { kind: "note", value: "Via ChatGPT, open web" },
  },
  {
    feature: "Capture your own thinking — voice notes, web saves — into the brief",
    briefly: { kind: "yes", value: "Yes" },
    readless: { kind: "no", value: "—" },
    meco: { kind: "note", value: "Bookmarks" },
    readwise: { kind: "note", value: "Saves and highlights" },
    pulse: { kind: "no", value: "—" },
  },
  {
    feature: "Price",
    briefly: { kind: "text", value: "$9/mo founding" },
    readless: { kind: "text", value: "$4.90/mo" },
    meco: { kind: "text", value: "$3.99/mo" },
    readwise: { kind: "text", value: "$9.99/mo" },
    pulse: { kind: "text", value: "Bundled with ChatGPT paid plans" },
  },
];

const VERDICTS = [
  {
    title: "Briefly vs Meco",
    themLabel: "Meco",
    themBody:
      "if you genuinely enjoy reading every newsletter and just want them out of your inbox, in a beautiful reading app.",
    usBody:
      "if 30 newsletters a day is the problem, not the format — you want the five things that matter, already connected to what you're working on.",
  },
  {
    title: "Briefly vs Readwise Reader",
    themLabel: "Reader",
    themBody:
      "if you're a highlighter — you read deeply, annotate, and export to Obsidian or Notion. It's the best library there is.",
    usBody:
      "if your saved-for-later list keeps growing and your goal is staying sharp, not archiving. Many of our users keep both: Briefly to filter, Reader to keep.",
  },
  {
    title: "Briefly vs Readless",
    themLabel: "Readless",
    themBody: "if you want the cheapest way to compress newsletters and RSS into one summary email.",
    usBody:
      "if you want a brief that knows you — it learns from your behavior, tracks stories over weeks, flags what your sources disagree on, and answers questions about anything you've read.",
  },
  {
    title: "Briefly vs ChatGPT Pulse",
    themLabel: "Pulse",
    themBody:
      "if you live in ChatGPT and want general daily suggestions drawn from your chats and the open web.",
    usBody:
      "if your edge comes from a curated diet — specific newsletters, channels and communities. Pulse briefs you on the world. Briefly briefs you on your world, with citations to your own sources.",
  },
] as const;

function CompareCell({ cell, highlight }: { cell: CellValue; highlight?: boolean }) {
  const className = [
    "compare-cell",
    highlight ? "compare-cell-briefly" : "",
    cell.kind === "yes" ? "compare-cell-yes" : "",
    cell.kind === "no" ? "compare-cell-no" : "",
    cell.kind === "note" ? "compare-cell-note" : "",
    cell.kind === "text" && highlight ? "compare-cell-strong" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <td className={className}>{cell.value}</td>;
}

export function CompareSection() {
  return (
    <section className="compare-section landing-section landing-band-cool" id="compare">
      <div className="landing-section-inner compare-inner">
        <Reveal>
          <div className="section-header-centered compare-header">
            <p className="section-eyebrow">How Briefly compares</p>
            <h2 className="section-heading">
              Plenty of apps organize your reading.
              <br />
              One actually does it for you — and learns.
            </h2>
            <p className="section-body compare-lede">
              An honest comparison. Some of these tools are excellent at a different job —
              here&apos;s exactly where each one fits, and where Briefly is the only option.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="compare-table-scroll" tabIndex={0} role="region" aria-label="Product comparison table">
            <table className="compare-table">
              <thead>
                <tr>
                  <th className="compare-feature-col" scope="col">
                    &nbsp;
                  </th>
                  {COMPETITORS.map((name) => (
                    <th
                      key={name}
                      scope="col"
                      className={name === "Briefly" ? "compare-col-briefly" : undefined}
                    >
                      {name}
                      {name === "Briefly" && <span className="compare-badge">your sources</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.feature}>
                    <th className="compare-feature-col" scope="row">
                      {row.feature}
                    </th>
                    <CompareCell cell={row.briefly} highlight />
                    <CompareCell cell={row.readless} />
                    <CompareCell cell={row.meco} />
                    <CompareCell cell={row.readwise} />
                    <CompareCell cell={row.pulse} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <div className="compare-verdicts">
          {VERDICTS.map((v, i) => (
            <Reveal key={v.title} delay={0.06 + i * 0.05}>
              <article className="compare-verdict">
                <h3 className="compare-verdict-title">{v.title}</h3>
                <p className="compare-verdict-them">
                  <b>Choose {v.themLabel}</b> {v.themBody}
                </p>
                <p className="compare-verdict-us">
                  <b>Choose Briefly</b> {v.usBody}
                </p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.12}>
          <div className="compare-cta-row">
            <a href="#pricing" className="btn-light-primary compare-cta">
              Get your first briefing tomorrow morning
            </a>
            <p className="compare-cta-sub">Free to start · Founding Pro $9/mo · Cancel anytime</p>
          </div>
          <p className="compare-foot">
            Comparisons based on each product&apos;s public documentation and pricing as of June 2026;
            features and prices may change. Looking at Particle or a general AI agent like Vellum?
            Particle is excellent for world news, and agents are great if you want to build your own
            assistant — Briefly is for your personal sources, with zero setup. All product names and
            trademarks belong to their respective owners.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
