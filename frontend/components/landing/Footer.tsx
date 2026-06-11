const NAV_COLUMN = [
  { href: "#features", label: "Features" },
  { href: "#compare", label: "Compare" },
  { href: "#pricing", label: "Pricing" },
  { href: "#trust", label: "Privacy" },
] as const;

const LEGAL_COLUMN = [
  { href: "/privacy", label: "Privacy policy" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy/data-handling", label: "Data handling" },
] as const;

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer-linear footer-linear-v2">
      <div className="footer-linear-inner">
        <div className="footer-linear-top">
          <p className="footer-linear-copy">
            © {year} Briefly. All rights reserved.
          </p>

          <div className="footer-linear-columns">
            <div className="footer-linear-col">
              <p className="footer-linear-col-title">Navigation</p>
              <ul className="footer-linear-col-list">
                {NAV_COLUMN.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>

            <div className="footer-linear-col">
              <p className="footer-linear-col-title">Legal</p>
              <ul className="footer-linear-col-list">
                {LEGAL_COLUMN.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-linear-wordmark" aria-hidden>
          <span>Briefly</span>
        </div>
      </div>
    </footer>
  );
}
