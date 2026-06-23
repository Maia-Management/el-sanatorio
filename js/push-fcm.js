/* push-fcm.js — El Sanatorio web push (Firebase Cloud Messaging)
 *
 * Flow:
 *   1. Page loads → check if consent banner has been accepted (Maia consent)
 *      AND the browser supports Notification API AND service workers
 *   2. After 25 sec on page OR after 50% scroll, surface a themed Hortensia
 *      prompt asking permission. Decline → store 7-day dismissal cookie.
 *   3. Accept → register /firebase-messaging-sw.js → get FCM token → POST to
 *      /api/push-subscribe with token + locale + page context + UTM (if any).
 *   4. Server stores the token in Supabase (el_sanatorio_push_subscribers).
 *
 * Loaded on every page after consent-banner.js. No-ops if consent not given,
 * permission denied, or Firebase config not present.
 */

(() => {
  'use strict';
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return;

  const DISMISS_KEY = 'sanatorio_push_dismissed_until';
  const SUB_KEY = 'sanatorio_push_subscribed';
  const NOW = Date.now();
  const DAY = 86400_000;

  // Bail if already subscribed, or recently dismissed
  try {
    if (localStorage.getItem(SUB_KEY) === '1') return;
    const dismissed = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (dismissed && dismissed > NOW) return;
  } catch {}

  // Wait until consent banner has been accepted (or skipped); the global
  // window.MaiaConsent is exposed by /consent-banner.js
  function consentGiven() {
    if (typeof window.MaiaConsent === 'undefined') return false;
    if (typeof window.MaiaConsent.hasConsent === 'function') {
      return window.MaiaConsent.hasConsent('analytics') || window.MaiaConsent.hasConsent('marketing');
    }
    // Fallback: cookie set by banner
    return /maia_consent=(accepted|partial)/.test(document.cookie);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Prompt UI — themed Hortensia voice; same rust-orange palette as bubble
  // ──────────────────────────────────────────────────────────────────────
  const isEnglish = (document.documentElement.lang || '').toLowerCase().startsWith('en');
  const STRINGS = isEnglish ? {
    title: 'Want me to call you?',
    body: 'Hortensia will ping your phone for the launch night, last-minute Friday cancellations, and the practice-nights invite. No spam — just the moments that matter.',
    accept: 'Yes, ping me',
    decline: 'Not now'
  } : {
    title: '¿Le aviso al teléfono?',
    body: 'Hortensia le mando un mensajito el día de la apertura, cuando se cae una reserva del viernes, y para las noches de práctica. Sin abusar — solo lo que importa.',
    accept: 'Sí, avísame',
    decline: 'Ahora no'
  };

  function injectStyle() {
    if (document.getElementById('hp-push-style')) return;
    const s = document.createElement('style');
    s.id = 'hp-push-style';
    s.textContent = `
      .hp-push { position: fixed; bottom: 96px; right: 22px; max-width: 320px; padding: 16px 18px;
        background: rgba(20, 12, 8, 0.96); border: 1px solid rgba(217, 98, 30, 0.4);
        border-radius: 10px; color: #efe3c8; font-family: var(--font-typewriter, 'Courier Prime', monospace);
        font-size: 13px; line-height: 1.5; box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        z-index: 99998; opacity: 0; transform: translateY(8px);
        transition: opacity 240ms ease, transform 240ms ease; }
      .hp-push.is-open { opacity: 1; transform: translateY(0); }
      .hp-push__title { font-family: var(--font-display, 'Fraunces', serif); font-size: 16px;
        color: #f1ebd9; margin: 0 0 6px; letter-spacing: 0.02em; }
      .hp-push__body { margin: 0 0 12px; opacity: 0.9; }
      .hp-push__row { display: flex; gap: 8px; }
      .hp-push__btn { flex: 1; padding: 9px 12px; font-family: inherit; font-size: 12px;
        letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; border-radius: 4px;
        border: 1px solid rgba(217, 98, 30, 0.5); background: transparent; color: #efe3c8;
        transition: background 160ms ease, transform 80ms ease; }
      .hp-push__btn:hover { background: rgba(217, 98, 30, 0.12); }
      .hp-push__btn--primary { background: rgb(139, 58, 30); border-color: rgb(139, 58, 30);
        color: #fff5e8; font-weight: 600; }
      .hp-push__btn--primary:hover { background: rgb(165, 70, 36); }
      .hp-push__close { position: absolute; top: 6px; right: 8px; background: transparent; border: 0;
        color: rgba(239, 227, 200, 0.5); font-size: 16px; cursor: pointer; padding: 4px 6px; }
      .hp-push__close:hover { color: #efe3c8; }
      @media (max-width: 480px) {
        .hp-push { left: 16px; right: 16px; max-width: none; bottom: 88px; }
      }
    `;
    document.head.appendChild(s);
  }

  function showPrompt() {
    if (document.querySelector('.hp-push')) return;
    injectStyle();
    const root = document.createElement('div');
    root.className = 'hp-push';
    root.innerHTML = `
      <button class="hp-push__close" aria-label="cerrar" type="button">✕</button>
      <p class="hp-push__title">${STRINGS.title}</p>
      <p class="hp-push__body">${STRINGS.body}</p>
      <div class="hp-push__row">
        <button class="hp-push__btn" type="button" data-decline>${STRINGS.decline}</button>
        <button class="hp-push__btn hp-push__btn--primary" type="button" data-accept>${STRINGS.accept}</button>
      </div>
    `;
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('is-open'));
    function dismiss(days) {
      try { localStorage.setItem(DISMISS_KEY, String(NOW + days * DAY)); } catch {}
      root.classList.remove('is-open');
      setTimeout(() => root.remove(), 260);
    }
    root.querySelector('[data-decline]').addEventListener('click', () => dismiss(7));
    root.querySelector('.hp-push__close').addEventListener('click', () => dismiss(7));
    root.querySelector('[data-accept]').addEventListener('click', async () => {
      root.classList.remove('is-open');
      setTimeout(() => root.remove(), 260);
      await subscribe();
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Subscribe flow
  // ──────────────────────────────────────────────────────────────────────
  async function loadConfig() {
    const res = await fetch('/firebase-config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('config fetch failed');
    const cfg = await res.json();
    if (!cfg?.firebase?.apiKey || cfg.firebase.apiKey === 'REPLACE_ME') {
      throw new Error('Firebase config not provisioned');
    }
    return cfg;
  }

  async function subscribe() {
    let cfg;
    try { cfg = await loadConfig(); }
    catch (e) {
      console.warn('[push] config unavailable:', e.message);
      return;
    }

    if (Notification.permission === 'denied') return;
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        try { localStorage.setItem(DISMISS_KEY, String(NOW + 30 * DAY)); } catch {}
        return;
      }
    }

    // Register SW
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    // Dynamic import the modular SDK on the page side
    const [{ initializeApp }, { getMessaging, getToken }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js'),
    ]);
    const app = initializeApp(cfg.firebase);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg });
    if (!token) return;

    // Persist + POST
    const payload = {
      token,
      locale: isEnglish ? 'en' : 'es-CO',
      page: location.pathname,
      utm: readUtm(),
      ua: navigator.userAgent.slice(0, 200),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      created_at: new Date().toISOString(),
    };
    try {
      const r = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        try { localStorage.setItem(SUB_KEY, '1'); } catch {}
        // Fire conversion event if analytics bus is loaded
        try { window.maiaTrack?.('push_subscribed', { locale: payload.locale }); } catch {}
      }
    } catch (e) {
      console.warn('[push] subscribe POST failed:', e.message);
    }
  }

  function readUtm() {
    try {
      const stored = sessionStorage.getItem('maia_utm');
      if (stored) return JSON.parse(stored);
    } catch {}
    const u = new URL(location.href);
    const out = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      const v = u.searchParams.get(k);
      if (v) out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Trigger — fire prompt on 25s OR 50% scroll, whichever first
  // ──────────────────────────────────────────────────────────────────────
  let triggered = false;
  function trigger() {
    if (triggered) return;
    if (!consentGiven()) return;
    triggered = true;
    showPrompt();
  }

  // Time-based
  setTimeout(() => trigger(), 25_000);
  // Scroll-based
  let lastScroll = 0;
  function onScroll() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return;
    const pct = window.scrollY / h;
    if (pct > 0.5) trigger();
    lastScroll = NOW;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // If consent isn't given yet, poll for it (banner is deferred)
  if (!consentGiven()) {
    const poll = setInterval(() => {
      if (consentGiven()) clearInterval(poll);
    }, 2000);
    setTimeout(() => clearInterval(poll), 120_000);
  }
})();
