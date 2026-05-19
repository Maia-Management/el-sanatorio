/**
 * ============================================================
 * EL SANATORIO S.A.S.
 * NIT: 902.051.563-5
 * Cookie Consent Banner — Google Consent Mode v2 Compatible
 * ============================================================
 *
 * INTEGRATION ORDER (CRITICAL — READ BEFORE DEPLOYING):
 * 1. Load THIS script first, before any Google/Meta tags
 * 2. GTM or gtag.js snippet comes AFTER this script
 * 3. Meta Pixel snippet comes AFTER this script
 *
 * Add to <head>:
 *   <script src="/consent-banner.js"></script>
 *   <!-- then GTM or gtag.js -->
 *   <!-- then Meta Pixel -->
 *
 * FOOTER LINK ("Gestionar cookies"):
 *   <a href="#" onclick="MaiaConsent.reopenBanner(); return false;">
 *     Gestionar cookies
 *   </a>
 *
 * NOTES:
 * - Legal entity : EL SANATORIO S.A.S.
 * - NIT          : 902.051.563-5
 * - Address      : Calle 19 #4-23, Centro Histórico,
 *                  Santa Marta, Magdalena, Colombia
 * - Contact      : hola@el-sanatorio.com
 * - Complies with Ley 1581 de 2012 (Colombia) & GDPR basics
 * - Consent Mode v2: ad_storage, analytics_storage,
 *   ad_user_data, ad_personalization
 * ============================================================
 */

