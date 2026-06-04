const steps = [
  {
    label: "Connect",
    sub: "Link Gmail, YouTube, Reddit, and RSS in a few minutes.",
  },
  {
    label: "Overnight",
    sub: "Briefly collects and scores everything while you sleep.",
  },
  {
    label: "Morning briefing",
    sub: "A personal digest lands when you choose — cited, ranked, explained.",
  },
  {
    label: "Compounding memory",
    sub: "Each read teaches the next briefing what to surface and what to skip.",
  },
] as const;

export function CTA() {
  return (
    <section className="hm-cta" id="start">
      <div className="hm-cta-inner">
        <h2 className="hm-cta-title">Start tonight. Read tomorrow.</h2>
        <p className="hm-cta-body">
          Connect your accounts once. Briefly runs on your schedule. Your first
          briefing is ready when you are — no setup ritual, no daily maintenance.
        </p>
        <a href="/login" className="hm-btn hm-btn-primary">
          Create your briefing →
        </a>
        <p className="hm-hero-note" style={{ marginTop: "var(--hm-space-sm)" }}>
          Free to start · No credit card
        </p>

        <div className="hm-cta-steps">
          {steps.map((step) => (
            <div key={step.label} className="hm-cta-step">
              <strong>{step.label}</strong>
              <span>{step.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
