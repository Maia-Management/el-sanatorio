/* ===========================================================================
   Hortensia — El Sanatorio's web receptionist chat widget
   2026-06-24 PM — P0 FIX: phone-number stuck state + WhatsApp handoff guarantee
   (Luz hit a bug where the bot collected her phone then asked "¿en qué te ayudo?"
    in a loop. Root cause: no conversation state, no handoff after PII capture.
    Fix philosophy from Andrew: ALL ROADS END IN WHATSAPP.)

   Guarantees this widget now provides:
   1. A persistent "Hablar con humano por WhatsApp" button at the TOP of the
      panel, visible from message #0 and every turn after. Never just at the
      bottom in 10px font.
   2. When the user types a phone number at ANY point, the widget immediately
      surfaces a rich WhatsApp handoff card — name + phone + party_size + date
      + last 4 turns of conversation summary pre-filled in the wa.me URL.
   3. A 30-second no-response timeout that auto-surfaces a soft WhatsApp
      handoff card after the bot asks a question and the user doesn't reply.
   4. Repeat-detection: if the bot's new reply is byte-identical to its
      previous reply (literally Luz's bug), surface "estamos dando vueltas"
      handoff card.
   5. Error fallback: any fetch failure → WhatsApp link with summary.
   =========================================================================== */

