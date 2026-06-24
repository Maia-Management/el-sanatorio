/* push-fcm.js — El Sanatorio web push subscriber
 *
 * PIVOTED 2026-06-23 PM from Firebase SDK to raw Web Push Protocol +
 * Service Worker. This implementation doesn't need Firebase SDK at all —
 * service-worker pushManager.subscribe + VAPID public key is sufficient.
 *
 * Flow:
 *   1. Page loads → consent banner check
 *   2. After 25s on page or 50% scroll → show Hortensia-themed prompt
 *   3. Accept → register /firebase-messaging-sw.js → permission prompt →
 *      pushManager.subscribe({ applicationServerKey: VAPID_PUB }) →
 *      get subscription object (endpoint + p256dh + auth keys)
 *   4. Soft phone capture
 *   5. POST { endpoint, p256dh, auth, phone, name, locale, page, utm, ua, tz }
 *      to /api/push-subscribe → stored in Supabase
 *
 * The variable + file names retain "fcm" prefix for git history clarity,
 * but the implementation no longer touches FCM — it's standard Web Push.
 */

(() => {
  'use strict';
  if (!('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return;

  const DISMISS_KEY = 'sanatorio_push_dismissed_until';
  const SUB_KEY = 'sanatorio_push_subscribed';
  const NOW = Date.now();
  const DAY = 86400_000;

  try {
    if (localStorage.getItem(SUB_KEY) === '1') return;
    const dismissed = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    if (dismissed && dismissed > NOW) return;
  } catch {}

  function consentGiven() {
    // Pass-6 fix: also bail if the consent banner is still rendered + visible
    // in DOM (means user hasn't interacted yet). Stops push prompt from firing
    // ON TOP of the consent banner on first visit.
    const banner = document.querySelector('.maia-consent, #consent-banner, .consent-banner');
    if (banner && banner.offsetParent !== null) return false;
    if (typeof window.MaiaConsent === 'undefined') {
      return /maia_consent=(accepted|partial)/.test(document.cookie);
    }
    if (typeof window.MaiaConsent.hasConsent === 'function') {
      return window.MaiaConsent.hasConsent('analytics') || window.MaiaConsent.hasConsent('marketing');
    }
    return true;
  }

  // ────────────────────────────────────────────────────────────────────
  // VAPID + endpoint helpers
  // ────────────────────────────────────────────────────────────────────
  async function loadConfig() {
    const res = await fetch('/firebase-config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('config fetch failed');
    const cfg = await res.json();
    if (!cfg?.vapidKey || cfg.vapidKey === 'REPLACE_ME') throw new Error('VAPID key not provisioned');
    return cfg;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  // ────────────────────────────────────────────────────────────────────
  // Prompt UI
  // ────────────────────────────────────────────────────────────────────
  const isEnglish = (document.documentElement.lang || '').toLowerCase().startsWith('en');
  const STRINGS = isEnglish ? {
    title: 'Want me to ping you?',
    body: 'Hortensia will message your phone about launch night, last-minute Friday cancellations, and the practice-nights invite. No spam — just the moments that matter.',
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

  // ────────────────────────────────────────────────────────────────────
  // Subscribe — raw Web Push Protocol via pushManager
  // ────────────────────────────────────────────────────────────────────
  async function subscribe() {
    let cfg;
    try { cfg = await loadConfig(); }
    catch (e) { console.warn('[push] config unavailable:', e.message); return; }

    if (Notification.permission === 'denied') return;
    if (Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        try { localStorage.setItem(DISMISS_KEY, String(NOW + 30 * DAY)); } catch {}
        return;
      }
    }

    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    // Get or create the push subscription
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.vapidKey),
      });
    }

    // Extract keys for server-side encryption
    const subJson = subscription.toJSON();
    const endpoint = subJson.endpoint;
    const p256dh = subJson.keys?.p256dh;
    const auth = subJson.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      console.warn('[push] subscription missing endpoint/keys');
      return;
    }

    const contactInfo = await askPhoneOptional();

    const payload = {
      endpoint,
      p256dh,
      auth,
      locale: isEnglish ? 'en' : 'es-CO',
      page: location.pathname,
      utm: readUtm(),
      ua: navigator.userAgent.slice(0, 200),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      phone: contactInfo.phone || null,
      name: contactInfo.name || null,
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

  // ────────────────────────────────────────────────────────────────────
  // Optional phone capture — appears after the user accepted push.
  // ────────────────────────────────────────────────────────────────────
  function askPhoneOptional() {
    return new Promise((resolve) => {
      const ENG = isEnglish ? {
        title: 'One more thing — your phone (optional)',
        body: 'If you give me your WhatsApp, Hortensia can also reach you there about last-minute openings. We never spam, and STOP works.',
        ph_name: 'Your name',
        ph_phone: '+57 300 000 0000',
        skip: 'Skip',
        save: 'Save',
      } : {
        title: 'Una cosita más — tu teléfono (opcional)',
        body: 'Si me das tu WhatsApp, Hortensia también te puede avisar por ahí cuando se abren cupos. No spam, y PARAR funciona siempre.',
        ph_name: 'Tu nombre',
        ph_phone: '+57 300 000 0000',
        skip: 'Saltar',
        save: 'Guardar',
      };
      injectStyle();
      const root = document.createElement('div');
      root.className = 'hp-push';
      root.innerHTML = `
        <button class="hp-push__close" aria-label="cerrar" type="button">✕</button>
        <p class="hp-push__title">${ENG.title}</p>
        <p class="hp-push__body">${ENG.body}</p>
        <div class="hp-push__field"><input class="hp-push__input" type="text" placeholder="${ENG.ph_name}" name="name" autocomplete="name" maxlength="80"></div>
        <div class="hp-push__field"><input class="hp-push__input" type="tel" placeholder="${ENG.ph_phone}" name="phone" inputmode="tel" autocomplete="tel" maxlength="30"></div>
        <div class="hp-push__row" style="margin-top:10px;">
          <button class="hp-push__btn" type="button" data-skip>${ENG.skip}</button>
          <button class="hp-push__btn hp-push__btn--primary" type="button" data-save>${ENG.save}</button>
        </div>
      `;
      if (!document.getElementById('hp-push-extra')) {
        const ex = document.createElement('style');
        ex.id = 'hp-push-extra';
        ex.textContent = `
          .hp-push__field { margin: 8px 0; }
          .hp-push__input { width: 100%; padding: 9px 10px; background: rgba(0,0,0,0.4);
            border: 1px solid rgba(217,98,30,0.3); color: #efe3c8; border-radius: 4px;
            font-family: inherit; font-size: 0.92rem; }
          .hp-push__input:focus { outline: 2px solid rgba(217,98,30,0.6); }
        `;
        document.head.appendChild(ex);
      }
      document.body.appendChild(root);
      requestAnimationFrame(() => root.classList.add('is-open'));
      const finish = (result) => {
        root.classList.remove('is-open');
        setTimeout(() => root.remove(), 260);
        resolve(result);
      };
      root.querySelector('[data-skip]').addEventListener('click', () => finish({ phone: '', name: '' }));
      root.querySelector('.hp-push__close').addEventListener('click', () => finish({ phone: '', name: '' }));
      root.querySelector('[data-save]').addEventListener('click', () => {
        const phone = root.querySelector('input[name=phone]').value.trim();
        const name = root.querySelector('input[name=name]').value.trim();
        finish({ phone, name });
      });
      setTimeout(() => finish({ phone: '', name: '' }), 25_000);
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Trigger
  // ────────────────────────────────────────────────────────────────────
  let triggered = false;
  function trigger() {
    if (triggered) return;
    if (!consentGiven()) return;
    triggered = true;
    showPrompt();
  }
  setTimeout(() => trigger(), 25_000);
  let lastScroll = 0;
  function onScroll() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    if (h <= 0) return;
    const pct = window.scrollY / h;
    if (pct > 0.5) trigger();
    lastScroll = NOW;
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  if (!consentGiven()) {
    const poll = setInterval(() => { if (consentGiven()) clearInterval(poll); }, 2000);
    setTimeout(() => clearInterval(poll), 120_000);
  }
})();
