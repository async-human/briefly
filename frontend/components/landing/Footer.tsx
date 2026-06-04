export function Footer() {
  return (
    <footer className="footer-linear">
      <div className="footer-linear-inner">
        <div className="footer-linear-brand-block">
          <span className="footer-linear-brand">Briefly</span>
          <p className="footer-linear-tagline">
            Your personal morning briefing agent.
          </p>
        </div>

        <nav className="footer-linear-col" aria-label="Product">
          <p className="footer-linear-col-title">Product</p>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#demo">Demo</a>
        </nav>

        <nav className="footer-linear-col" aria-label="Legal">
          <p className="footer-linear-col-title">Legal</p>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>

        <p className="footer-linear-copy">© 2026 Briefly</p>
      </div>
    </footer>
  );
}