(function (window, document) {
  'use strict';

  var CONFIG = {
    storageKey:      'maia_consent',
    version:         '1.1.0',
    expiryMs:        15552000000,
    privacyPolicyUrl: '/privacidad',
    colors: {
      navy:       '#1B2A4A',
      blue:       '#2E75B6',
      white:      '#FFFFFF',
      lightBlue:  '#E8F0F8',
      textMuted:  '#8fa3c0',
      overlay:    'rgba(27,42,74,0.55)'
    },
    signals: {
      GRANTED: 'granted',
      DENIED:  'denied'
    },
    google: {
      analyticsId: 'G-JZGDBW5K7Q',
      adsId: '',
      conversionSendTo: ''
    }
  };

  /* ── 1. DATAAYER / GTAG BOOTSTRAP ── */
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  window.gtag('consent', 'default', {
    'ad_storage':          'denied',
    'analytics_storage':   'denied',
    'ad_user_data':        'denied',
    'ad_personalization':  'denied',
    'wait_for_update':     500
  });
  window.dataLayer.push({
    'event':                        'consent_default_set',
    'consent_ad_storage':           'denied',
    'consent_analytics_storage':    'denied',
    'consent_ad_user_data':         'denied',
    'consent_ad_personalization':   'denied'
  });

  /* ── 2. STORAGE HELPERS ── */
  var Storage = {
    save: function (prefs) {
      var record = {
        version:   CONFIG.version,
        timestamp: new Date().getTime(),
        analytics: prefs.analytics ? true : false,
        ads:       prefs.ads       ? true : false
      };
      try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(record)); } catch (e) {}
    },
    load: function () {
      try {
        var raw = localStorage.getItem(CONFIG.storageKey);
        if (!raw) return null;
        var record = JSON.parse(raw);
        if (!record || !record.timestamp) return null;
        if (record.version !== CONFIG.version) { localStorage.removeItem(CONFIG.storageKey); return null; }
        var age = new Date().getTime() - record.timestamp;
        if (age > CONFIG.expiryMs) { localStorage.removeItem(CONFIG.storageKey); return null; }
        return record;
      } catch (e) { return null; }
    },
    clear: function () { try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {} }
  };

  /* ── 3. CONSENT DISPATCHER ── */
  var GoogleTags = {
    loaded: false,
    configuredAnalytics: false,
    configuredAds: false,
    sentThankYouConversion: false,
    shouldSendThankYouConversion: function () {
      return /\/thank-you(?:\.html)?\/?$/.test(window.location.pathname || '');
    },
    load: function (prefs) {
      if (!prefs || (!prefs.analytics && !prefs.ads)) return;

      if (!GoogleTags.loaded) {
        GoogleTags.loaded = true;
        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.google.analyticsId);
        (document.head || document.getElementsByTagName('head')[0]).appendChild(script);
        window.gtag('js', new Date());
      }

      if (prefs.analytics && !GoogleTags.configuredAnalytics) {
        GoogleTags.configuredAnalytics = true;
        window.gtag('config', CONFIG.google.analyticsId);
      }

      if (prefs.ads && CONFIG.google.adsId && !GoogleTags.configuredAds) {
        GoogleTags.configuredAds = true;
        window.gtag('config', CONFIG.google.adsId);
      }

      if (prefs.ads && CONFIG.google.conversionSendTo && GoogleTags.shouldSendThankYouConversion() && !GoogleTags.sentThankYouConversion) {
        GoogleTags.sentThankYouConversion = true;
        window.gtag('event', 'conversion', { 'send_to': CONFIG.google.conversionSendTo });
      }
    }
  };

  var ConsentDispatcher = {
    update: function (prefs) {
      var analyticsVal = prefs.analytics ? CONFIG.signals.GRANTED : CONFIG.signals.DENIED;
      var adsVal       = prefs.ads       ? CONFIG.signals.GRANTED : CONFIG.signals.DENIED;
      window.gtag('consent', 'update', {
        'analytics_storage':  analyticsVal,
        'ad_storage':         adsVal,
        'ad_user_data':       adsVal,
        'ad_personalization': adsVal
      });
      window.dataLayer.push({
        'event':                       'consent_update',
        'consent_analytics_storage':   analyticsVal,
        'consent_ad_storage':          adsVal,
        'consent_ad_user_data':        adsVal,
        'consent_ad_personalization':  adsVal,
        'consent_version':             CONFIG.version,
        'consent_timestamp':           new Date().getTime()
      });
      GoogleTags.load(prefs);
      ConsentDispatcher._dispatchFbq(prefs.ads);
    },
    _dispatchFbq: function (granted) {
      var action = granted ? 'grant' : 'revoke';
      var retries = 0;
      function tryFbq() {
        if (typeof window.fbq === 'function') { window.fbq('consent', action); }
        else if (retries++ < 10) { setTimeout(tryFbq, 300); }
      }
      tryFbq();
    }
  };

  /* ── 4. RESTORE RETURNING USER ── */
  var _existingConsent = Storage.load();
  if (_existingConsent) {
    ConsentDispatcher.update({ analytics: _existingConsent.analytics, ads: _existingConsent.ads });
  }

  /* ── 5. CSS INJECTION ── */
  function injectStyles() {
    var css = '#maia-consent-overlay{position:fixed;top:0;left:0;width:100%;height:100%;overflow:hidden;background:rgba(27,42,74,0.55);z-index:2147483646;display:flex;align-items:flex-end;justify-content:center;font-family:Arial,Helvetica,sans-serif}' +
      '#maia-consent-banner{background:#1B2A4A;color:#fff;width:100%;max-width:900px;max-height:calc(100vh - 24px);max-height:calc(100svh - 24px);overflow-y:auto;border-radius:12px 12px 0 0;padding:24px 28px 20px;box-shadow:0 -4px 32px rgba(0,0,0,0.35);box-sizing:border-box;font-size:14px;line-height:1.55}' +
      '#maia-consent-banner .mcb-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}' +
      '#maia-consent-banner .mcb-title{font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.25;font-weight:700;color:#fff;margin:0;letter-spacing:0;text-transform:none}' +
      '#maia-consent-banner .mcb-logo{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#8fa3c0;text-align:right;line-height:1.3;letter-spacing:0;text-transform:none}' +
      '#maia-consent-banner .mcb-body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#c8d8ec;margin:0 0 16px;overflow-wrap:anywhere;letter-spacing:0;text-transform:none}' +
      '#maia-consent-banner .mcb-body a{color:#E8F0F8;text-decoration:underline}' +
      '#maia-consent-banner .mcb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px}' +
      '#maia-consent-banner .mcb-btn{border:none;cursor:pointer;border-radius:6px;padding:10px 20px;font-size:14px;line-height:1.2;font-weight:600;font-family:Arial,Helvetica,sans-serif;transition:opacity .15s,transform .1s;white-space:nowrap;letter-spacing:0;text-transform:none}' +
      '#maia-consent-banner .mcb-btn:hover{opacity:.88}' +
      '#maia-consent-banner .mcb-btn-accept{background:#2E75B6;color:#fff}' +
      '#maia-consent-banner .mcb-btn-reject{background:transparent;color:#E8F0F8;border:1.5px solid #2E75B6}' +
      '#maia-consent-banner .mcb-btn-custom{background:transparent;color:#8fa3c0;border:1.5px solid #374f6e}' +
      '#maia-consent-banner .mcb-btn-save{background:#2E75B6;color:#fff;margin-top:8px}' +
      '#maia-consent-panel{display:none;margin-top:16px;border-top:1px solid #2c3f5e;padding-top:16px}' +
      '#maia-consent-panel.mcb-open{display:block}' +
      '#maia-consent-panel .mcb-category{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid #22334d}' +
      '#maia-consent-panel .mcb-category:last-child{border-bottom:none}' +
      '#maia-consent-panel .mcb-cat-info{flex:1;padding-right:16px}' +
      '#maia-consent-panel .mcb-cat-title{font-weight:600;color:#fff;display:block;margin-bottom:2px}' +
      '#maia-consent-panel .mcb-cat-desc{color:#8fa3c0;font-size:12px}' +
      '.mcb-toggle-wrap{display:flex;align-items:center;flex-shrink:0}' +
      '.mcb-toggle{position:relative;width:44px;height:24px;display:inline-block}' +
      '.mcb-toggle input{opacity:0;width:0;height:0;position:absolute}' +
      '.mcb-toggle-slider{position:absolute;inset:0;background:#2c3f5e;border-radius:24px;cursor:pointer;transition:background .2s}' +
      '.mcb-toggle-slider:before{content:"";position:absolute;width:18px;height:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:transform .2s}' +
      '.mcb-toggle input:checked+.mcb-toggle-slider{background:#2E75B6}' +
      '.mcb-toggle input:checked+.mcb-toggle-slider:before{transform:translateX(20px)}' +
      '.mcb-toggle input:disabled+.mcb-toggle-slider{opacity:.55;cursor:not-allowed}' +
      '.mcb-always-on{font-size:11px;color:#8fa3c0;margin-left:8px;white-space:nowrap}' +
      '#maia-consent-banner .mcb-footer-note{font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.45;color:#BFD2EA;margin-top:10px;overflow-wrap:anywhere;letter-spacing:0;text-transform:none}' +
      '@media(max-width:600px){#maia-consent-banner{width:calc(100% - 24px);max-width:none;max-height:calc(100vh - 16px);max-height:calc(100svh - 16px);margin:0 12px;padding:16px 14px 12px;border-radius:10px 10px 0 0;font-size:13px;line-height:1.45}#maia-consent-banner .mcb-title{font-size:16px}#maia-consent-banner .mcb-body{font-size:13px;line-height:1.45}#maia-consent-banner .mcb-header{flex-direction:column;align-items:flex-start;gap:4px}#maia-consent-banner .mcb-actions{flex-direction:column}#maia-consent-banner .mcb-btn{width:100%;text-align:center;padding:9px 16px;white-space:normal}}';
    var style = document.createElement('style');
    style.id = 'maia-consent-styles';
    style.appendChild(document.createTextNode(css));
    (document.head || document.getElementsByTagName('head')[0]).appendChild(style);
  }

  /* ── 6. HTML INJECTION ── */
  function buildCategory(titleText, descText, inputId, checked, disabled) {
    var row = document.createElement('div'); row.className = 'mcb-category';
    var info = document.createElement('div'); info.className = 'mcb-cat-info';
    var catTitle = document.createElement('span'); catTitle.className = 'mcb-cat-title'; catTitle.textContent = titleText;
    var catDesc = document.createElement('span'); catDesc.className = 'mcb-cat-desc'; catDesc.textContent = descText;
    info.appendChild(catTitle); info.appendChild(catDesc);
    var toggleWrap = document.createElement('div'); toggleWrap.className = 'mcb-toggle-wrap';
    var label = document.createElement('label'); label.className = 'mcb-toggle'; label.setAttribute('for', inputId); label.setAttribute('aria-label', titleText);
    var input = document.createElement('input'); input.type = 'checkbox'; input.id = inputId; input.checked = checked; input.disabled = disabled;
    var slider = document.createElement('span'); slider.className = 'mcb-toggle-slider';
    label.appendChild(input); label.appendChild(slider); toggleWrap.appendChild(label);
    if (disabled) { var ao = document.createElement('span'); ao.className = 'mcb-always-on'; ao.textContent = 'Siempre activas'; toggleWrap.appendChild(ao); }
    row.appendChild(info); row.appendChild(toggleWrap);
    return row;
  }

  function injectHTML() {
    var overlay = document.createElement('div'); overlay.id = 'maia-consent-overlay';
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label','Preferencias de cookies');
    var banner = document.createElement('div'); banner.id = 'maia-consent-banner';
    var header = document.createElement('div'); header.className = 'mcb-header';
    var title = document.createElement('h2'); title.className = 'mcb-title'; title.textContent = 'Preferencias de cookies';
    var logo = document.createElement('div'); logo.className = 'mcb-logo'; logo.innerHTML = 'EL SANATORIO S.A.S.<br>NIT 902.051.563-5';
    header.appendChild(title); header.appendChild(logo);
    var body = document.createElement('p'); body.className = 'mcb-body';
    body.innerHTML = 'Utilizamos cookies propias y de terceros para mejorar tu experiencia, analizar el tr\u00e1fico y personalizar el contenido y la publicidad. Conforme a la <strong>Ley 1581 de 2012</strong> (Colombia), puedes aceptar todas las cookies, rechazar las opcionales o personalizar tu elecci\u00f3n. Consulta nuestra <a href="' + CONFIG.privacyPolicyUrl + '" target="_blank" rel="noopener noreferrer">Pol\u00edtica de Privacidad</a> para m\u00e1s informaci\u00f3n.';
    var actions = document.createElement('div'); actions.className = 'mcb-actions';
    var btnAccept = document.createElement('button'); btnAccept.className = 'mcb-btn mcb-btn-accept'; btnAccept.id = 'mcb-accept-all'; btnAccept.type = 'button'; btnAccept.textContent = 'Aceptar todo';
    var btnReject = document.createElement('button'); btnReject.className = 'mcb-btn mcb-btn-reject'; btnReject.id = 'mcb-reject-all'; btnReject.type = 'button'; btnReject.textContent = 'Rechazar';
    var btnCustom = document.createElement('button'); btnCustom.className = 'mcb-btn mcb-btn-custom'; btnCustom.id = 'mcb-open-custom'; btnCustom.type = 'button'; btnCustom.setAttribute('aria-expanded','false'); btnCustom.setAttribute('aria-controls','maia-consent-panel'); btnCustom.textContent = 'Personalizar \u25be';
    actions.appendChild(btnAccept); actions.appendChild(btnReject); actions.appendChild(btnCustom);
    var panel = document.createElement('div'); panel.id = 'maia-consent-panel';
    panel.appendChild(buildCategory('Cookies necesarias','Esenciales para el funcionamiento del sitio web. No pueden desactivarse.','mcb-toggle-necessary',true,true));
    panel.appendChild(buildCategory('Cookies de an\u00e1lisis','Nos ayudan a entender c\u00f3mo interact\u00faas con el sitio (Google Analytics). Activan: analytics_storage.','mcb-toggle-analytics',false,false));
    panel.appendChild(buildCategory('Cookies de publicidad','Se usan para ofrecerte anuncios relevantes (Google Ads, Meta Pixel). Activan: ad_storage, ad_user_data, ad_personalization.','mcb-toggle-ads',false,false));
    var btnSave = document.createElement('button'); btnSave.className = 'mcb-btn mcb-btn-save'; btnSave.id = 'mcb-save-custom'; btnSave.type = 'button'; btnSave.textContent = 'Guardar preferencias';
    panel.appendChild(btnSave);
    var footerNote = document.createElement('p'); footerNote.className = 'mcb-footer-note';
    footerNote.innerHTML = 'EL SANATORIO S.A.S. \u2014 NIT 902.051.563-5 \u2014 Calle 19 #4-23, Centro Hist\u00f3rico, Santa Marta, Magdalena, Colombia. Puedes cambiar tus preferencias en cualquier momento desde el pie de p\u00e1gina.';
    banner.appendChild(header); banner.appendChild(body); banner.appendChild(actions); banner.appendChild(panel); banner.appendChild(footerNote);
    overlay.appendChild(banner); document.body.appendChild(overlay);
  }

  /* ── 7. BANNER CONTROLLER ── */
  var BannerController = {
    overlay: null, panel: null, btnCustom: null,
    init: function () {
      this.overlay = document.getElementById('maia-consent-overlay');
      this.panel   = document.getElementById('maia-consent-panel');
      this.btnCustom = document.getElementById('mcb-open-custom');
      this.bindEvents();
    },
    bindEvents: function () {
      var self = this;
      var btnA = document.getElementById('mcb-accept-all');
      if (btnA) btnA.onclick = function () { self.handleConsent({ analytics: true, ads: true }); };
      var btnR = document.getElementById('mcb-reject-all');
      if (btnR) btnR.onclick = function () { self.handleConsent({ analytics: false, ads: false }); };
      if (self.btnCustom) self.btnCustom.onclick = function () { self.togglePanel(); };
      var btnS = document.getElementById('mcb-save-custom');
      if (btnS) btnS.onclick = function () {
        var ac = document.getElementById('mcb-toggle-analytics');
        var ad = document.getElementById('mcb-toggle-ads');
        self.handleConsent({ analytics: ac ? ac.checked : false, ads: ad ? ad.checked : false });
      };
    },
    togglePanel: function () {
      var isOpen = this.panel.className.indexOf('mcb-open') !== -1;
      this.panel.className = isOpen ? this.panel.className.replace(/\bmcb-open\b/,'') : this.panel.className + ' mcb-open';
      this.btnCustom.textContent = isOpen ? 'Personalizar \u25be' : 'Personalizar \u25b4';
      this.btnCustom.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
    },
    handleConsent: function (prefs) {
      Storage.save(prefs);
      ConsentDispatcher.update(prefs);
      this.hideBanner();
    },
    hideBanner: function () {
      var overlay = this.overlay;
      if (!overlay) return;
      overlay.style.transition = 'opacity .3s ease';
      overlay.style.opacity = '0';
      setTimeout(function () { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 320);
    },
    showBanner: function () {
      var existing = document.getElementById('maia-consent-overlay');
      if (!existing) { injectHTML(); this.init(); } else { existing.style.opacity = '1'; existing.style.display = 'flex'; }
    }
  };

  /* ── 8. PUBLIC API ── */
  window.MaiaConsent = {
    reopenBanner: function () { Storage.clear(); BannerController.showBanner(); },
    getConsent:   function () { return Storage.load(); },
    setConsent:   function (prefs) { Storage.save(prefs); ConsentDispatcher.update(prefs); }
  };

  /* ── 9. BOOTSTRAP ── */
  function bootstrap() {
    if (_existingConsent) return;
    injectStyles();
    injectHTML();
    BannerController.init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener ? document.addEventListener('DOMContentLoaded', bootstrap) : document.attachEvent('onreadystatechange', function () { if (document.readyState === 'complete') bootstrap(); });
  } else {
    bootstrap();
  }

}(window, document));
