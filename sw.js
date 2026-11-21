// Docket's service worker: a standby page for the moments Docket is not answering yet (#1093). After a restart the
// browser may bring back Docket's window before Docket has started, and would show its own "can't reach this page".
// Page loads always go to the server first, so while it answers nothing changes (updates and self-reloads work as
// before). Only when a page load fails does this answer with "Docket is starting…", which checks the server every
// couple of seconds and reloads into Docket once it answers. Everything else (the API, WebSocket traffic, files) is
// left to the browser; the one exception is the standby page's own icon, from the cache, when the server is down.
// Change CACHE whenever the standby page or its icon changes, so the old copy goes.
const CACHE = 'docket-standby-1';
const ICON = '/icon/docket-192.png';
const STANDBY = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Docket is starting…</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f7f6f3;color:#37352f}
@media (prefers-color-scheme:dark){body{background:#191919;color:#d4d4d4}}
main{text-align:center;max-width:30em;padding:0 1em}img{width:64px;height:64px}h1{font-size:20px;font-weight:600;margin:12px 0 6px}p{margin:0;opacity:.7}
</style></head><body><main><img src="${ICON}" alt=""><h1>Docket is starting…</h1>
<p>This page turns into Docket by itself as soon as it answers. If it does not, start Docket from the Start menu (on a Mac, Applications).</p></main>
<script>
setInterval(() => fetch('/favicon.ico', { cache: 'no-store' }).then((r) => { if (r.ok) location.reload(); }, () => {}), 2000);
</script></body></html>`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(ICON, { cache: 'reload' }))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Only this worker's own old copies go: talk mode's speech model (transformers-cache, #1105) stays.
    for (const k of await caches.keys()) if (k.startsWith('docket-') && k !== CACHE) await caches.delete(k);
    // Page loads start at the server while this worker wakes up, so having it costs them no time.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return (await e.preloadResponse) || await fetch(req); }
      catch { return new Response(STANDBY, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }); }
    })());
  } else if (new URL(req.url).pathname === ICON) {
    e.respondWith(fetch(req).catch(async () => (await caches.match(ICON)) || Response.error()));
  }
});
