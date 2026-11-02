/**
 * Installable panel + Web Push (Phase 8).
 * The service worker (public/sw.js) only shows notifications; there is no offline cache.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { NotificationSettings } from "@nexo/shared";
import { post } from "./api";

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iPhone/iPad only get Web Push when the panel was added to the home screen (iOS 16.4+). */
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("[pwa] service worker", e));
  });
}

const swRegistration = async () => {
  if (!("serviceWorker" in navigator)) throw new Error("unsupported");
  // In development the worker is registered on demand (Vite does not register it on load).
  return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
};

const toBytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** This browser's current subscription, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission, subscribes and registers the device with the API. */
export async function enablePush(settings: Pick<NotificationSettings, "publicKey">) {
  if (!settings.publicKey) throw new Error("Las notificaciones aún no están disponibles.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "El navegador bloqueó las notificaciones. Permítelas en la configuración del sitio y vuelve a intentarlo." : "No diste permiso para mostrar notificaciones.");
  const reg = await swRegistration();
  await navigator.serviceWorker.ready;
  const key = toBytes(settings.publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (keys rotated) must be replaced.
  const sameKey = (s: PushSubscription) => {
    const k = s.options.applicationServerKey;
    if (!k) return true;
    const a = new Uint8Array(k);
    return a.length === key.length && a.every((x, i) => x === key[i]);
  };
  if (sub && !sameKey(sub)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  return post<{ id: string; device: string }>("/notifications/subscriptions", { endpoint: json.endpoint, keys: json.keys });
}

/** Unsubscribes this browser and forgets it in the API. */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post("/notifications/subscriptions/remove", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Lets a notification click open a page inside the already-open panel without a reload. */
export function PwaBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const on = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null;
      if (data?.type !== "navigate" || !data.url) return;
      const u = new URL(data.url, window.location.origin);
      if (u.origin === window.location.origin) navigate(u.pathname + u.search);
    };
    navigator.serviceWorker.addEventListener("message", on);
    return () => navigator.serviceWorker.removeEventListener("message", on);
  }, [navigate]);
  return null;
}
