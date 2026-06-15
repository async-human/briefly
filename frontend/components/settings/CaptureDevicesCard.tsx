"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type CaptureToken, type CaptureTokenCreated } from "@/lib/api";
import { getCaptureToken, setCaptureToken } from "@/lib/captureAuth";

const PLATFORM_OPTIONS = [
  { value: "extension", label: "Browser extension" },
  { value: "android", label: "Android share" },
  { value: "web", label: "Web / PWA" },
  { value: "desktop", label: "Desktop app" },
];

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function CaptureDevicesCard() {
  const [tokens, setTokens] = useState<CaptureToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPlatform, setNewPlatform] = useState("web");
  const [freshToken, setFreshToken] = useState<CaptureTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [localTokenPrefix, setLocalTokenPrefix] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const list = await api.listCaptureTokens();
      setTokens(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const local = getCaptureToken();
    if (local) {
      setLocalTokenPrefix(local.slice(0, 9));
    }
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    setError("");
    try {
      const created = await api.createCaptureToken({ name, platform: newPlatform });
      setFreshToken(created);
      setTokens((prev) => [
        {
          id: created.id,
          name: created.name,
          token_prefix: created.token_prefix,
          platform: created.platform,
          created_at: created.created_at,
          last_used_at: created.last_used_at,
        },
        ...prev,
      ]);
      setNewName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create device token.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    setRevokingId(tokenId);
    setError("");
    try {
      await api.revokeCaptureToken(tokenId);
      setTokens((prev) => prev.filter((t) => t.id !== tokenId));
      if (freshToken?.id === tokenId) setFreshToken(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke token.");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopyToken() {
    if (!freshToken?.token) return;
    await navigator.clipboard.writeText(freshToken.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleUseOnThisDevice() {
    if (!freshToken?.token) return;
    setCaptureToken(freshToken.token);
    setLocalTokenPrefix(freshToken.token.slice(0, 9));
    setFreshToken(null);
  }

  return (
    <div className="capture-devices" id="capture-devices">
      <p className="settings-field-hint capture-devices-intro">
        Device tokens let the browser extension and mobile share sheet save articles without
        re-logging in. Create one per device — the secret is shown only once.
      </p>

      {localTokenPrefix ? (
        <p className="capture-devices-local">
          This browser has a device token saved ({localTokenPrefix}…).
        </p>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {freshToken ? (
        <div className="capture-devices-fresh">
          <p className="capture-devices-fresh-title">Copy your device token now</p>
          <p className="settings-field-hint">
            This is the only time we show the full token. Paste it into the extension if needed,
            or tap &ldquo;Use on this device&rdquo; for mobile share.
          </p>
          <code className="capture-devices-token">{freshToken.token}</code>
          <div className="capture-devices-fresh-actions">
            <button type="button" className="dash-btn dash-btn-primary" onClick={() => void handleCopyToken()}>
              {copied ? "Copied" : "Copy token"}
            </button>
            <button type="button" className="dash-btn dash-btn-secondary" onClick={handleUseOnThisDevice}>
              Use on this device
            </button>
          </div>
        </div>
      ) : null}

      <form className="capture-devices-form" onSubmit={(e) => void handleCreate(e)}>
        <div className="capture-devices-form-row">
          <label className="settings-field-label" htmlFor="capture-device-name">
            New device
          </label>
          <div className="capture-devices-form-fields">
            <input
              id="capture-device-name"
              type="text"
              className="onboard-input"
              placeholder="e.g. My Pixel, Work Chrome"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
              maxLength={120}
            />
            <select
              className="onboard-input capture-devices-platform"
              value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value)}
              disabled={creating}
              aria-label="Device type"
            >
              {PLATFORM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button type="submit" className="dash-btn dash-btn-primary" disabled={creating || !newName.trim()}>
              {creating ? "Creating…" : "Create token"}
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <p className="settings-field-hint">Loading devices…</p>
      ) : tokens.length === 0 ? (
        <p className="settings-field-hint">No device tokens yet.</p>
      ) : (
        <ul className="capture-devices-list">
          {tokens.map((token) => (
            <li key={token.id} className="capture-devices-item">
              <div className="capture-devices-item-main">
                <span className="capture-devices-item-name">{token.name}</span>
                <span className="capture-devices-item-meta">
                  {token.token_prefix}…
                  {token.platform ? ` · ${token.platform}` : ""}
                  {" · "}Last used {formatWhen(token.last_used_at)}
                </span>
              </div>
              <button
                type="button"
                className="capture-devices-revoke"
                onClick={() => void handleRevoke(token.id)}
                disabled={revokingId === token.id}
              >
                {revokingId === token.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One-click mobile share setup — creates token and stores locally. */
export function useEnableMobileShare() {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  async function enable() {
    setStatus("loading");
    setError("");
    try {
      const created = await api.createCaptureToken({
        name: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 40) : "Mobile",
        platform: /android/i.test(navigator.userAgent) ? "android" : "web",
      });
      setCaptureToken(created.token);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not enable share.");
    }
  }

  const hasLocalToken = typeof window !== "undefined" && !!getCaptureToken();

  return { enable, status, error, hasLocalToken };
}
