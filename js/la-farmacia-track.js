/* la-farmacia-track.js — Vert OS instrumentation specific to /la-farmacia/
 * (and the /en/la-farmacia/ mirror).
 *
 * Loaded AFTER /js/maia-track.js, so window.maiaTrack() is available.
 * Every event we fire here carries `sub_brand: 'la_farmacia'` because
 * we also set window.MAIA_SUB_BRAND = 'la_farmacia' in the page <head>
 * (maia-track.js merges that tag into every event automatically).
 *
 * Fires:
 *   lf_menu_section_view  — when a menu section (A Chuzo / B Prescripciones /
 *                           C Sushi Pop / D Postres / E Bebidas) becomes
 *                           visible. Limits one event per section per page
 *                           load. Backed by IntersectionObserver.
 *   lf_order_intent       — when the user clicks a WhatsApp CTA on a La
 *                           Farmacia page. This is the booking/reservation
 *                           funnel signal Vert reads.
 *   lf_dice_cta_view      — when the "Tira los dados" teaser comes into view
 *                           (downstream attribution for the comp loop).
 *
 * Soft-fails silently — never throws, never blocks.
 */
(function () {
  'use strict';

  function safeTrack(name, props) {
    try {
      if (typeof window.maiaTrack === 'function') {
        window.maiaTrack(name, props || {});
      }
    } catch (_e) { /* swallow */ }
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    // ── 1. Explicit page-level surface ping (carries sub_brand + surface) ──
    safeTrack('lf_page_loaded', {
      path: location.pathname,
      lang: document.documentElement.lang || 'es',
    });

    // ── 2. Section-view tracking via IntersectionObserver ──
    var fired = Object.create(null);
    var SECTION_LABELS = {
      'chuzo-tokyo':   'A_chuzo_tokyo',
      'prescripciones':'B_prescripciones',
      'sushi-pop':     'C_sushi_pop',
      'postres':       'D_postres',
      'bebidas':       'E_bebidas',
      'dados':         'star_dados',
    };

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e.isIntersecting) continue;
          var id = e.target.id;
          if (!id || fired[id]) continue;
          fired[id] = true;
          if (id === 'dados') {
            safeTrack('lf_dice_cta_view', { section_id: id });
          } else {
            safeTrack('lf_menu_section_view', {
              section_id: id,
              section_label: SECTION_LABELS[id] || id,
            });
          }
        }
      }, { rootMargin: '0px 0px -40% 0px', threshold: 0.18 });

      Object.keys(SECTION_LABELS).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) io.observe(el);
      });
    }

    // ── 3. Order / reservation intent on WhatsApp CTA click ──
    // maia-track.js already fires `wa_clicked` for every wa.me link, but on
    // La Farmacia we ALSO want a dedicated `lf_order_intent` event so the
    // Vert dashboard can count La Farmacia booking attempts as a funnel.
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href*="wa.me"]') : null;
      if (!a) return;
      var text = (a.innerText || '').trim().slice(0, 80);
      var section = a.closest('section') ? a.closest('section').id : null;
      var isFloat = a.classList.contains('whatsapp-float');
      var intent = isFloat ? 'float_reserve'
        : /admisi|admission|reserv|book/i.test(text) ? 'reserve'
        : 'general';
      safeTrack('lf_order_intent', {
        intent: intent,
        cta_text: text,
        cta_section: section,
        is_float_button: isFloat,
      });
    }, true);
  });
})();
