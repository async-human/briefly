import { BrieflyLogo } from "@/components/BrieflyLogo";

export function Footer() {
  return (
    <footer className="footer-linear">
      <div className="footer-linear-inner">
        <BrieflyLogo variant="full" size="sm" className="footer-linear-brand" />
        <nav className="footer-linear-nav" aria-label="Footer">
          <a href="/privacy/data-handling">How we use your sources</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <span className="footer-linear-copy">© 2026</span>
      </div>
    </footer>
  );
}
