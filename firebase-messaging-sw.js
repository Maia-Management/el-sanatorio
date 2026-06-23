/* Firebase Cloud Messaging service worker — handles background push for El Sanatorio.
 * Must live at the site root so Chrome registers it with scope "/".
 * Reads Firebase config from /firebase-config.json (fetched once at install).
 *
 * Background message → shows themed notification with rust-orange brand color.
 * Click → opens the link from data.url (or homepage).
 */

importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

const CONFIG_URL = '/firebase-config.json';

// Fetched + cached at install
let firebaseInited = false;

async function initFromConfig() {
  if (firebaseInited) return;
  try {
    const res = await fetch(CONFIG_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`config fetch ${res.status}`);
    const cfg = await res.json();
    firebase.initializeApp(cfg.firebase);
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const n = payload.notification || {};
      const d = payload.data || {};
      const title = n.title || d.title || 'El Sanatorio';
      const opts = {
        body: n.body || d.body || '',
        icon: n.icon || '/favicon.svg',
        badge: '/favicon.svg',
        image: n.image || d.image,
        tag: d.tag || 'sanatorio',
        data: { url: d.url || n.click_action || '/', ...d },
        actions: d.actions ? JSON.parse(d.actions) : undefined,
        requireInteraction: d.requireInteraction === 'true',
        vibrate: [200, 100, 200],
      };
      return self.registration.showNotification(title, opts);
    });
    firebaseInited = true;
  } catch (e) {
    // Silently fail — the page can still work without push.
    console.warn('[sw] Firebase init failed:', e?.message || e);
  }
}

// Initialize on install + activate so background messages can be received.
self.addEventListener('install', (e) => {
  e.waitUntil(initFromConfig().then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(initFromConfig().then(() => self.clients.claim()));
});

// Click → navigate to data.url, focus existing tab if open.
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
