// Service worker mínimo. Chrome exige un SW con un handler de 'fetch' para
// ofrecer la instalación de la PWA. No interceptamos las requests (pass-through).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
