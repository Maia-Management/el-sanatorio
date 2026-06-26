/* maia-track.js — unified conversion event bus for El Sanatorio
 *
 * Exposes window.maiaTrack(name, props) — fires to all loaded ad/analytics
 * stacks simultaneously: GA4, Meta Pixel, Meta CAPI (server-side), and
 * the Supabase audit log via /api/track-conversion.
 *
 * Auto-instruments:
 *   - page_view (on load)
 *   - scroll_50 / scroll_90
 *   - wa_clicked (any wa.me link click, captures pre-fill keyword)
 *   - hortensia_open (chat bubble clicked)
 *   - hortensia_message_sent (chat form submit)
 *   - estimator_change / estimator_submit
 *   - ficha_submit (Tu Ficha "ASIGNAR PACIENTE")
 *   - cuidadores_check
 *   - prescripcion_complete
 *   - waitlist_signup / casting_apply / contact_submit (on form success)
 *   - wompi_deposit_clicked
 *
 * Designed to no-op gracefully when GA / Pixel / CAPI not configured.
 */

(() => {
  'use strict';

  const SESSION_ID_KEY = 'maia_session_id';
  let sessionId;
  try {
    sessionId = sessionStorage.getItem(SESSION_ID_KEY);
    if (!sessionId) {
      sessionId = 'sx-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_ID_KEY, sessionId);
    }
  } catch { sessionId = 'sx-anon'; }

  // ──────────────────────────────────────────────────────────────────
  // UTM read (set by /js/maia-utm.js on first hit)
  // ──────────────────────────────────────────────────────────────────
  function readUtm() {
    try {
      const s = sessionStorage.getItem('maia_utm') || localStorage.getItem('maia_utm_persist');
      if (s) return JSON.parse(s);
    } catch {}
    return null;
  }

  // ──────────────────────────────────────────────────────────────────
  // Consent gate — only fire to GA/Pixel/CAPI when Maia consent given
  // ──────────────────────────────────────────────────────────────────
  function consentGiven(kind) {
    if (typeof window.MaiaConsent === 'undefined') {
      return /maia_consent=(accepted|partial)/.test(document.cookie);
    }
    if (typeof window.MaiaConsent.hasConsent === 'function') {
      return window.MaiaConsent.hasConsent(kind || 'analytics');
    }
    return true;
  }

  // ──────────────────────────────────────────────────────────────────
  // Track
  // ──────────────────────────────────────────────────────────────────
  function maiaTrack(name, props) {
    props = props || {};
    const eventProps = {
      ...props,
      page_location: location.pathname,
      page_title: document.title.slice(0, 100),
      session_id: sessionId,
      locale: (document.documentElement.lang || 'es-CO'),
      ts: new Date().toISOString(),
    };
    // Vert OS sub-brand tagging (2026-06-26 — La Farmacia launch).
    // Any page that wants its events bucketed under a sub-brand sets
    // window.MAIA_SUB_BRAND (and optionally MAIA_SURFACE) before this
    // script loads. Tags are merged into EVERY outbound event so the
    // canonical event log can filter by sub_brand without rewriting it
    // per-event at the call site.
    try {
      if (window.MAIA_SUB_BRAND && !eventProps.sub_brand) {
        eventProps.sub_brand = String(window.MAIA_SUB_BRAND).slice(0, 32);
      }
      if (window.MAIA_SURFACE && !eventProps.surface) {
        eventProps.surface = String(window.MAIA_SURFACE).slice(0, 64);
      }
    } catch {}
    const utm = readUtm();
    if (utm) Object.assign(eventProps, utm);

    // GA4
    if (consentGiven('analytics') && typeof window.gtag === 'function') {
      try { window.gtag('event', name, props); } catch {}
    }
    // Meta Pixel
    if (consentGiven('marketing') && typeof window.fbq === 'function') {
      try {
        // Standard event map — fall back to CustomEvent for non-standard
        const STANDARD = {
          page_view: 'PageView',
          waitlist_signup: 'Lead',
          casting_apply: 'CompleteRegistration',
          contact_submit: 'Lead',
          push_subscribed: 'Subscribe',
          estimator_submit: 'InitiateCheckout',
          wompi_deposit_clicked: 'AddPaymentInfo',
          hortensia_open: 'Contact',
        };
        const mapped = STANDARD[name];
        if (mapped) window.fbq('track', mapped, props);
        else window.fbq('trackCustom', name, props);
      } catch {}
    }
    // Server-side relay (CAPI + audit log)
    if (consentGiven('analytics')) {
      // Use sendBeacon if available — non-blocking, survives unload
      try {
        const body = JSON.stringify({ name, props: eventProps });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/track-conversion', new Blob([body], { type: 'application/json' }));
        } else {
          fetch('/api/track-conversion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {}
    }
  }

  window.maiaTrack = maiaTrack;

  // ──────────────────────────────────────────────────────────────────
  // Auto-instrumentation
  // ──────────────────────────────────────────────────────────────────
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  ready(() => {
    // page_view
    maiaTrack('page_view', { path: location.pathname });

    // scroll_50 / scroll_90
    const scrollFired = { 50: false, 90: false };
    function onScroll() {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      if (h <= 0) return;
      const pct = (window.scrollY / h) * 100;
      if (pct >= 50 && !scrollFired[50]) { scrollFired[50] = true; maiaTrack('scroll_50'); }
      if (pct >= 90 && !scrollFired[90]) { scrollFired[90] = true; maiaTrack('scroll_90'); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // WhatsApp link clicks (event delegation)
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href*="wa.me"]');
      if (!a) return;
      const href = a.getAttribute('href');
      const url = new URL(a.href);
      const prefill = url.searchParams.get('text') || '';
      const keyword = a.dataset.estWompi != null ? 'wompi_deposit'
        : /reservar|reserve|booking|book/i.test(a.innerText) ? 'reservar'
        : /chuzo/i.test(a.innerText) ? 'chuzo'
        : 'general';
      maiaTrack('wa_clicked', {
        cta_text: a.innerText.trim().slice(0, 50),
        intent: keyword,
        has_prefill: prefill.length > 0,
        page_section: a.closest('section')?.id || null,
      });
      if (a.dataset.estWompi != null || /wompi/.test(href)) {
        maiaTrack('wompi_deposit_clicked', { intent: keyword });
      }
    }, true);

    // Hortensia open + send
    document.addEventListener('click', (e) => {
      if (e.target.closest('.hortensia__bubble')) {
        maiaTrack('hortensia_open');
      }
    }, true);
    document.addEventListener('submit', (e) => {
      if (e.target.closest('.hortensia__form')) {
        maiaTrack('hortensia_message_sent');
      }
    }, true);

    // Estimator interactions
    const estTier = document.querySelector('#est-tier');
    const estSize = document.querySelector('#est-size');
    if (estTier && estSize) {
      let lastFire = 0;
      const fire = () => {
        const now = Date.now();
        if (now - lastFire < 800) return; // debounce
        lastFire = now;
        maiaTrack('estimator_change', { tier: estTier.value, size: estSize.value });
      };
      estTier.addEventListener('change', fire);
      estSize.addEventListener('input', fire);
    }
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-est-wa], [data-est-wompi]')) {
        const tier = document.querySelector('#est-tier')?.value;
        const size = document.querySelector('#est-size')?.value;
        maiaTrack('estimator_submit', { tier, size, kind: e.target.closest('[data-est-wompi]') ? 'wompi' : 'whatsapp' });
      }
    }, true);

    // Ficha — listen for "ASIGNAR PACIENTE" click
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn && /ASIGNAR PACIENTE|ASSIGN PATIENT/i.test(btn.innerText)) {
        maiaTrack('ficha_submit');
      }
    }, true);

    // Cuidadores eligibility check
    document.addEventListener('submit', (e) => {
      if (e.target.matches('form.fpc')) {
        const cat = document.querySelector('#fpc-cat')?.value;
        const size = document.querySelector('#fpc-size')?.value;
        maiaTrack('cuidadores_check', { category: cat, size });
      }
    }, true);

    // Prescripcion quiz — when last "REPETIR/REPEAT" or "RESERVAR TRATAMIENTO" appears
    // Watch DOM for the "TU PRESCRIPCIÓN" result text appearing.
    if (/\/tools\/prescripcion/.test(location.pathname)) {
      const observer = new MutationObserver(() => {
        if (/DIAGN[ÓO]STICO|DIAGNOSIS/.test(document.body.innerText)) {
          maiaTrack('prescripcion_complete');
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });
})();
