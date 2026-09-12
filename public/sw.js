/* Service worker — web push for the installed PWA (iOS 16.4+, Android, desktop). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// A push arrived → show a system notification.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* ignore */ }
  const title = data.title || "DOMINANT";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/admin", actionUrls: data.actionUrls || null },
    // Action buttons (Android/desktop; iOS shows the notification without them).
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification → focus the app (or open it) at the target URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = (event.notification.data && event.notification.data.url) || "/admin";
  // An action button carries its own target (e.g. "reply" → the chat thread).
  if (event.action && event.notification.data && event.notification.data.actionUrls && event.notification.data.actionUrls[event.action]) {
    url = event.notification.data.actionUrls[event.action];
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) { try { client.navigate(url); } catch (e) { /* ignore */ } }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
