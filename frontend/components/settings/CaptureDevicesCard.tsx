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

const VISIBLE_GROUPS = 4;
const VISIBLE_TOKENS = 3;

type DeviceGroup = {
  key: string;
  name: string;
  platform: string | null;
  tokens: CaptureToken[];
};

function groupTokens(tokens: CaptureToken[]): DeviceGroup[] {
  const sorted = [...tokens].sort((a, b) => {
    const aT = a.last_used_at || a.created_at;
    const bT = b.last_used_at || b.created_at;
    return bT.localeCompare(aT);
  });
  const map = new Map<string, DeviceGroup>();
  for (const token of sorted) {
    const key = `${token.name}\0${token.platform ?? ""}`;
    const existing = map.get(key);
    if (existing) {
      existing.tokens.push(token);
    } else {
      map.set(key, {
        key,
        name: token.name,
        platform: token.platform,
        tokens: [token],
      });
    }
  }
  return Array.from(map.values());
}

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
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [revokingUnused, setRevokingUnused] = useState(false);

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

  async function handleRevokeUnused() {
    const unused = tokens.filter(
      (t) => !t.last_used_at && t.token_prefix !== localTokenPrefix,
    );
    if (!unused.length) return;
    const ok = window.confirm(
      `Revoke ${unused.length} unused device token${unused.length === 1 ? "" : "s"}? This cannot be undone.`,
    );
    if (!ok) return;
    setRevokingUnused(true);
    setError("");
    try {
      const results = await Promise.allSettled(
        unused.map((t) => api.revokeCaptureToken(t.id)),
      );
      const revoked = new Set(
        unused.filter((_, i) => results[i].status === "fulfilled").map((t) => t.id),
      );
      setTokens((prev) => prev.filter((t) => !revoked.has(t.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke unused tokens.");
    } finally {
      setRevokingUnused(false);
    }
  }

  function toggleGroupTokens(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  const groups = groupTokens(tokens);
  const visibleGroups = showAllGroups ? groups : groups.slice(0, VISIBLE_GROUPS);
  const hiddenGroupCount = groups.length - visibleGroups.length;
  const unusedCount = tokens.filter(
    (t) => !t.last_used_at && t.token_prefix !== localTokenPrefix,
  ).length;

  return (
    <div className="capture-devices" id="capture-devices">
      <p className="settings-field-hint capture-devices-intro">
        Device tokens let the extension, mobile share sheet, and desktop orb call capture/orb APIs
        without re-logging in. Create one per device — the secret is shown only once.
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
            This is the only time we show the full token. For mobile share, tap
            &ldquo;Use on this device&rdquo;. The Chrome extension connects automatically from
            its popup.
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
        <>
          <div className="capture-devices-toolbar">
            <p className="capture-devices-count">
              {tokens.length} token{tokens.length === 1 ? "" : "s"}
              {groups.length > 1 ? ` · ${groups.length} device types` : ""}
            </p>
            <div className="capture-devices-toolbar-actions">
              {unusedCount > 1 && (
                <button
                  type="button"
                  className="dash-btn dash-btn-secondary"
                  onClick={() => void handleRevokeUnused()}
                  disabled={revokingUnused}
                >
                  {revokingUnused ? "Revoking…" : `Revoke ${unusedCount} unused`}
                </button>
              )}
            </div>
          </div>
          <div className="capture-devices-list">
            {visibleGroups.map((group) => {
              const latest = group.tokens[0];
              const showAll = expandedGroups.has(group.key);
              const shown = showAll ? group.tokens : group.tokens.slice(0, VISIBLE_TOKENS);
              const more = group.tokens.length - shown.length;
              return (
                <details key={group.key} className="capture-devices-group">
                  <summary className="capture-devices-group-summary">
                    <span>
                      <span className="capture-devices-group-name">{group.name}</span>
                      <span className="capture-devices-group-meta">
                        {group.tokens.length} token{group.tokens.length === 1 ? "" : "s"}
                        {group.platform ? ` · ${group.platform}` : ""}
                        {" · "}Last used {formatWhen(latest.last_used_at)}
                      </span>
                    </span>
                    <span className="capture-devices-group-chevron" aria-hidden>
                      ›
                    </span>
                  </summary>
                  <ul className="capture-devices-group-body">
                    {shown.map((token) => (
                      <li key={token.id} className="capture-devices-item">
                        <div className="capture-devices-item-main">
                          <span className="capture-devices-item-name">
                            {token.token_prefix}…
                            {token.token_prefix === localTokenPrefix ? " · this browser" : ""}
                          </span>
                          <span className="capture-devices-item-meta">
                            Last used {formatWhen(token.last_used_at)}
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
                  {more > 0 && (
                    <button
                      type="button"
                      className="dash-btn dash-btn-secondary capture-devices-more"
                      onClick={() => toggleGroupTokens(group.key)}
                    >
                      Show {more} more
                    </button>
                  )}
                  {showAll && group.tokens.length > VISIBLE_TOKENS && (
                    <button
                      type="button"
                      className="dash-btn dash-btn-secondary capture-devices-more"
                      onClick={() => toggleGroupTokens(group.key)}
                    >
                      Show fewer
                    </button>
                  )}
                </details>
              );
            })}
          </div>
          {hiddenGroupCount > 0 && (
            <button
              type="button"
              className="dash-btn dash-btn-secondary capture-devices-more-types"
              onClick={() => setShowAllGroups(true)}
            >
              Show {hiddenGroupCount} more device type{hiddenGroupCount === 1 ? "" : "s"}
            </button>
          )}
          {showAllGroups && groups.length > VISIBLE_GROUPS && (
            <button
              type="button"
              className="dash-btn dash-btn-secondary capture-devices-more-types"
              onClick={() => setShowAllGroups(false)}
            >
              Show fewer device types
            </button>
          )}
        </>
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
