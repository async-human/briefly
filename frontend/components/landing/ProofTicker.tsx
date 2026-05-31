const quotes = [
  { avatar: "R", text: <>Finally replaced my <strong>2-hour morning scroll</strong> with something that actually knows what I care about.</> },
  { avatar: "S", text: <>The &apos;why this matters to you&apos; line is <strong>genuinely uncanny</strong>. It referenced a specific thing I was researching.</> },
  { avatar: "A", text: <>I follow 14 newsletters. Briefly merges them into <strong>8 items that actually matter</strong>. This is magic.</> },
  { avatar: "P", text: <>The memory feature is wild. It remembered I was tracking a story from <strong>three weeks ago</strong>.</> },
  { avatar: "K", text: <>Day 90 and I haven&apos;t had to <strong>do anything to keep it alive</strong>. It just keeps getting better.</> },
  { avatar: "N", text: <>The skipped-items note is the best feature. I know <strong>exactly what I&apos;m not missing</strong>.</> },
  { avatar: "V", text: <>I connected YouTube and it instantly found <strong>52 channels I subscribe to</strong>. Didn&apos;t have to add a single one manually.</> },
  { avatar: "M", text: <>A second brain that <strong>builds itself from what I already follow</strong> — finally, something that works without me.</> },
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
