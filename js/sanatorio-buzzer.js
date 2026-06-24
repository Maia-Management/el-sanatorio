/**
 * El Sanatorio — "Llamar al mesero/a" buzzer widget.
 *
 * Drop-in: place a single <button data-sanatorio-buzzer> in markup, then
 * <script src="/js/sanatorio-buzzer.js?v=20260624" defer></script>.
 *
 * The script wires the button to a modal with optional message field and
 * POSTs to /api/sanatorio-call-waiter (Netlify _redirects proxy →
 * maia-management.com/.netlify/functions/sanatorio-call-waiter).
 *
 * Channel defaults to the page's data-buzzer-channel attribute on <body>
 * or the button itself. Table number lifted from `?t=NN` on the QR.
 *
 * Spec: ZONE-DICE-WAITER-IMPL-2026-06-24-PM.md (2026-06-24 PM).
 */
(function () {
  'use strict';

  function qs(name) {
    var p = new URLSearchParams(location.search);
    return p.get(name);
  }

  function detectChannel(btn) {
    return (btn.getAttribute('data-buzzer-channel') ||
            document.body.getAttribute('data-buzzer-channel') ||
            'menu').toLowerCase();
  }

  function tableNumber() {
    var t = parseInt(qs('t') || qs('table') || '', 10);
    if (Number.isInteger(t) && t >= 1 && t <= 24) return t;
    return null;
  }

  function injectStyles() {
    if (document.getElementById('sanatorio-buzzer-css')) return;
    var css = document.createElement('style');
    css.id = 'sanatorio-buzzer-css';
    css.textContent = [
      '.san-buzzer-btn {',
      '  display:inline-flex; align-items:center; gap:10px;',
      '  padding:14px 22px; min-height:48px;',
      '  background:linear-gradient(135deg,#D9621E 0%,#B7372D 100%);',
      '  color:#0F0D0B; border:1px solid #D9621E; border-radius:999px;',
      '  font-family:"Inter",system-ui,sans-serif; font-weight:700;',
      '  font-size:0.95rem; letter-spacing:0.04em;',
      '  cursor:pointer; text-decoration:none;',
      '  box-shadow:0 6px 20px rgba(217,98,30,0.32);',
      '  transition:transform .15s, box-shadow .15s, filter .15s;',
      '}',
      '.san-buzzer-btn:hover { transform:translateY(-1px); filter:brightness(1.07); box-shadow:0 9px 26px rgba(217,98,30,0.42); }',
      '.san-buzzer-btn:active { transform:translateY(0); }',
      '.san-buzzer-backdrop {',
      '  position:fixed; inset:0; background:rgba(8,6,4,0.88);',
      '  z-index:10000; display:flex; align-items:center; justify-content:center;',
      '  padding:16px; backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);',
      '}',
      '.san-buzzer-modal {',
      '  background:#1A1714; color:#EFE6D5; border:1px solid #D9621E;',
      '  border-radius:14px; max-width:420px; width:100%;',
      '  padding:24px 22px; box-shadow:0 24px 60px rgba(0,0,0,0.7);',
      '  font-family:"Inter",system-ui,sans-serif;',
      '}',
      '.san-buzzer-modal h3 { margin:0 0 8px; font-family:"Fraunces",Georgia,serif; font-size:1.4rem; color:#EFE6D5; }',
      '.san-buzzer-modal p { margin:0 0 14px; color:rgba(239,230,213,0.72); font-size:0.92rem; }',
      '.san-buzzer-modal label { display:block; font-size:0.78rem; letter-spacing:0.1em; text-transform:uppercase; color:#D9621E; margin-bottom:6px; }',
      '.san-buzzer-modal textarea {',
      '  width:100%; min-height:90px; padding:10px 12px;',
      '  background:#0F0D0B; color:#EFE6D5;',
      '  border:1px solid rgba(217,98,30,0.4); border-radius:8px;',
      '  font-family:inherit; font-size:0.95rem; resize:vertical;',
      '}',
      '.san-buzzer-modal textarea:focus { outline:none; border-color:#D9621E; box-shadow:0 0 0 3px rgba(217,98,30,0.2); }',
      '.san-buzzer-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; flex-wrap:wrap; }',
      '.san-buzzer-actions button {',
      '  padding:12px 20px; min-height:44px;',
      '  border-radius:999px; cursor:pointer;',
      '  font-family:inherit; font-weight:700; font-size:0.92rem;',
      '  letter-spacing:0.04em;',
      '}',
      '.san-buzzer-actions .cancel { background:transparent; color:rgba(239,230,213,0.72); border:1px solid rgba(239,230,213,0.32); }',
      '.san-buzzer-actions .submit { background:linear-gradient(135deg,#D9621E 0%,#B7372D 100%); color:#0F0D0B; border:1px solid #D9621E; }',
      '.san-buzzer-actions .submit:disabled { opacity:0.5; cursor:wait; }',
      '.san-buzzer-status { margin-top:12px; font-size:0.86rem; font-family:"Share Tech Mono",monospace; letter-spacing:0.05em; }',
      '.san-buzzer-status.ok  { color:#7DD3A8; }',
      '.san-buzzer-status.err { color:#ff4d6d; }',
      ''
    ].join('\n');
    document.head.appendChild(css);
  }

  function openModal(btn) {
    var channel = detectChannel(btn);
    var bd = document.createElement('div');
    bd.className = 'san-buzzer-backdrop';
    bd.innerHTML = [
      '<div class="san-buzzer-modal" role="dialog" aria-modal="true" aria-labelledby="san-buzzer-h3">',
      '  <h3 id="san-buzzer-h3">Llamar al mesero/a</h3>',
      '  <p>El mesero más cercano verá tu mesa marcada en el panel del piso. Si quieres puedes dejar un mensaje corto.</p>',
      '  <label for="san-buzzer-msg">¿Algo específico? (opcional)</label>',
      '  <textarea id="san-buzzer-msg" maxlength="240" placeholder="Ej. otra ronda de yakitori, falta un cubierto, agua para la mesa…"></textarea>',
      '  <div class="san-buzzer-status" id="san-buzzer-status" aria-live="polite"></div>',
      '  <div class="san-buzzer-actions">',
      '    <button type="button" class="cancel" id="san-buzzer-cancel">Cancelar</button>',
      '    <button type="button" class="submit" id="san-buzzer-submit">🛎 Llamar</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(bd);
    var msg    = bd.querySelector('#san-buzzer-msg');
    var status = bd.querySelector('#san-buzzer-status');
    var cancel = bd.querySelector('#san-buzzer-cancel');
    var submit = bd.querySelector('#san-buzzer-submit');

    function close() {
      try { document.body.removeChild(bd); } catch (_) {}
    }
    cancel.onclick = close;
    bd.addEventListener('click', function (e) { if (e.target === bd) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
    setTimeout(function () { try { msg.focus(); } catch (_) {} }, 30);

    submit.onclick = function () {
      submit.disabled = true;
      status.className = 'san-buzzer-status';
      status.textContent = 'Llamando...';
      var payload = {
        channel: channel,
        table_number: tableNumber(),
        message: (msg.value || '').trim() || null,
      };
      fetch('/api/sanatorio-call-waiter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (res) {
          if (res.ok) {
            status.className = 'san-buzzer-status ok';
            status.textContent = '✓ Listo. Un mesero va para tu mesa.';
            setTimeout(close, 1600);
          } else if (res.status === 429) {
            status.className = 'san-buzzer-status err';
            status.textContent = 'Ya te avisamos al equipo. Esperá unos segundos.';
            submit.disabled = false;
          } else {
            status.className = 'san-buzzer-status err';
            status.textContent = 'Error: ' + (res.d && res.d.error || 'desconocido') + '. Avisá al staff en barra.';
            submit.disabled = false;
          }
        })
        .catch(function (e) {
          status.className = 'san-buzzer-status err';
          status.textContent = 'Sin red — avisá al staff en barra.';
          submit.disabled = false;
        });
    };
  }

  function init() {
    injectStyles();
    var btns = document.querySelectorAll('[data-sanatorio-buzzer]');
    btns.forEach(function (btn) {
      if (!btn.textContent.trim()) btn.innerHTML = '🛎 Llamar al mesero/a';
      btn.classList.add('san-buzzer-btn');
      btn.setAttribute('type', btn.tagName === 'BUTTON' ? 'button' : btn.getAttribute('type') || 'button');
      btn.addEventListener('click', function (e) { e.preventDefault(); openModal(btn); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
