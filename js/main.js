/* ============================================================
   EL SANATORIO — Main JavaScript
   ============================================================ */

(function () {
  'use strict';

  /* ── js-ready flag (enables CSS scroll animations) ────────── */
  document.documentElement.classList.add('js-ready', 'js-loaded');

  /* ── Reduced motion preference ───────────────────────────── */
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Nav scroll ──────────────────────────────────────────── */
  const nav = document.querySelector('.nav');
  if (nav) {
    const onScroll = () => {
      nav.classList.toggle('scrolled', window.scrollY > 60);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ── Mobile nav toggle ───────────────────────────────────── */
  const toggle = document.querySelector('.nav__toggle');
  const mobileMenu = document.querySelector('.nav__mobile-menu');
  if (toggle && mobileMenu) {
    toggle.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      // Animate hamburger
      const spans = toggle.querySelectorAll('span');
      if (open) {
        spans[0].style.transform = 'translateY(6px) rotate(45deg)';
        spans[1].style.opacity  = '0';
        spans[2].style.transform = 'translateY(-6px) rotate(-45deg)';
      } else {
        spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
      }
    });
    // Close on link click
    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        toggle.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
      });
    });
  }

  /* ── Active nav link ─────────────────────────────────────── */
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav__links a, .nav__mobile-menu a').forEach(link => {
    const href = (link.getAttribute('href') || '').replace(/\/$/, '') || '/';
    if (href === currentPath) {
      link.classList.add('active');
    }
  });

  /* ── Fade-in on scroll ───────────────────────────────────── */
  const fadeEls = document.querySelectorAll('.fade-in-section');
  if (fadeEls.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    fadeEls.forEach(el => observer.observe(el));
  }

  /* ── Typewriter effect ───────────────────────────────────── */
  function typewriter(el, speed = 60) {
    const text  = el.dataset.text || el.textContent;
    const delay = parseInt(el.dataset.delay || '0', 10);
    el.textContent = '';
    el.style.visibility = 'visible';
    let i = 0;
    setTimeout(() => {
      const timer = setInterval(() => {
        el.textContent += text[i];
        i++;
        if (i >= text.length) clearInterval(timer);
      }, speed);
    }, delay);
  }

  // Init typewriter elements once visible
  const typeEls = document.querySelectorAll('[data-typewriter]');
  if (typeEls.length) {
    const twObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          typewriter(entry.target);
          twObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    typeEls.forEach(el => {
      el.style.visibility = 'hidden';
      twObserver.observe(el);
    });
  }

  /* ── Heart monitor SVG ───────────────────────────────────── */
  // Dynamic EKG path generation
  function buildEkgPath(width, height) {
    const mid = height / 2;
    // One EKG cycle
    return [
      `M 0,${mid}`,
      `L ${width * 0.1},${mid}`,
      `L ${width * 0.15},${mid - height * 0.1}`,
      `L ${width * 0.2},${mid + height * 0.15}`,
      `L ${width * 0.22},${mid - height * 0.5}`,  // spike up
      `L ${width * 0.25},${mid + height * 0.35}`,  // spike down
      `L ${width * 0.3},${mid}`,
      `L ${width * 0.38},${mid}`,
      `L ${width * 0.42},${mid - height * 0.1}`,
      `L ${width * 0.46},${mid}`,
      `L ${width * 0.6},${mid}`,
      `L ${width * 0.65},${mid - height * 0.1}`,
      `L ${width * 0.7},${mid + height * 0.15}`,
      `L ${width * 0.72},${mid - height * 0.5}`,
      `L ${width * 0.75},${mid + height * 0.35}`,
      `L ${width * 0.8},${mid}`,
      `L ${width},${mid}`
    ].join(' ');
  }

  document.querySelectorAll('.nav__monitor svg').forEach(svg => {
    const path = svg.querySelector('.ekg-line');
    if (!path) return;
    const w = svg.getBoundingClientRect().width || 300;
    const h = 36;
    const d = buildEkgPath(w, h);
    path.setAttribute('d', d);
    // Set dasharray to path length
    const len = path.getTotalLength ? path.getTotalLength() : 400;
    path.style.strokeDasharray  = len;
    path.style.strokeDashoffset = len;
  });

  /* ── Glitch effect on hover ──────────────────────────────── */
  document.querySelectorAll('[data-glitch]').forEach(el => {
    const original = el.textContent;
    const chars    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let interval   = null;

    el.addEventListener('mouseenter', () => {
      let steps = 0;
      interval = setInterval(() => {
        el.textContent = original.split('').map((c, i) => {
          if (c === ' ') return ' ';
          return steps > i * 1.5
            ? original[i]
            : chars[Math.floor(Math.random() * chars.length)];
        }).join('');
        steps++;
        if (steps > original.length * 2) {
          el.textContent = original;
          clearInterval(interval);
        }
      }, 40);
    });

    el.addEventListener('mouseleave', () => {
      clearInterval(interval);
      el.textContent = original;
    });
  });

  /* ── Parallax hero ───────────────────────────────────────── */
  const heroContent = document.querySelector('.hero__content');
  if (heroContent && !prefersReducedMotion) {
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      heroContent.style.transform = `translateY(${scrollY * 0.2}px)`;
      heroContent.style.opacity   = String(1 - scrollY / window.innerHeight * 1.5);
    }, { passive: true });
  }

  /* ── Form UX ─────────────────────────────────────────────── */
  // Generate a fake reference number for the form
  document.querySelectorAll('.form-panel__ref').forEach(el => {
    const ref = 'REF-' + String(Math.floor(Math.random() * 90000) + 10000) + '-013';
    el.textContent = ref;
  });

  // Netlify form submission feedback
  document.querySelectorAll('form[data-netlify]').forEach(form => {
    form.addEventListener('submit', function (e) {
      const btn = form.querySelector('.form-submit');
      if (btn) {
        btn.textContent = 'PROCESANDO...';
        btn.style.opacity = '0.7';
      }
    });
  });

  /* ── Smooth scroll for anchor links ──────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        const navH = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-h'), 10) || 72;
        const y = target.getBoundingClientRect().top + window.scrollY - navH;
        window.scrollTo({ top: y, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      }
    });
  });

  /* ── Ambient audio hint (commented — enable if desired) ─── */
  // const audioTrigger = document.getElementById('audio-trigger');
  // if (audioTrigger) {
  //   audioTrigger.addEventListener('click', () => { ... });
  // }

})();
