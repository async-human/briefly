export function CTA() {
  return (
    <section className="cta-linear landing-section" id="start">
      <div className="landing-section-inner cta-linear-inner">
        <p className="cta-linear-eyebrow">Get started</p>
        <h2 className="cta-linear-headline">
          Built for mornings. Available tonight.
        </h2>
        <p className="cta-linear-sub">
          Connect your sources once. Briefly runs on your schedule — your first
          briefing is ready when you are.
        </p>
        <div className="cta-linear-actions">
          <a href="/login" className="btn-light-primary">
            Start free →
          </a>
          <a href="#pricing" className="btn-light-ghost">
            See pricing
          </a>
        </div>
        <p className="cta-linear-fine">Free to start · No credit card required</p>
      </div>
    </section>
  );
}
