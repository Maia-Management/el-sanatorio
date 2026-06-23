/* maia-utm.js — UTM persistence + propagation
 *
 * On first hit, captures utm_source/medium/campaign/term/content/content + gclid + fbclid
 * from the URL. Stores in sessionStorage for the session AND localStorage for 30 days
 * so cross-visit attribution survives (within reasonable window).
 *
 * Then propagates to:
 *   - every wa.me link (appends params into the &text= prefill)
 *   - every form submit (injects hidden inputs)
 *
 * No-ops if no UTM detected and no stored UTM.
 */

(() => {
  'use strict';

  const SESSION_KEY = 'maia_utm';
  const PERSIST_KEY = 'maia_utm_persist';
  const TTL_DAYS = 30;
  const TRACKED = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

  // ──────────────────────────────────────────────────────────────────
  // Capture
  // ──────────────────────────────────────────────────────────────────
  function captureFromUrl() {
    const u = new URL(location.href);
    const out = {};
    for (const k of TRACKED) {
      const v = u.searchParams.get(k);
      if (v) out[k] = v.slice(0, 200);
    }
    return Object.keys(out).length ? out : null;
  }

  function readPersisted() {
    try {
      const raw = localStorage.getItem(PERSIST_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj?.expires_at && obj.expires_at < Date.now()) {
        localStorage.removeItem(PERSIST_KEY);
        return null;
      }
      return obj?.params || null;
    } catch { return null; }
  }

  function persist(params) {
    try {
      const expires_at = Date.now() + TTL_DAYS * 86400_000;
      localStorage.setItem(PERSIST_KEY, JSON.stringify({ params, expires_at }));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(params));
    } catch {}
  }

  const fresh = captureFromUrl();
  const persisted = readPersisted();
  const active = fresh || persisted; // fresh wins
  if (fresh) persist(fresh);
  else if (persisted) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(persisted)); } catch {}
  }

  if (!active) return; // nothing to do

  window.maiaUtm = active;

  // ──────────────────────────────────────────────────────────────────
  // Propagate to WhatsApp links — append a UTM line to the &text=
  // ──────────────────────────────────────────────────────────────────
  function buildUtmLine(params) {
    const parts = [];
    for (const k of TRACKED) if (params[k]) parts.push(`${k.replace('utm_', '')}=${params[k]}`);
    if (!parts.length) return '';
    return `\n\n[ref: ${parts.join(' · ')}]`;
  }

  const utmLine = buildUtmLine(active);
  if (utmLine) {
    function decorate(a) {
      if (a.dataset.utmApplied) return;
      try {
        const u = new URL(a.href);
        if (!u.hostname.includes('wa.me')) return;
        const existing = u.searchParams.get('text') || '';
        u.searchParams.set('text', existing + utmLine);
        a.href = u.toString();
        a.dataset.utmApplied = '1';
      } catch {}
    }
    function sweep() {
      document.querySelectorAll('a[href*="wa.me"]').forEach(decorate);
    }
    // Initial sweep + observe for dynamically-added wa.me links (e.g. estimator)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sweep, { once: true });
    } else sweep();
    const obs = new MutationObserver(() => sweep());
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  // ──────────────────────────────────────────────────────────────────
  // Propagate to form submits — inject hidden inputs once
  // ──────────────────────────────────────────────────────────────────
  function decorateForm(f) {
    if (f.dataset.utmInjected) return;
    f.dataset.utmInjected = '1';
    for (const k of TRACKED) {
      if (!active[k]) continue;
      if (f.querySelector(`input[name="${k}"]`)) continue;
      const i = document.createElement('input');
      i.type = 'hidden';
      i.name = k;
      i.value = active[k];
      f.appendChild(i);
    }
  }
  function sweepForms() {
    document.querySelectorAll('form').forEach(decorateForm);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweepForms, { once: true });
  } else sweepForms();
})();
