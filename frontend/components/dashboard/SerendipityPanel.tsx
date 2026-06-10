"use client";

export type SerendipityConnection = {
  title: string;
  body: string;
  content_id?: string | null;
  headline?: string;
};

type Props = {
  connections: SerendipityConnection[];
};

export function SerendipityPanel({ connections }: Props) {
  if (!connections.length) return null;

  return (
    <section className="serendipity-panel" aria-label="Connections Briefly noticed">
      <header className="serendipity-head">
        <p className="serendipity-eyebrow">Connections Briefly noticed</p>
        <p className="serendipity-sub">Cross-domain links from your reading history</p>
      </header>
      <ul className="serendipity-list">
        {connections.map((conn, i) => (
          <li key={`${conn.body}-${i}`} className="serendipity-item">
            <span className="serendipity-item-label">{conn.title}</span>
            <p className="serendipity-item-body">{conn.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
