/**
 * /js/account.js
 *
 * Customer identity layer for el-sanatorio.com — used on every customer page.
 *
 * Responsibilities:
 *   1. Detect an existing Supabase Auth session (silent — no UI).
 *   2. Expose window.MaiaAccount.{ getCustomer, signInWithGoogle, signOut, isReady }.
 *   3. Open the "Únete al Sanatorio" modal on demand (or on first QR-scan visit).
 *   4. Compute a privacy-preserving device fingerprint hash (no 3rd-party libs).
 *
 * Loaded as a normal script tag. Supabase JS pulled from CDN — no bundler.
 *
 * Requires the page to set:
 *   <meta name="supabase-url" content="https://nxgndsnxugcevwriljlv.supabase.co">
 *   <meta name="supabase-anon-key" content="...">
 *
 * (anon key is OK to expose — it's the public key, RLS is the real gate.)
 */
(function () {
  'use strict';

  function metaContent(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  var SUPABASE_URL = metaContent('supabase-url');
  var SUPABASE_ANON_KEY = metaContent('supabase-anon-key');
  var SB_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

  var state = {
    ready: false,
    supabase: null,
    session: null,
    customer: null, // populated by /api/auth/me
    fingerprint: null,
  };

  function loadSupabaseClient() {
    return import(SB_CDN).then(function (mod) {
      var client = mod.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'sb-nxgndsnxugcevwriljlv-auth-token',
        },
      });
      state.supabase = client;
      return client.auth.getSession();
    });
  }

  /**
   * sha256(ua + accept_language + screen_resolution + tz_offset)
   * No third-party libs. Best-effort return-recognition only.
   */
  function computeFingerprint() {
    try {
      var s = [
        navigator.userAgent || '',
        navigator.language || (navigator.languages && navigator.languages[0]) || '',
        (screen.width || 0) + 'x' + (screen.height || 0),
        String(new Date().getTimezoneOffset()),
      ].join('|');
      if (window.crypto && window.crypto.subtle) {
        var enc = new TextEncoder().encode(s);
        return window.crypto.subtle.digest('SHA-256', enc).then(function (buf) {
          return Array.from(new Uint8Array(buf))
            .map(function (b) { return b.toString(16).padStart(2, '0'); })
            .join('');
        });
      }
      return Promise.resolve(null);
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function callApi(path, body) {
    var token = null;
    try {
      var raw = localStorage.getItem('sb-nxgndsnxugcevwriljlv-auth-token');
      if (raw) {
        var parsed = JSON.parse(raw);
        token = parsed && parsed.access_token ? parsed.access_token : null;
      }
    } catch (e) {}
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : null,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { status: r.status, body: j };
      });
    });
  }

  function fetchMe() {
    return callApi('/api/auth/me').then(function (resp) {
      if (resp.status === 200 && resp.body && resp.body.customer_id) {
        state.customer = resp.body;
        return resp.body;
      }
      if (resp.status === 200 && resp.body && resp.body.pending_upsert) {
        // Session is valid but row not upserted yet. Force completion.
        return runUpsert();
      }
      return null;
    });
  }

  function runUpsert(consents) {
    consents = consents || {};
    return computeFingerprint().then(function (fp) {
      state.fingerprint = fp;
      return callApi('/api/customer-account-upsert', {
        habeas_data_consent: !!consents.habeas_data_consent,
        terms_consent: !!consents.terms_consent,
        device_fingerprint_hash: fp,
      }).then(function (resp) {
        if (resp.status === 200 && resp.body && resp.body.customer_id) {
          state.customer = resp.body;
          dispatch('maia:customer-ready', resp.body);
          return resp.body;
        }
        return null;
      });
    });
  }

  function dispatch(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || null }));
    } catch (e) {}
  }

  function signInWithGoogle(consents) {
    if (!state.supabase) return Promise.reject(new Error('supabase_not_ready'));
    // Cache consents so the callback page can pass them to the upsert.
    try {
      sessionStorage.setItem('maia_pending_consents', JSON.stringify(consents || {}));
      sessionStorage.setItem('maia_post_signin_return', location.pathname + location.search);
    } catch (e) {}
    return state.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + '/auth/callback/',
        queryParams: { prompt: 'select_account' },
      },
    });
  }

  function signOut() {
    if (!state.supabase) return Promise.resolve();
    state.customer = null;
    return state.supabase.auth.signOut().then(function () {
      dispatch('maia:customer-signed-out');
    });
  }

  // ── Modal ───────────────────────────────────────────────────────────────
  function injectModalDom() {
    if (document.getElementById('maia-account-modal')) return;
    var html =
      '<div id="maia-account-modal" class="maia-modal" role="dialog" aria-modal="true" aria-labelledby="maia-modal-title" hidden>' +
      '  <div class="maia-modal-backdrop" data-close></div>' +
      '  <div class="maia-modal-card">' +
      '    <button class="maia-modal-close" aria-label="Cerrar" data-close>&times;</button>' +
      '    <h2 id="maia-modal-title">ÚNETE AL SANATORIO</h2>' +
      '    <p class="maia-modal-sub">Accede al WiFi + juega los dados con tu cuenta. Te reconocemos la próxima vez.</p>' +
      '    <button type="button" class="maia-google-btn" id="maia-google-btn">' +
      '      <span class="maia-google-icon" aria-hidden="true">' +
      '        <svg viewBox="0 0 18 18" width="18" height="18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>' +
      '      </span>' +
      '      <span>Continuar con Google</span>' +
      '    </button>' +
      '    <label class="maia-consent">' +
      '      <input type="checkbox" id="maia-consent-habeas" required>' +
      '      <span>Autorizo el tratamiento de mis datos conforme a la <a href="/privacidad" target="_blank" rel="noopener">Política de Privacidad</a> (Ley 1581 de 2012).</span>' +
      '    </label>' +
      '    <label class="maia-consent">' +
      '      <input type="checkbox" id="maia-consent-terms" required>' +
      '      <span>Acepto los <a href="/terminos" target="_blank" rel="noopener">Términos y Condiciones</a>.</span>' +
      '    </label>' +
      '    <p class="maia-modal-error" id="maia-modal-error" aria-live="polite"></p>' +
      '    <p class="maia-modal-footer">EL SANATORIO S.A.S. · Santa Marta</p>' +
      '  </div>' +
      '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstElementChild);

    document.querySelectorAll('#maia-account-modal [data-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    document.getElementById('maia-google-btn').addEventListener('click', function () {
      var hd = document.getElementById('maia-consent-habeas').checked;
      var tc = document.getElementById('maia-consent-terms').checked;
      var err = document.getElementById('maia-modal-error');
      err.textContent = '';
      if (!hd || !tc) {
        err.textContent = 'Por favor acepta ambas políticas para continuar.';
        return;
      }
      signInWithGoogle({
        habeas_data_consent: hd,
        terms_consent: tc,
      }).catch(function (e) {
        err.textContent = 'No pudimos abrir Google. Intenta de nuevo.';
        console.warn('[MaiaAccount] signin failed', e);
      });
    });
  }

  function openModal() {
    injectModalDom();
    document.getElementById('maia-account-modal').removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    var el = document.getElementById('maia-account-modal');
    if (el) el.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[MaiaAccount] missing supabase-url / supabase-anon-key meta tags');
    return;
  }

  loadSupabaseClient()
    .then(function (res) {
      state.session = res && res.data && res.data.session ? res.data.session : null;
      state.ready = true;
      dispatch('maia:ready', { has_session: !!state.session });
      if (state.session) return fetchMe();
      return null;
    })
    .catch(function (e) {
      console.warn('[MaiaAccount] init failed', e);
      state.ready = true;
      dispatch('maia:ready', { has_session: false });
    });

  window.MaiaAccount = {
    isReady: function () { return state.ready; },
    getCustomer: function () { return state.customer; },
    getSession: function () { return state.session; },
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    openModal: openModal,
    closeModal: closeModal,
    fetchMe: fetchMe,
    runUpsert: runUpsert,
  };
})();
