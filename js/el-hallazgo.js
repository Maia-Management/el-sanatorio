/**
 * El Sanatorio — EL HALLAZGO chronicle (photo gallery variant)
 * 2026-06-21 — vanilla JS, no third-party dependencies.
 *
 * Responsibilities:
 *   1. Scroll-driven fade-in for .hz-piece via IntersectionObserver
 *   2. Active-year gutter marker tracking
 *   3. Transcription toggle (per-piece)
 *   4. Lightbox open/close + keyboard handling
 *   5. Easter-egg corner peel — keyboard accessible (also CSS-driven on hover)
 *   6. prefers-reduced-motion fallback path
 *
 * All listeners are passive where possible. Total size budget ≤ 8 KB.
 */

(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────────────────────────────────────────────────────────────────
  // 1. Scroll-driven fade-in
  // ───────────────────────────────────────────────────────────────────
  var pieces = document.querySelectorAll('.hz-piece');

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    // Reduced motion — show everything immediately
    pieces.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObs.unobserve(entry.target);
        }
      });
    }, {
      rootMargin: '0px 0px -10% 0px',
      threshold: 0.08
    });
    pieces.forEach(function (el) { revealObs.observe(el); });
  }

  // ───────────────────────────────────────────────────────────────────
  // 2. Year gutter — active marker tracking
  // ───────────────────────────────────────────────────────────────────
  var gutterMarkers = document.querySelectorAll('[data-year-marker]');
  var markerMap = {};
  gutterMarkers.forEach(function (el) { markerMap[el.dataset.yearMarker] = el; });

  if ('IntersectionObserver' in window && gutterMarkers.length) {
    var yearObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var year = entry.target.dataset.year;
        if (!year) return;
        Object.keys(markerMap).forEach(function (key) {
          if (key === year) markerMap[key].classList.add('is-active');
          else markerMap[key].classList.remove('is-active');
        });
      });
    }, {
      rootMargin: '-40% 0px -40% 0px',
      threshold: 0
    });
    pieces.forEach(function (el) {
      if (el.dataset.year) yearObs.observe(el);
    });
  }

  // ───────────────────────────────────────────────────────────────────
  // 3. Transcription toggle
  // ───────────────────────────────────────────────────────────────────
  var toggles = document.querySelectorAll('[data-transcribe-toggle]');
  toggles.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('aria-controls');
      var target = document.getElementById(targetId);
      if (!target) return;
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (open) {
        target.setAttribute('hidden', '');
        btn.lastChild.nodeValue = 'Mostrar transcripción';
      } else {
        target.removeAttribute('hidden');
        btn.lastChild.nodeValue = 'Ocultar transcripción';
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // 4. Lightbox
  // ───────────────────────────────────────────────────────────────────
  var lightbox = document.getElementById('hz-lightbox');
  var lightboxImg = lightbox ? lightbox.querySelector('[data-lightbox-img]') : null;
  var lightboxCaption = lightbox ? lightbox.querySelector('[data-lightbox-caption]') : null;
  var lightboxClose = lightbox ? lightbox.querySelector('[data-lightbox-close]') : null;
  var lastFocused = null;

  function openLightbox(src, caption, alt) {
    if (!lightbox || !lightboxImg) return;
    lastFocused = document.activeElement;
    lightboxImg.src = src;
    lightboxImg.alt = alt || '';
    if (lightboxCaption) lightboxCaption.textContent = caption || '';
    lightbox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    // focus the close button so Esc/keyboard close path works
    setTimeout(function () { if (lightboxClose) lightboxClose.focus(); }, 50);
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.classList.remove('is-open');
    document.body.style.overflow = '';
    // clear src after transition to prevent download
    setTimeout(function () {
      if (lightboxImg && !lightbox.classList.contains('is-open')) {
        lightboxImg.removeAttribute('src');
        lightboxImg.alt = '';
      }
    }, 360);
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  document.querySelectorAll('[data-lightbox]').forEach(function (frame) {
    // Frame is the trigger; click anywhere in the photo opens lightbox
    frame.addEventListener('click', function (ev) {
      // Don't intercept clicks on the easter-egg corner inside the frame
      if (ev.target.closest('[data-secret]')) return;
      var src = frame.dataset.img;
      var caption = frame.dataset.caption;
      var imgEl = frame.querySelector('img');
      var alt = imgEl ? imgEl.alt : '';
      if (src) openLightbox(src, caption, alt);
    });
    // keyboard support — Enter / Space on the frame
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('role', 'button');
    var label = frame.dataset.caption || 'Ver documento ampliado';
    frame.setAttribute('aria-label', 'Ampliar: ' + label);
    frame.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        var src = frame.dataset.img;
        var caption = frame.dataset.caption;
        var imgEl = frame.querySelector('img');
        var alt = imgEl ? imgEl.alt : '';
        if (src) openLightbox(src, caption, alt);
      }
    });
  });

  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightbox) {
    lightbox.addEventListener('click', function (ev) {
      // click on backdrop (not on the inner img/caption) closes
      if (ev.target === lightbox) closeLightbox();
    });
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && lightbox && lightbox.classList.contains('is-open')) {
      closeLightbox();
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // 5. Easter egg — torn-corner reveal (keyboard accessible)
  // ───────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-secret]').forEach(function (btn) {
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      btn.classList.toggle('is-open');
    });
    btn.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        btn.classList.toggle('is-open');
      }
    });
  });

})();
