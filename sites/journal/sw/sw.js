/**
 * The journal's service worker: it keeps the app itself (never the journal: that lives sealed in
 * IndexedDB) so the installed app opens with no connection, and it shows the daily reminder.
 *
 *   the app shell   every file of this build, cached on install (the list is written in at build
 *                   time, vite.config.ts); served from the cache first
 *   /api/*          always the network; never cached
 *   the reminder    a push with no content (the server knows nothing to say) becomes "How was
 *                   today?"; a tap opens today's page
 *
 * The previous build's cache is kept one version longer, so a page still running the old app
 * can load the old app's files after an update.
 *
 * Both placeholders below are written in at build time: '__BUILD__' (a hash of the file list)
 * and self.__PRECACHE__ (the list itself; the name follows Workbox's self.__WB_MANIFEST).
 */

const BUILD = '__BUILD__';
const PRECACHE = /** @type {string[]} */ (self.__PRECACHE__);
const CACHE = `journal-${BUILD}`;
/** Remembers which build was active last, so its cache survives one more update. */
const META = 'journal-meta';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const meta = await caches.open(META);
      const previous = await meta.match('/active').then((response) => response?.text());
      const keep = new Set([CACHE, META, previous ? `journal-${previous}` : '']);
      for (const name of await caches.keys()) {
        if (name.startsWith('journal-') && !keep.has(name)) await caches.delete(name);
      }
      await meta.put('/active', new Response(BUILD));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Every path is the app: the cached page, or the network the first time. ('/', not
    // '/index.html': the host redirects that, and a redirect cannot answer a navigation.)
    event.respondWith(
      caches.match('/', { cacheName: CACHE }).then((cached) => cached ?? fetch(request)),
    );
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('How was today?', {
      body: 'Pick a bean, and a few words if you have them.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'daily-reminder',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return;
      }
      await clients.openWindow('/');
    })(),
  );
});
