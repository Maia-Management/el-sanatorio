/* ===========================================================================
 * QR Menu runtime · El Sanatorio
 * ---------------------------------------------------------------------------
 * Loaded by /menu/chuzo, /menu/bar, /experience.
 * Adds: hero video safe-autoplay, WhatsApp pre-fill, sound toggle, language
 * toggle, cart accumulator, scan tracker (cookieless beacon, opt-in only).
 * No external deps. <8KB minified.
 * =========================================================================== */
(function () {
  "use strict";

  // ── Hero video: hold for poster paint, then swap when ready ────────
  function bootHeroVideo() {
    var videos = document.querySelectorAll(".qr-hero__media.is-video");
    videos.forEach(function (v) {
      // Respect prefers-reduced-motion
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        v.remove();
        return;
      }
      // Bail on save-data
      if (navigator.connection && navigator.connection.saveData) {
        v.remove();
        return;
      }
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      v.loop = true;
      var playPromise = v.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.then(function () { v.classList.add("loaded"); }).catch(function () {
          // Autoplay denied — leave poster up. User can tap the sound button to try again.
        });
      } else {
        v.classList.add("loaded");
      }
    });
  }

  // ── Sound toggle ────────────────────────────────────────────────────
  function bootSoundToggle() {
    var btn = document.querySelector(".qr-top__sound");
    if (!btn) return;
    var on = false;
    function paint() {
      btn.innerHTML = on
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M3 10v4h4l5 5V5L7 10H3zm13 0l-2 2 2 2-1.4 1.4L12.6 13.4 10.7 15.3 9.3 13.9 11.2 12 9.3 10.1 10.7 8.7 12.6 10.6 14.6 8.6z"/></svg>';
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Sonido activado" : "Sonido desactivado");
    }
    paint();
    btn.addEventListener("click", function () {
      on = !on;
      paint();
      document.querySelectorAll(".qr-hero__media.is-video").forEach(function (v) { v.muted = !on; });
    });
  }

  // ── Language toggle (es ↔ en, deep-link aware) ─────────────────────
  function bootLangToggle() {
    var btn = document.querySelector(".qr-top__lang");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var path = location.pathname;
      var isEn = path.indexOf("/en/") === 0;
      var next = isEn ? path.replace(/^\/en/, "") : "/en" + path;
      location.href = next;
    });
  }

  // ── Cart accumulator (in-memory only — no storage APIs) ────────────
  var cart = [];
  function cartTotal() { return cart.reduce(function (s, it) { return s + (it.price || 0) * (it.qty || 1); }, 0); }
  function cartHumanList() {
    return cart.map(function (it) {
      return it.qty + "x " + it.name + " (COP " + (it.price ? it.price.toLocaleString("es-CO") : "—") + ")";
    }).join(", ");
  }

  // ── Toast ──────────────────────────────────────────────────────────
  var toast;
  function showToast(msg) {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "qr-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("shown");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove("shown"); }, 2400);
  }

  // ── Per-item Order button → adds to cart, builds WA link ───────────
  function bootOrderButtons() {
    document.querySelectorAll("[data-order]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var item = JSON.parse(btn.getAttribute("data-order"));
        var existing = cart.filter(function (c) { return c.id === item.id; })[0];
        if (existing) existing.qty += 1; else cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
        showToast("Agregado: " + item.name + " · " + cart.reduce(function (s, c) { return s + c.qty; }, 0) + " ítems");
        updateOrderBar();
      });
    });
  }

  // ── Floating order bar (shown when cart > 0) ──────────────────────
  function updateOrderBar() {
    var bar = document.getElementById("qr-order-bar");
    if (!bar) return;
    if (cart.length === 0) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.querySelector("[data-cart-count]").textContent = cart.reduce(function (s, c) { return s + c.qty; }, 0);
    bar.querySelector("[data-cart-total]").textContent = "COP " + cartTotal().toLocaleString("es-CO");
  }

  // ── Send-to-WhatsApp from cart ──────────────────────────────────────
  function sendOrderToWhatsApp() {
    if (cart.length === 0) return;
    var tmpl = document.body.getAttribute("data-wa-order-template") ||
               "Hola Doctor, quiero pedir: {ORDER} — Total: COP {TOTAL}. ¿Confirmo y pago por Wompi?";
    var msg = tmpl.replace("{ORDER}", cartHumanList()).replace("{TOTAL}", cartTotal().toLocaleString("es-CO"));
    var wa = document.body.getAttribute("data-wa-link") || "https://wa.me/19034598763";
    var url = wa + (wa.indexOf("?") >= 0 ? "&" : "?") + "text=" + encodeURIComponent(msg);
    window.open(url, "_blank", "noopener");
  }

  // ── Single-item Quick Order ("Pedir 1" inline) ─────────────────────
  function bootQuickOrder() {
    document.querySelectorAll("[data-quick-order]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        var item = JSON.parse(btn.getAttribute("data-quick-order"));
        var tmpl = document.body.getAttribute("data-wa-order-template") ||
                   "Hola Doctor, quiero pedir: {ORDER} — Total: COP {TOTAL}. ¿Confirmo y pago por Wompi?";
        var humanLine = "1x " + item.name + " (COP " + (item.price ? item.price.toLocaleString("es-CO") : "—") + ")";
        var msg = tmpl.replace("{ORDER}", humanLine).replace("{TOTAL}", (item.price || 0).toLocaleString("es-CO"));
        var wa = document.body.getAttribute("data-wa-link") || "https://wa.me/19034598763";
        var url = wa + (wa.indexOf("?") >= 0 ? "&" : "?") + "text=" + encodeURIComponent(msg);
        window.open(url, "_blank", "noopener");
      });
    });
  }

  // ── QR scan tracker (cookieless beacon to Netlify Function) ───────
  function trackScan() {
    var slug = document.body.getAttribute("data-qr-slug");
    if (!slug) return;
    var params = new URLSearchParams(location.search);
    var qrSrc = params.get("qr");
    if (!qrSrc) return; // only track if scanned via a QR (?qr=… on URL)
    try {
      var img = new Image();
      img.src = "/.netlify/functions/qr-track?slug=" + encodeURIComponent(slug) + "&qr=" + encodeURIComponent(qrSrc) + "&t=" + Date.now();
    } catch (_) {}
  }

  // ── Boot ───────────────────────────────────────────────────────────
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    bootHeroVideo();
    bootSoundToggle();
    bootLangToggle();
    bootOrderButtons();
    bootQuickOrder();
    updateOrderBar();
    trackScan();
    // Expose for the floating order bar button
    var sendBtn = document.querySelector("[data-send-order]");
    if (sendBtn) sendBtn.addEventListener("click", function (e) { e.preventDefault(); sendOrderToWhatsApp(); });
    // Service worker for offline PWA (best-effort)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/menu/sw.js").catch(function () { /* silent */ });
    }
  });
})();