(() => {
  'use strict';

  const WA_NUMBER = '19034598763';
  const WA_BASE = `https://wa.me/${WA_NUMBER}`;
  const IDLE_TIMEOUT_MS = 30000;

  const NAMES = ['Hortensia']; // 2026-06-23 Andrew lock — Hortensia is the only canonical persona.

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

  // === Phone detection (mirrors lib/vert-sync.mjs detectPhone) ===
  const PHONE_RX = /(\+?\d[\d\s().\-]{7,15}\d)/;

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // === Conversation state ===
  const state = {
    sessionId: null,
    botName: pick(NAMES),
    messages: [],
    sending: false,
    transferred: false,
    lastBotReply: '',
    idleTimer: null,
    handoffSurfaced: false,
    collected: {
      name: null,
      phone: null,
      partySize: null,
      dateText: null,
      intent: null,
    },
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

  // === Heuristic field extraction from user turns ===
  function extractFields(text) {
    const t = String(text || '');
    const lower = t.toLowerCase();
    const phoneMatch = t.match(PHONE_RX);
    if (phoneMatch && !state.collected.phone) state.collected.phone = phoneMatch[1].replace(/\s/g, '');

    // Name heuristic: capitalized first+last before the phone or "soy/me llamo"
    const nameMatch = t.match(/(?:soy|me\s+llamo|me\s+llama|nombre[:\s]+)\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/);
    if (nameMatch && !state.collected.name) state.collected.name = nameMatch[1];
    else {
      // simple "Luz Acevedo, +57…" pattern
      const m2 = t.match(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})\s*[,;]/);
      if (m2 && !state.collected.name) state.collected.name = m2[1];
    }

    const partyMatch = lower.match(/\b(\d{1,3})\s*(personas|gente|invitados|pax|adultos)/);
    if (partyMatch) state.collected.partySize = partyMatch[1];

    const dateMatch = lower.match(/\b(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|hoy|ma[nñ]ana|pasado\s+ma[nñ]ana|fin\s+de\s+semana|este\s+\w+|el\s+\d{1,2})/);
    if (dateMatch) state.collected.dateText = dateMatch[0];

    if (/\b(prensa|periodista|entrevista|reporter|medio|tv)/i.test(t)) state.collected.intent = 'prensa';
    else if (/\b(queja|problema|enojad|enfadad|molest|maltrat)/i.test(t)) state.collected.intent = 'queja';
    else if (/\b(cuidador|programa\s+cuidador|2x1|2\s*por\s*1)/i.test(t)) state.collected.intent = 'cuidadores';
    else if (/\b(evento|cumplea[nñ]os|despedid|corporativ|empresa|aniversari)/i.test(t)) state.collected.intent = 'evento';
    else if (/\b(reserv|pagar|pago|dep[óo]sito|link|wompi)/i.test(t)) state.collected.intent = 'reservacion';
  }

  // === Build a wa.me URL pre-filled with conversation context ===
  function buildHandoffURL(reasonLine) {
    const c = state.collected;
    const lines = [];
    lines.push(reasonLine || 'Hola, vengo del chat de El Sanatorio.');
    if (c.name) lines.push(`Mi nombre: ${c.name}`);
    if (c.phone) lines.push(`Mi celular: ${c.phone}`);
    if (c.partySize) lines.push(`Somos ${c.partySize} personas`);
    if (c.dateText) lines.push(`Fecha: ${c.dateText}`);
    if (c.intent) lines.push(`Asunto: ${c.intent}`);
    // last 4 turns of conversation summary
    const tail = state.messages.slice(-4);
    if (tail.length) {
      lines.push('—');
      lines.push('Esto es lo que veníamos hablando con el chat:');
      tail.forEach((m) => {
        const who = m.who === 'user' ? 'Yo' : state.botName;
        lines.push(`${who}: ${m.text.slice(0, 160)}`);
      });
    }
    return `${WA_BASE}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  function renderWidget() {
    const root = el('div', { class: 'hortensia', role: 'complementary', 'aria-label': 'Chat con la recepcionista' });

    const bubble = el('button', {
      class: 'hortensia__bubble', type: 'button', 'aria-label': 'Abrir chat',
      title: 'Chatear con Hortensia',
      onclick: () => {
        root.classList.toggle('is-open');
        if (root.classList.contains('is-open') && state.messages.length === 0) {
          const greeting = pick(GREETINGS).replace('{name}', state.botName);
          addMsg(greeting, 'bot');
          armIdleTimer();
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

    // === PERSISTENT ESCAPE HATCH — ALL ROADS END IN WHATSAPP ===
    // Always visible at the top of the panel, every turn.
    const escapeBar = el('a', {
      class: 'hortensia__escape',
      href: WA_BASE + '?text=' + encodeURIComponent('Hola, vengo de la web de El Sanatorio y prefiero hablar con un humano por WhatsApp.'),
      target: '_blank',
      rel: 'noopener',
      'aria-label': 'Hablar con un humano por WhatsApp'
    });
    escapeBar.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M20.5 3.5A11.5 11.5 0 0 0 3.5 19l-1.4 5 5.1-1.3a11.5 11.5 0 1 0 13.3-19.2zM12 21.3a9.3 9.3 0 0 1-4.7-1.3l-.3-.2-3 .8.8-3-.2-.3A9.3 9.3 0 1 1 12 21.3zm5.3-7c-.3-.1-1.7-.8-2-.9s-.4-.1-.6.1-.7.9-.9 1c-.2.2-.3.2-.6.1a7.6 7.6 0 0 1-2.2-1.4 8.3 8.3 0 0 1-1.6-2c-.2-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.3-.5s0-.4 0-.6l-.9-2c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-1 2.3 5.3 5.3 0 0 0 1.1 2.8c.2.2 1.9 2.9 4.6 4a14.4 14.4 0 0 0 1.5.6 3.6 3.6 0 0 0 1.7.1 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/>
      </svg>
      <span>Hablar con humano por WhatsApp</span>
    `;
    panel.appendChild(escapeBar);

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
        clearIdleTimer();
        addMsg(text, 'user');
        extractFields(text);

        // If the user just typed a phone number, surface handoff IMMEDIATELY.
        // The server call still runs for logging, but the user gets a guaranteed exit.
        if (PHONE_RX.test(text) && !state.handoffSurfaced) {
          surfaceHandoffCard('phone_capture');
        }

        await sendToBot(text);
      }
    });
    form.appendChild(el('input', {
      type: 'text', placeholder: 'Escribe tu mensaje…', autocomplete: 'off',
      'aria-label': 'Tu mensaje', maxlength: '400'
    }));
    form.appendChild(el('button', { type: 'submit' }, 'Enviar'));
    panel.appendChild(form);

    // Original tiny WhatsApp note kept for redundancy
    const transfer = el('div', { class: 'hortensia__transfer' });
    transfer.innerHTML = `¿Prefieres WhatsApp? <a href="${WA_BASE}?text=${encodeURIComponent('Hola, vengo de la web de El Sanatorio')}" target="_blank" rel="noopener">Abrir conversación</a>`;
    panel.appendChild(transfer);

    root.appendChild(panel);
    document.body.appendChild(root);
    state.messagesEl = messagesEl;

    // === A11Y: ESC closes the dialog (WCAG 2.1.2 dismissible) ===
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && root.classList.contains('is-open')) {
        root.classList.remove('is-open');
      }
    });
  }

  function addMsg(text, who) {
    state.messages.push({ text, who, ts: Date.now() });
    const node = el('div', { class: `hortensia__msg hortensia__msg--${who}` });
    node.textContent = text;
    state.messagesEl.appendChild(node);
    state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
    if (who === 'bot') state.lastBotReply = text;
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

  // === The big handoff card ===
  function surfaceHandoffCard(reason) {
    if (state.handoffSurfaced) return;
    state.handoffSurfaced = true;
    const reasonLines = {
      phone_capture: 'Hola, vengo del chat de El Sanatorio. Le dejé mi celular, prefiero que sigamos por aquí.',
      idle: 'Hola, vengo del chat de El Sanatorio. ¿Pueden ayudarme por aquí?',
      repeat: 'Hola, vengo del chat de El Sanatorio. El chat se trabó dando vueltas, prefiero seguir con un humano.',
      error: 'Hola, intenté reservar por la web pero se cayó el chat.',
      escalate: 'Hola, vengo del chat de El Sanatorio. Me transfirieron porque necesito hablar con doña Luz o Andrew.',
    };
    const reasonLine = reasonLines[reason] || reasonLines.phone_capture;
    const url = buildHandoffURL(reasonLine);

    const card = el('div', { class: 'hortensia__handoff' });
    const title = el('div', { class: 'hortensia__handoff-title' },
      reason === 'phone_capture' ? '✓ Tus datos quedaron anotados'
        : reason === 'idle' ? '¿Sigues ahí, cariño?'
        : reason === 'repeat' ? 'Ay, estamos dando vueltas'
        : reason === 'error' ? 'Se nos cayó el cable'
        : 'Te paso con un humano'
    );
    const body = el('div', { class: 'hortensia__handoff-body' },
      reason === 'phone_capture' ? 'Para que no se pierda nada y un humano te confirme la mesa, sigue por WhatsApp — ya te llevo el contexto.'
        : reason === 'idle' ? 'Por si te quedaste sin internet, te dejo el WhatsApp con todo lo que veníamos hablando.'
        : reason === 'repeat' ? 'Mejor te paso al WhatsApp con todo el contexto para que te atienda alguien de carne y hueso.'
        : reason === 'error' ? 'Pásate al WhatsApp con todo el contexto, allí te respondo enseguida.'
        : 'Doña Luz o Andrew te atienden directo por WhatsApp.'
    );
    const btn = el('a', {
      class: 'hortensia__handoff-cta',
      href: url, target: '_blank', rel: 'noopener'
    });
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M20.5 3.5A11.5 11.5 0 0 0 3.5 19l-1.4 5 5.1-1.3a11.5 11.5 0 1 0 13.3-19.2z"/>
      </svg>
      <span>Continuar por WhatsApp</span>
    `;
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(btn);
    state.messagesEl.appendChild(card);
    state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
  }

  // === 30-second idle timeout — after bot asks a question, if user does nothing, surface handoff ===
  function armIdleTimer() {
    clearIdleTimer();
    state.idleTimer = setTimeout(() => {
      if (!state.handoffSurfaced) surfaceHandoffCard('idle');
    }, IDLE_TIMEOUT_MS);
  }
  function clearIdleTimer() {
    if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
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
          user_text: text,
          collected: state.collected,  // tell the server what we've collected
        })
      });
      typing.remove();
      if (!res.ok) throw new Error('Network');
      const data = await res.json();
      if (data.session_id) state.sessionId = data.session_id;
      if (data.bot_name) state.botName = data.bot_name;
      const reply = (data.reply || pick(FALLBACK_LINES));

      // Repeat-detection — the literal bug Luz hit
      if (reply && reply === state.lastBotReply && state.messages.length > 2) {
        addMsg(reply, 'bot');
        surfaceHandoffCard('repeat');
        return;
      }
      addMsg(reply, 'bot');

      // Server-provided handoff (escalation OR phone detected server-side)
      if (data.wa_handoff && !state.handoffSurfaced) {
        // Prefer client-built URL because it has full collected fields
        surfaceHandoffCard(data.escalate ? 'escalate' : 'phone_capture');
      } else if (data.escalate && !state.handoffSurfaced) {
        surfaceHandoffCard('escalate');
      }

      // Arm idle timer — if the bot just asked a question and the user wanders off
      armIdleTimer();
    } catch (err) {
      typing.remove();
      addMsg(pick(FALLBACK_LINES), 'bot');
      surfaceHandoffCard('error');
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
