// Docket's service worker exists only so Chrome and Edge offer to install Docket as an app.
// It has no fetch handler on purpose: every page and API request goes straight to the server, never
// a cache, because Docket updates itself by reloading its pages.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
