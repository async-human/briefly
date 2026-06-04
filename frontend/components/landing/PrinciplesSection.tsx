const principles = [
  {
    title: "Connect once. Never maintain.",
    body: "Link your sources a single time. Briefly ingests your streams every night — no saving, tagging, or inbox zero required.",
  },
  {
    title: "We read the firehose for you.",
    body: "Newsletters pile up. Subreddits scroll by. Videos upload overnight. While you sleep, agents collect, clean, and score everything.",
  },
  {
    title: "One story, one entry.",
    body: "The same headline across five sources becomes a single cited summary. Cross-source deduplication — signal without the noise.",
  },
  {
    title: "Every item answers why you.",
    body: "Not why it's generally important — why it matters to your role, your goals, and what you read last week.",
  },
  {
    title: "Curated, not comprehensive.",
    body: "Briefly reads widely and shows what fits your morning. Skipped items come with a reason — so you trust what you see and what you don't.",
  },
  {
    title: "Smarter with every briefing.",
    body: "Clicks, saves, and follow-ups shape what lands tomorrow. Memory that compounds as your interests evolve.",
  },
] as const;

export function PrinciplesSection() {
  return (
    <>
      <hr className="hm-section-rule" />
      <section className="hm-section hm-prose" id="why">
        <h2>Why Briefly</h2>
        <p>
          Briefly is built on a simple promise: your information diet runs itself.
          You wake up informed — without highlighting, filing, or drowning in tabs.
        </p>
        <p>
          Connect once. Read what matters. Trust the rest.
        </p>

        <ul className="hm-mechanism-list">
          {principles.map((p) => (
            <li key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </li>
          ))}
        </ul>

        <p style={{ marginTop: "var(--hm-space-lg)", fontSize: "0.9375rem", color: "var(--hm-muted)" }}>
          Every item links to its original source. Claims are verified before delivery.
        </p>
      </section>
    </>
  );
}
