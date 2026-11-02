/*
 * Nexo service worker (Phase 8): only push notifications.
 * No offline cache on purpose: the panel always needs fresh data, and a stale
 * cached app is worse than a clear "sin conexión" error.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Nexo", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Nexo";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open panel window when there is one.
      for (const client of all) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) return client.navigate(target).catch(() => client.postMessage({ type: "navigate", url: target }));
        return client.postMessage({ type: "navigate", url: target });
      }
      return self.clients.openWindow(target);
    })(),
  );
});

/* The browser may rotate the subscription; tell the API about the new one. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const sub = event.newSubscription || (old && (await self.registration.pushManager.subscribe(old.options)));
      if (!sub) return;
      const json = sub.toJSON();
      await fetch("/api/notifications/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      }).catch(() => {});
    })(),
  );
});
