import { api } from "./api";

export type PushState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  enabledServerSide: boolean;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function ready(): Promise<ServiceWorkerRegistration> {
  // PwaRegistrar already registers /sw.js; make sure it's registered + ready.
  if (!(await navigator.serviceWorker.getRegistration())) {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }
  return navigator.serviceWorker.ready;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) {
    return { supported: false, permission: "unsupported", subscribed: false, enabledServerSide: false };
  }
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    subscribed = Boolean(sub);
  } catch {
    /* ignore */
  }
  let enabledServerSide = false;
  try {
    enabledServerSide = (await api.getVapidKey()).enabled;
  } catch {
    /* ignore */
  }
  return {
    supported: true,
    permission: Notification.permission,
    subscribed,
    enabledServerSide,
  };
}

/** Request permission, subscribe with the server's VAPID key, and persist it. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "Notifications aren't supported in this browser." };

  const { public_key, enabled } = await api.getVapidKey();
  if (!enabled || !public_key) {
    return { ok: false, reason: "Push isn't configured on the server yet (missing VAPID keys)." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "Notification permission was not granted." };
  }

  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    });
  }

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: "Could not read the push subscription." };
  }

  await api.pushSubscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    user_agent: navigator.userAgent,
  });
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } finally {
    await api.pushUnsubscribe(endpoint).catch(() => undefined);
  }
}
