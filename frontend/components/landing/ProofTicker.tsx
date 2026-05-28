const quotes = [
  { avatar: "R", text: <>Finally replaced my <strong>2-hour morning scroll</strong> with something that actually knows what I care about.</> },
  { avatar: "S", text: <>The &apos;why this matters to you&apos; line is <strong>genuinely uncanny</strong>. It referenced a specific thing I was researching.</> },
  { avatar: "A", text: <>I follow 14 newsletters. Briefly merges them into <strong>8 items that actually matter</strong>. This is magic.</> },
  { avatar: "P", text: <>The memory feature is wild. It remembered I was tracking a story from <strong>three weeks ago</strong>.</> },
  { avatar: "K", text: <>My Pocket queue was 400 articles. <strong>I deleted it all</strong>. Briefly is the thing Pocket was trying to be.</> },
  { avatar: "N", text: <>The skipped-items note is the best feature. I know <strong>exactly what I&apos;m not missing</strong>.</> },
];

export function ProofTicker() {
  const allQuotes = [...quotes, ...quotes];

  return (
    <div className="proof-section">
      <div className="proof-ticker">
        <div className="ticker-track">
          {allQuotes.map((quote, i) => (
            <div className="ticker-quote" key={`${quote.avatar}-${i}`}>
              <div className="quote-avatar">{quote.avatar}</div>
              <div className="quote-text">&quot;{quote.text}&quot;</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
