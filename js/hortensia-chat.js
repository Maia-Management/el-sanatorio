/* ===========================================================================
   Hortensia — El Sanatorio's web receptionist chat widget
   2026-06-21
   Mirrors the WhatsApp bot persona (MAIA-BOT-RECEPTIONIST-PERSONA-2026-06-21).
   Posts user turns to /.netlify/functions/hortensia-chat — that function
   talks to Gemini with the canonical system prompt + variations from the
   el_sanatorio_bot_variations Supabase table.

   Falls back gracefully if the function is offline (offers WhatsApp deeplink).
   =========================================================================== */

(() => {
  'use strict';

  const WA_NUMBER = '19034598763';
  const WA_BASE = `https://wa.me/${WA_NUMBER}`;
  const STORAGE_KEY = 'sanatorio_hortensia_v1';   // sessionStorage allowed; we use in-memory only

  // Rotating name pool from the persona spec
  const NAMES = ['Hortensia', 'Doña Pilar', 'Soledad', 'Carmela', 'Doña Inés', 'La Niña Marta', 'Doña Eulalia'];
  // Pre-shipped greeting variations so the widget feels alive even before
  // the Netlify function is wired. Server-side returns these PLUS Gemini reply.
  const GREETINGS = [
    "Aló cariño, bienvenido a El Sanatorio. Soy {name}, recepcionista del turno noche. Dr. Silvio anda corriendo — Don Hilario se metió al cuarto de calderas otra vez. ¿En qué te ayudo mi amor?",
    "Buenas buenas, llamó al Sanatorio, soy {name} al teléfono. Disculpa la demora, estábamos atendiendo una emergencia — al parecer un paciente le mordió una oreja a otro y Dr. Silvio anda cosíendo. ¿Reservación?",
    "Aló, El Sanatorio, ¿con quién hablo? Aquí {name}. Disculpa el alboroto de fondo, es que Don Bellasrio está mandando mensajes Morse otra vez y se metió a la cocina creyendo que el chef era un radio. ¿En qué le sirvo?",
    "Ay querido, qué bueno que llamó. Soy {name} del Sanatorio. Hoy ha sido un día — Don Hilario perdió el proyector y andamos buscándolo por toda la sala 3. ¿Para cuándo era la visita?",
    "Buenas, Sanatorio, le habla {name}. Dr. Silvio está en cirugía menor pero yo le anoto la reservación si quiere. ¿Cuántos vienen y para qué noche?",
    "Aló mi amor, gracias por llamar al Sanatorio. {name} al teléfono. Disculpe el ruido, Micaela está cosiéndole un brazo a un señor y se le cayó el carrete. ¿En qué puedo ayudarle?",
    "El Sanatorio, buenas, habla {name}. Dr. Silvio le manda saludos pero anda ocupado — uno de los pacientes se enchufó al sistema eléctrico por error. ¿Reservación para esta semana?",
    "Aló cariño, qué hubo, bienvenido a El Sanatorio. Soy {name}. Hoy es jueves y los jueves son los peores aquí — los pacientes piensan que es viernes. ¿Para cuántos sería la mesa?",
  ];
  const FALLBACK_LINES = [
    "Ay mi amor, perdona — Dr. Silvio me llama porque uno de los pacientes se metió al cuarto de las máquinas y no sale. ¿Le importa si seguimos esta conversación por WhatsApp? Es el mismo número, allí le contesto de una.",
    "Cariño se me cayó el teléfono — esto pasa con el cable viejo del Sanatorio. Mejor escríbame por WhatsApp así no se pierde nada. Mismo número, mismo equipo.",
    "Disculpe querido, la conexión aquí adentro del edificio es de los años 50 igual que todo lo demás. Pásese al WhatsApp y le respondo enseguida.",
  ];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  const state = {
    sessionId: null,
    botName: pick(NAMES),
    messages: [],
    sending: false,
    transferred: false,
  };

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    kids.flat().forEach((k) => { if (k) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }

  function renderWidget() {
    const root = el('div', { class: 'hortensia', role: 'complementary', 'aria-label': 'Chat con la recepcionista' });

    const bubble = el('button', {
      class: 'hortensia__bubble', type: 'button', 'aria-label': 'Abrir chat',
      title: 'Chatear con Hortensia',
      onclick: () => {
        root.classList.toggle('is-open');
        if (root.classList.contains('is-open') && state.messages.length === 0) {
          // first open — show greeting
          const greeting = pick(GREETINGS).replace('{name}', state.botName);
          addMsg(greeting, 'bot');
        }
        if (root.classList.contains('is-open')) {
          setTimeout(() => root.querySelector('input').focus(), 100);
        }
      }
    });
    bubble.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M21 12c0 4.418-4.03 8-9 8-1.6 0-3.1-.37-4.4-1L3 20l1.1-4C3.4 14.7 3 13.4 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
        <circle cx="9" cy="12" r="0.8" fill="currentColor"/>
        <circle cx="12" cy="12" r="0.8" fill="currentColor"/>
        <circle cx="15" cy="12" r="0.8" fill="currentColor"/>
      </svg>
    `;
    root.appendChild(bubble);

    const panel = el('div', { class: 'hortensia__panel', role: 'dialog', 'aria-label': `Chat con ${state.botName}` });

    const header = el('div', { class: 'hortensia__header' });
    header.appendChild(el('div', { class: 'hortensia__avatar' }, state.botName.split(' ').pop()[0]));
    const who = el('div', { class: 'hortensia__who' });
    who.appendChild(el('strong', {}, state.botName));
    who.appendChild(el('span', {}, 'Recepción · El Sanatorio'));
    header.appendChild(who);
    header.appendChild(el('button', {
      class: 'hortensia__close', type: 'button', 'aria-label': 'Cerrar chat',
      onclick: () => root.classList.remove('is-open')
    }, '✕'));
    panel.appendChild(header);

    const messagesEl = el('div', { class: 'hortensia__messages', role: 'log', 'aria-live': 'polite' });
    panel.appendChild(messagesEl);

    const form = el('form', {
      class: 'hortensia__form', onsubmit: async (e) => {
        e.preventDefault();
        if (state.sending) return;
        const input = form.querySelector('input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        addMsg(text, 'user');
        await sendToBot(text);
      }
    });
    form.appendChild(el('input', {
      type: 'text', placeholder: 'Escribe tu mensaje…', autocomplete: 'off',
      'aria-label': 'Tu mensaje', maxlength: '400'
    }));
    form.appendChild(el('button', { type: 'submit' }, 'Enviar'));
    panel.appendChild(form);

    // Transfer-to-WhatsApp note
    const transfer = el('div', { class: 'hortensia__transfer' });
    transfer.innerHTML = `¿Prefieres WhatsApp? <a href="${WA_BASE}?text=${encodeURIComponent('Hola, vengo de la web de El Sanatorio')}" target="_blank" rel="noopener">Abrir conversación</a>`;
    panel.appendChild(transfer);

    root.appendChild(panel);
    document.body.appendChild(root);
    state.messagesEl = messagesEl;
  }

  function addMsg(text, who) {
    state.messages.push({ text, who, ts: Date.now() });
    const node = el('div', { class: `hortensia__msg hortensia__msg--${who}` });
    node.textContent = text;
    state.messagesEl.appendChild(node);
    state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
  }

  function showTyping() {
    const node = el('div', { class: 'hortensia__typing' });
    node.appendChild(el('span'));
    node.appendChild(el('span'));
    node.appendChild(el('span'));
    state.messagesEl.appendChild(node);
    state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
    return node;
  }

  async function sendToBot(text) {
    state.sending = true;
    const typing = showTyping();
    try {
      const res = await fetch('/.netlify/functions/hortensia-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          bot_name: state.botName,
          history: state.messages.slice(-10).map(({ text, who }) => ({ text, who })),
          user_text: text
        })
      });
      typing.remove();
      if (!res.ok) throw new Error('Network');
      const data = await res.json();
      if (data.session_id) state.sessionId = data.session_id;
      if (data.bot_name) state.botName = data.bot_name;
      const reply = (data.reply || pick(FALLBACK_LINES));
      addMsg(reply, 'bot');
      // Escalation triggers — surface explicit WhatsApp handoff
      if (data.escalate) {
        const wa = el('a', {
          class: 'hortensia__msg hortensia__msg--bot',
          href: `${WA_BASE}?text=${encodeURIComponent('Hola, vengo de la web — me transfirieron desde el chat. ' + text)}`,
          target: '_blank', rel: 'noopener'
        }, '→ Continuar por WhatsApp con Hortensia');
        state.messagesEl.appendChild(wa);
        state.transferred = true;
      }
    } catch (err) {
      typing.remove();
      addMsg(pick(FALLBACK_LINES), 'bot');
      // append WhatsApp handoff
      const wa = el('a', {
        class: 'hortensia__msg hortensia__msg--bot',
        href: `${WA_BASE}?text=${encodeURIComponent('Hola, intenté reservar por la web pero se cayó el chat. ' + text)}`,
        target: '_blank', rel: 'noopener'
      }, '→ Abrir WhatsApp');
      state.messagesEl.appendChild(wa);
    } finally {
      state.sending = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderWidget, { once: true });
  } else {
    renderWidget();
  }
})();
