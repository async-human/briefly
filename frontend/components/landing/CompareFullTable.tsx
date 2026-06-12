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

export const COMPARE_ROWS: CompareRow[] = [
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

export function CompareFullTable() {
  return (
    <div className="compare-table-scroll" tabIndex={0} role="region" aria-label="Full product comparison table">
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
          {COMPARE_ROWS.map((row) => (
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
  );
}
