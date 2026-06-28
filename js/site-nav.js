/**
 * site-nav.js — El Sanatorio unified spine navigation
 *
 * Renders ONE canonical nav on every spine page (~20 URLs across ES + EN)
 * so the six pre-existing nav variants (cinema-nav / nav / menu-nav / qr-top
 * / hz-nav / ct-bar / audicion bespoke) stop drifting out of sync.
 *
 * Contract per cohesion brief 2026-06-28:
 *   EL SANATORIO (logo→home) · MENÚ · RESERVAR · EXPERIENCIA · HISTORIA
 *   · DÓNDE · EN/ES toggle · WhatsApp icon
 *
 * The script auto-detects:
 *   - language from URL prefix (/en/* → EN, else ES)
 *   - active section from current path (sets aria-current="page" on match)
 *   - EN/ES toggle target by swapping the URL prefix
 *
 * Pages with bespoke nav DO NOT load this script:
 *   - el-hallazgo / en/the-finding (hz-nav lore microsite)
 *   - chuzo-tokyo / en/chuzo-tokyo (bright sub-brand)
 *   - menu/bar / menu/chuzo (QR table menus)
 *   - 404, feedback, wifi, auth/callback (utility)
 *
 * Mount point: any page that wants the nav must include
 *   <div id="site-nav" data-active="reservar"></div>
 *   <script src="/js/site-nav.js?v=20260628a" defer></script>
 * and remove its inline <nav class="cinema-nav|nav|menu-nav">…</nav>.
 *
 * The `data-active` attribute is optional — if absent, the script falls back
 * to URL-path inference.
 */

