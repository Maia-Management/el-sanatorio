/**
 * site-cta.js — El Sanatorio sticky mobile Reservar CTA
 *
 * Injects a 64px crimson bar fixed to the bottom of the viewport on mobile
 * (≤ 880px), dismissible via a small × button. State persists in
 * localStorage for 24h so a dismiss on Monday doesn't reappear the same
 * evening but returns Tuesday.
 *
 * Self-contained: writes its own <style> block and DOM. To add to a page,
 * include this one line just before </body>:
 *   <script src="/js/site-cta.js?v=20260701a" defer></script>
 *
 * Auto-skips:
 *   - /reservar/ + /en/reservar/       (already on the target page)
 *   - dismissed within last 24h        (localStorage flag)
 *   - viewports > 880px                (CSS media query — desktop unaffected)
 *
 * Language detection mirrors site-nav.js so ES/EN copy matches whatever
 * page the user is on.
 */

(function () {
  'use strict';

  var STORE_KEY = 'sanatorio.cta.dismissed_at';
  var DISMISS_MS = 24 * 60 * 60 * 1000; // 24h
  var path = window.location.pathname || '/';
  var isEN = /^\/en(\/|$)/.test(path);

  // Skip if already on /reservar/ (any language variant).
  if (/\/reservar\/?$/.test(path)) return;

  // Skip if user dismissed within last 24h.
  try {
    var raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      var ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && (Date.now() - ts) < DISMISS_MS) return;
    }
  } catch (e) { /* localStorage blocked — proceed */ }

  var COPY = isEN
    ? { cta: '▶ Book ticket $60,000', dismiss: 'Dismiss', ariaLabel: 'Dismiss booking prompt' }
    : { cta: '▶ Comprar boleto $60.000', dismiss: 'Cerrar', ariaLabel: 'Cerrar aviso de reserva' };

  var HREF = isEN ? '/en/reservar/' : '/reservar/';

  function mount() {
    // Guard against double-injection on hot reload / repeat script tags.
    if (document.getElementById('site-cta')) return;

    var style = document.createElement('style');
    style.setAttribute('data-site-cta', '');
    style.textContent = [
      '#site-cta{',
      '  position:fixed;left:0;right:0;bottom:0;z-index:900;',
      '  height:64px;padding:0 16px;',
      '  display:none;align-items:center;gap:12px;',
      '  background:#B91C1C;', /* ER red — mirrors --sn-crimson */
      '  border-top:1px solid rgba(0,0,0,0.35);',
      '  box-shadow:0 -8px 20px rgba(0,0,0,0.35);',
      '  color:#fff;',
      '  font-family:\'Share Tech Mono\', \'JetBrains Mono\', ui-monospace, monospace;',
      '  transform:translateY(0);transition:transform 220ms ease-out;',
      '  padding-bottom:env(safe-area-inset-bottom,0);',
      '  box-sizing:content-box;',
      '}',
      '#site-cta.site-cta--hidden{transform:translateY(120%);pointer-events:none;}',
      '#site-cta .site-cta__link{',
      '  flex:1;display:flex;align-items:center;justify-content:center;',
      '  min-height:44px;',
      '  color:#fff;text-decoration:none;',
      '  font-size:15px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;',
      '}',
      '#site-cta .site-cta__link:focus-visible{outline:2px solid #fff;outline-offset:3px;}',
      '#site-cta .site-cta__close{',
      '  flex:0 0 44px;height:44px;width:44px;',
      '  display:flex;align-items:center;justify-content:center;',
      '  background:transparent;border:1px solid rgba(255,255,255,0.35);',
      '  border-radius:6px;color:#fff;',
      '  font-family:inherit;font-size:20px;line-height:1;cursor:pointer;',
      '}',
      '#site-cta .site-cta__close:hover{background:rgba(255,255,255,0.1);}',
      '#site-cta .site-cta__close:focus-visible{outline:2px solid #fff;outline-offset:2px;}',
      '@media (max-width: 880px){',
      '  #site-cta{display:flex;}',
      /* Give bottom of page enough padding so the sticky bar never covers
         the final content or the footer's inner controls. */
      '  body{padding-bottom:64px;padding-bottom:calc(64px + env(safe-area-inset-bottom,0));}',
      '}',
    ].join('\n');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'site-cta';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', isEN ? 'Booking' : 'Reserva');

    var link = document.createElement('a');
    link.className = 'site-cta__link';
    link.href = HREF;
    link.textContent = COPY.cta;
    link.setAttribute('data-cta', 'sticky-reservar');
    bar.appendChild(link);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'site-cta__close';
    close.setAttribute('aria-label', COPY.ariaLabel);
    close.textContent = '×';
    close.addEventListener('click', function () {
      bar.classList.add('site-cta--hidden');
      try { localStorage.setItem(STORE_KEY, String(Date.now())); }
      catch (e) { /* localStorage blocked — silent */ }
      // Also remove the body padding so the extra space disappears too.
      document.body.style.paddingBottom = '';
      // Fully remove after transition so it can't grab focus.
      setTimeout(function () { bar.remove(); }, 260);
    });
    bar.appendChild(close);

    document.body.appendChild(bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
