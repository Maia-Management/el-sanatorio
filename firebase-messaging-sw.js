/* Service worker for web push — El Sanatorio
 * PIVOTED 2026-06-23 PM: doesn't use Firebase SDK anymore.
 * Standard Web Push Protocol — listens for push events + shows notifications.
 */

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'El Sanatorio', body: event.data?.text() || '' };
  }
  const title = payload.title || 'El Sanatorio';
  const opts = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.svg',
    badge: payload.badge || '/favicon.svg',
    image: payload.image,
    tag: payload.tag || 'sanatorio',
    data: { url: payload.data?.url || payload.url || '/', ...(payload.data || {}) },
    requireInteraction: payload.requireInteraction === true,
    vibrate: payload.vibrate || [200, 100, 200],
    actions: payload.actions,
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.origin === self.location.origin) {
          await c.focus();
          c.postMessage({ type: 'push-click', url });
          return;
        }
      } catch {}
    }
    await self.clients.openWindow(url);
  })());
});
