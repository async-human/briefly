export function CTA() {
  return (
    <section className="cta-linear landing-section" id="start">
      <div className="landing-section-inner cta-linear-inner">
        <div className="section-header-centered">
          <p className="section-eyebrow">Get started</p>
          <h2 className="section-heading">
            Built for mornings. Available tonight.
          </h2>
          <p className="section-body">
            Connect your sources once. Briefly runs on your schedule — your first
            briefing is ready when you are.
          </p>
        </div>
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
