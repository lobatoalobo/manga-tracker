// Service worker mínimo + Web Push. Chrome exige un SW con handler de 'fetch'
// para ofrecer la instalación de la PWA. No interceptamos requests (pass-through).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// Muestra la notificación push.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "Nakama";
  const options = {
    body: data.body || "",
    icon: "/icons/192",
    badge: "/icons/192",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación, enfoca/abre la URL.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if (c.url.includes(url) && "focus" in c) return c.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
