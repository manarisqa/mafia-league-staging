/* Offline scope is the public referee. Never cache private responses, RPCs or admin pages. */
const CACHE = "mafia-referee-shell-v1";
const SHELL = "/referee";
const asset = (url) => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type !== "prime" || !event.source || new URL(event.source.url).pathname !== SHELL) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const addresses = Array.isArray(event.data.assets) ? event.data.assets.slice(0, 96) : [];
    const shell = await fetch(SHELL, { credentials: "same-origin", cache: "reload", headers: { "x-mafia-referee-shell": "1" } });
    if (shell.ok && !shell.redirected && shell.headers.get("x-mafia-referee-shell") === "1") {
      const html = await shell.clone().text();
      for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) addresses.push(match[1]);
      await cache.put(SHELL, shell);
    }
    await Promise.all([...new Set(addresses)].map(async (address) => {
      const url = new URL(address, self.location.origin);
      if (asset(url)) {
        const response = await fetch(url, { credentials: "same-origin" }).catch(() => null);
        if (response?.ok) await cache.put(url, response);
      }
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (asset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const stored = await cache.match(event.request);
      if (stored) return stored;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })());
  } else if (event.request.mode === "navigate" && url.pathname === SHELL) {
    event.respondWith(fetch(event.request).catch(async () =>
      (await caches.match(SHELL)) ?? Response.error()));
  }
});