(function () {
  'use strict';

  var WA_HREF = 'https://wa.me/19034598763';

  // Language detection from current pathname
  var path = window.location.pathname || '/';
  var isEN = /^\/en(\/|$)/.test(path);
  var lang = isEN ? 'en' : 'es';

  // Canonical URL map per language (single source of truth)
  var URLS = {
    es: {
      home:        '/',
      menu:        '/menu/',
      reservar:    '/reservar/',
      experiencia: '/experience',
      historia:    '/historia',
      donde:       '/contact'
    },
    en: {
      home:        '/en/',
      menu:        '/en/menu/',
      reservar:    '/en/reservar/',
      experiencia: '/en/experience/',
      historia:    '/en/history/',
      donde:       '/en/contact/'
    }
  };

  // Labels per language
  var LABELS = {
    es: {
      brand:       'EL SANATORIO',
      menu:        'MENÚ',
      reservar:    'RESERVAR',
      experiencia: 'EXPERIENCIA',
      historia:    'HISTORIA',
      donde:       'DÓNDE',
      toggle:      'EN',
      toggleTitle: 'English',
      whatsappLabel: 'Escribir por WhatsApp',
      menuButton:  'Menú',
      skipLink:    'Saltar al contenido'
    },
    en: {
      brand:       'EL SANATORIO',
      menu:        'MENU',
      reservar:    'BOOK',
      experiencia: 'EXPERIENCE',
      historia:    'HISTORY',
      donde:       'FIND US',
      toggle:      'ES',
      toggleTitle: 'Español',
      whatsappLabel: 'Message on WhatsApp',
      menuButton:  'Menu',
      skipLink:    'Skip to main content'
    }
  };

  // EN/ES path swap — swaps prefix preserving the rest of the URL
  // where a clean equivalent exists; otherwise falls back to language home.
  var EQUIV = [
    // [es path, en path]
    ['/',              '/en/'],
    ['/index.html',    '/en/'],
    ['/menu/',         '/en/menu/'],
    ['/menu',          '/en/menu/'],
    ['/reservar/',     '/en/reservar/'],
    ['/reservar',      '/en/reservar/'],
    ['/experience',    '/en/experience/'],
    ['/experience.html','/en/experience/'],
    ['/historia',      '/en/history/'],
    ['/historia.html', '/en/history/'],
    ['/contact',       '/en/contact/'],
    ['/contact.html',  '/en/contact/'],
    ['/events',        '/en/events/'],
    ['/events.html',   '/en/events/'],
    ['/tours',         '/en/tours/'],
    ['/tours.html',    '/en/tours/'],
    ['/privacidad',    '/en/privacy/'],
    ['/privacidad.html','/en/privacy/'],
    ['/terminos',      '/en/terms/'],
    ['/terminos.html', '/en/terms/'],
    ['/el-hallazgo',   '/en/the-finding/'],
    ['/el-hallazgo.html','/en/the-finding/'],
    ['/la-farmacia/',  '/en/la-farmacia/'],
    ['/la-farmacia',   '/en/la-farmacia/'],
    ['/chuzo-tokyo/',  '/en/chuzo-tokyo/'],
    ['/chuzo-tokyo',   '/en/chuzo-tokyo/'],
    ['/gracias',       '/en/'],
    ['/gracias.html',  '/en/'],
    ['/audicion/',     '/en/'],
    ['/audicion',      '/en/']
  ];

  function altLangUrl() {
    var normalized = path.replace(/\/index\.html$/, '/');
    for (var i = 0; i < EQUIV.length; i++) {
      if (isEN) {
        if (normalized === EQUIV[i][1]) return EQUIV[i][0];
      } else {
        if (normalized === EQUIV[i][0]) return EQUIV[i][1];
      }
    }
    return isEN ? '/' : '/en/';
  }

  // Active-section inference (used when host page doesn't set data-active)
  function inferActive() {
    var p = path.replace(/\/index\.html$/, '/');
    if (/(menu|^\/menu\/?$)/.test(p) || /\/menu\//.test(p) || /\/la-farmacia\//.test(p)) return 'menu';
    if (/reservar/.test(p))      return 'reservar';
    if (/experience/.test(p))    return 'experiencia';
    if (/el-hallazgo|the-finding/.test(p)) return 'experiencia';
    if (/historia|history/.test(p)) return 'historia';
    if (/contact|donde|events|tours/.test(p)) return 'donde';
    return ''; // home — no active section
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    var mount = document.getElementById('site-nav');
    if (!mount) return;

    var active = mount.getAttribute('data-active') || inferActive();
    var u = URLS[lang];
    var L = LABELS[lang];
    var altUrl = altLangUrl();

    var items = [
      { key: 'menu',        href: u.menu,        label: L.menu },
      { key: 'reservar',    href: u.reservar,    label: L.reservar, cta: true },
      { key: 'experiencia', href: u.experiencia, label: L.experiencia },
      { key: 'historia',    href: u.historia,    label: L.historia },
      { key: 'donde',       href: u.donde,       label: L.donde }
    ];

    var linkHTML = items.map(function (it) {
      var cur = (active === it.key) ? ' aria-current="page"' : '';
      var ctaCls = it.cta ? ' class="site-nav__link site-nav__link--cta"' : ' class="site-nav__link"';
      return '<li><a href="' + escapeHTML(it.href) + '"' + ctaCls + cur + '>' + escapeHTML(it.label) + '</a></li>';
    }).join('');

    var waSVG =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" width="20" height="20">' +
      '<path d="M19.05 4.91A9.82 9.82 0 0 0 12.01 2C6.5 2 2 6.49 2 12c0 1.76.46 3.45 1.34 4.95L2 22l5.25-1.38A9.95 9.95 0 0 0 12 22c5.51 0 10-4.49 10-10 0-2.67-1.04-5.18-2.95-7.09zM12 20.16a8.13 8.13 0 0 1-4.14-1.13l-.3-.18-3.12.82.83-3.04-.19-.31A8.18 8.18 0 0 1 3.84 12c0-4.5 3.66-8.16 8.16-8.16 2.18 0 4.23.85 5.77 2.39a8.13 8.13 0 0 1 2.39 5.77c0 4.5-3.66 8.16-8.16 8.16zm4.47-6.11c-.25-.12-1.45-.71-1.67-.79-.22-.08-.39-.12-.55.12-.16.25-.62.79-.77.96-.14.16-.28.18-.53.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.39.11-.51.11-.11.25-.28.37-.42.12-.14.16-.25.25-.41.08-.16.04-.31-.02-.43-.06-.12-.55-1.34-.76-1.83-.2-.48-.4-.42-.55-.43h-.47c-.16 0-.43.06-.66.31-.22.25-.86.84-.86 2.05 0 1.21.88 2.38 1 2.54.12.16 1.74 2.65 4.21 3.72.59.25 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.45-.59 1.66-1.16.21-.57.21-1.06.14-1.16-.07-.1-.22-.16-.47-.28z"/>' +
      '</svg>';

    var html =
      '<a href="#main-content" class="site-nav__skip">' + escapeHTML(L.skipLink) + '</a>' +
      '<nav class="site-nav" role="navigation" aria-label="Primary">' +
        '<div class="site-nav__inner">' +
          '<a href="' + escapeHTML(u.home) + '" class="site-nav__brand"' + (active === '' ? ' aria-current="page"' : '') + '>' +
            '<span class="site-nav__brand-mark" aria-hidden="true">✚</span>' +
            '<span class="site-nav__brand-text">' + escapeHTML(L.brand) + '</span>' +
          '</a>' +

          '<button type="button" class="site-nav__toggle" aria-expanded="false" aria-controls="site-nav-menu" aria-label="' + escapeHTML(L.menuButton) + '">' +
            '<span class="site-nav__bar" aria-hidden="true"></span>' +
            '<span class="site-nav__bar" aria-hidden="true"></span>' +
            '<span class="site-nav__bar" aria-hidden="true"></span>' +
          '</button>' +

          '<ul id="site-nav-menu" class="site-nav__links" role="list">' +
            linkHTML +
            '<li class="site-nav__lang">' +
              '<a href="' + escapeHTML(altUrl) + '" class="site-nav__link site-nav__link--lang" hreflang="' + (isEN ? 'es' : 'en') + '" lang="' + (isEN ? 'es' : 'en') + '" aria-label="' + escapeHTML(L.toggleTitle) + '">' + escapeHTML(L.toggle) + '</a>' +
            '</li>' +
            '<li class="site-nav__wa">' +
              '<a href="' + WA_HREF + '" class="site-nav__link site-nav__link--wa" target="_blank" rel="noopener" aria-label="' + escapeHTML(L.whatsappLabel) + '">' + waSVG + '</a>' +
            '</li>' +
          '</ul>' +
        '</div>' +
      '</nav>';

    mount.innerHTML = html;
    mount.removeAttribute('aria-busy');

    // Mobile menu toggle
    var btn = mount.querySelector('.site-nav__toggle');
    var menu = mount.querySelector('.site-nav__links');
    if (btn && menu) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        menu.classList.toggle('site-nav__links--open', !open);
      });
      // Close on link click (mobile)
      menu.addEventListener('click', function (e) {
        if (e.target && e.target.tagName === 'A') {
          btn.setAttribute('aria-expanded', 'false');
          menu.classList.remove('site-nav__links--open');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
