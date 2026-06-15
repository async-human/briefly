"use client";

import { getChromeWebStoreUrl } from "@/lib/chromeExtension";

const STORE_URL = getChromeWebStoreUrl();

export function ExtensionInstallCard() {
  return (
    <div className="extension-install">
      <div className="extension-install-copy">
        <h2 className="install-hint-title">Desktop — Chrome extension</h2>
        <p className="install-hint-desc">
          Install from the Chrome Web Store — one click, same as any other extension. Then open any
          article and click the Briefly icon to connect your account once.
        </p>
        <ol className="install-hint-steps">
          <li>
            <strong>Add to Chrome</strong> from the store (no manual files or developer mode).
          </li>
          <li>Open any article → click the <strong>Briefly</strong> toolbar icon.</li>
          <li>Tap <strong>Connect to Briefly</strong> once — saves work from then on.</li>
        </ol>
      </div>

      {STORE_URL ? (
        <a
          href={STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="dash-btn dash-btn-primary extension-install-cta"
        >
          Add to Chrome
        </a>
      ) : (
        <div className="extension-install-unavailable">
          <span className="install-hint-badge">Chrome extension launching soon</span>
          <p className="install-hint-desc install-hint-desc--muted">
            You can still save links by pasting a URL above. Mobile share works today.
          </p>
        </div>
      )}
    </div>
  );
}
