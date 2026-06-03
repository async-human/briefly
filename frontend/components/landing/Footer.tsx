/* Ft5 — Statement footer */
export function Footer() {
  return (
    <footer className="footer-statement">
      <div className="footer-statement-inner">
        <p className="footer-statement-headline">Your second brain<br />starts tonight.</p>
        <a href="/login" className="footer-statement-cta">Start building yours free →</a>
        <div className="footer-statement-links">
          <a href="/privacy">Privacy</a>
          <span aria-hidden>·</span>
          <a href="/terms">Terms</a>
          <span aria-hidden>·</span>
          <span>© 2026 Briefly</span>
        </div>
      </div>
    </footer>
  );
}
