/* ===========================================================================
   Hortensia (EN) — El Sanatorio's web receptionist chat widget, English
   2026-06-24 PM — P0 FIX: phone-number stuck state + WhatsApp handoff guarantee
   Mirror of hortensia-chat.js with EN copy. See that file for full design notes.
   Andrew's rule: ALL ROADS END IN WHATSAPP.
   =========================================================================== */

(() => {
  'use strict';

  const WA_NUMBER = '19034598763';
  const WA_BASE = `https://wa.me/${WA_NUMBER}`;
  const IDLE_TIMEOUT_MS = 30000;

  const NAMES = ['Hortensia'];

  const GREETINGS = [
    "Oh hello dear, welcome to El Sanatorio. I'm {name}, night-shift receptionist. Dr. Silvio is running again — Don Hilario got into the boiler room one more time. How can I help you?",
    "Good evening, you've reached the Sanatorio. {name} on the phone. Excuse the delay, we were attending an emergency — apparently one patient bit another's ear and Dr. Silvio is stitching. Reservation?",
    "El Sanatorio, hello, this is {name}. Pardon the racket in the background, Don Bellasrio is sending Morse code again and walked into the kitchen thinking the chef was a radio. How can I serve you?",
    "Oh dear, good thing you called. I'm {name} from the Sanatorio. It's been a day — Don Hilario lost the projector and we're still looking for it in ward 3. When was the visit for?",
    "Hello, Sanatorio, this is {name}. Dr. Silvio is in minor surgery but I can write down the reservation if you'd like. How many are coming and which night?",
    "Hello love, thanks for calling the Sanatorio. {name} speaking. Excuse the noise — Micaela is stitching a gentleman's arm and dropped the thread spool. How may I help you?",
    "El Sanatorio, evening, this is {name}. Dr. Silvio sends his regards but he's tied up — one of the patients plugged himself into the electrical panel by mistake. Reservation for this week?",
    "Hello dear, welcome to El Sanatorio. I'm {name}. Today is Thursday and Thursdays are the worst here — the patients think it's Friday. How many for the table?",
  ];
  const FALLBACK_LINES = [
    "Oh dear, sorry — Dr. Silvio is calling because a patient got into the machine room again. Would you mind continuing on WhatsApp? Same number, I'll reply right away.",
    "Love, the phone dropped — happens with the old Sanatorio wiring. Better write me on WhatsApp so nothing gets lost. Same number, same team.",
    "Excuse me dear, the connection inside the building is from the 1950s like everything else here. Switch to WhatsApp and I'll respond at once.",
  ];

  const PHONE_RX = /(\+?\d[\d\s().\-]{7,15}\d)/;

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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

  function extractFields(text) {
    const t = String(text || '');
    const lower = t.toLowerCase();
    const phoneMatch = t.match(PHONE_RX);
    if (phoneMatch && !state.collected.phone) state.collected.phone = phoneMatch[1].replace(/\s/g, '');

    const nameMatch = t.match(/(?:i'?m|my\s+name\s+is|name[:\s]+)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch && !state.collected.name) state.collected.name = nameMatch[1];
    else {
      const m2 = t.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s*[,;]/);
      if (m2 && !state.collected.name) state.collected.name = m2[1];
    }

    const partyMatch = lower.match(/\b(\d{1,3})\s*(people|guests|of\s+us|pax|adults)/);
    if (partyMatch) state.collected.partySize = partyMatch[1];

    const dateMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow|weekend|next\s+\w+|on\s+the\s+\d{1,2})/);
    if (dateMatch) state.collected.dateText = dateMatch[0];

    if (/\b(press|journalist|interview|reporter|media|tv)/i.test(t)) state.collected.intent = 'press';
    else if (/\b(complaint|angry|upset|terrible|awful|rude)/i.test(t)) state.collected.intent = 'complaint';
    else if (/\b(caregiver|cuidador|2x1|2\s*for\s*1)/i.test(t)) state.collected.intent = 'cuidadores';
    else if (/\b(event|birthday|bachelorette|corporate|company|anniversary)/i.test(t)) state.collected.intent = 'event';
    else if (/\b(book|reserve|pay|deposit|link|wompi)/i.test(t)) state.collected.intent = 'reservation';
  }

  function buildHandoffURL(reasonLine) {
    const c = state.collected;
    const lines = [];
    lines.push(reasonLine || 'Hi, I came from the El Sanatorio website chat.');
    if (c.name) lines.push(`My name: ${c.name}`);
    if (c.phone) lines.push(`My phone: ${c.phone}`);
    if (c.partySize) lines.push(`Party size: ${c.partySize}`);
    if (c.dateText) lines.push(`Date: ${c.dateText}`);
    if (c.intent) lines.push(`Topic: ${c.intent}`);
    const tail = state.messages.slice(-4);
    if (tail.length) {
      lines.push('—');
      lines.push('Here is what we were talking about with the chat:');
      tail.forEach((m) => {
        const who = m.who === 'user' ? 'Me' : state.botName;
        lines.push(`${who}: ${m.text.slice(0, 160)}`);
      });
    }
    return `${WA_BASE}?text=${encodeURIComponent(lines.join('\n'))}`;
  }

  function renderWidget() {
    const root = el('div', { class: 'hortensia', role: 'complementary', 'aria-label': 'Chat with the receptionist' });

    const bubble = el('button', {
      class: 'hortensia__bubble', type: 'button', 'aria-label': 'Open chat',
      title: 'Chat with Hortensia',
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

    const panel = el('div', { class: 'hortensia__panel', role: 'dialog', 'aria-label': `Chat with ${state.botName}` });

    const header = el('div', { class: 'hortensia__header' });
    header.appendChild(el('div', { class: 'hortensia__avatar' }, state.botName.split(' ').pop()[0]));
    const who = el('div', { class: 'hortensia__who' });
    who.appendChild(el('strong', {}, state.botName));
    who.appendChild(el('span', {}, 'Reception · El Sanatorio'));
    header.appendChild(who);
    header.appendChild(el('button', {
      class: 'hortensia__close', type: 'button', 'aria-label': 'Close chat',
      onclick: () => root.classList.remove('is-open')
    }, '✕'));
    panel.appendChild(header);

    // === PERSISTENT ESCAPE HATCH — ALL ROADS END IN WHATSAPP ===
    const escapeBar = el('a', {
      class: 'hortensia__escape',
      href: WA_BASE + '?text=' + encodeURIComponent("Hi, I'm on the El Sanatorio website and I'd rather chat with a human on WhatsApp."),
      target: '_blank',
      rel: 'noopener',
      'aria-label': 'Chat with a human on WhatsApp'
    });
    escapeBar.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path d="M20.5 3.5A11.5 11.5 0 0 0 3.5 19l-1.4 5 5.1-1.3a11.5 11.5 0 1 0 13.3-19.2zM12 21.3a9.3 9.3 0 0 1-4.7-1.3l-.3-.2-3 .8.8-3-.2-.3A9.3 9.3 0 1 1 12 21.3zm5.3-7c-.3-.1-1.7-.8-2-.9s-.4-.1-.6.1-.7.9-.9 1c-.2.2-.3.2-.6.1a7.6 7.6 0 0 1-2.2-1.4 8.3 8.3 0 0 1-1.6-2c-.2-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.3-.5s0-.4 0-.6l-.9-2c-.2-.5-.4-.5-.6-.5h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-1 2.3 5.3 5.3 0 0 0 1.1 2.8c.2.2 1.9 2.9 4.6 4a14.4 14.4 0 0 0 1.5.6 3.6 3.6 0 0 0 1.7.1 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3z"/>
      </svg>
      <span>Chat with a human on WhatsApp</span>
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

        if (PHONE_RX.test(text) && !state.handoffSurfaced) {
          surfaceHandoffCard('phone_capture');
        }

        await sendToBot(text);
      }
    });
    form.appendChild(el('input', {
      type: 'text', placeholder: 'Type your message…', autocomplete: 'off',
      'aria-label': 'Your message', maxlength: '400'
    }));
    form.appendChild(el('button', { type: 'submit' }, 'Send'));
    panel.appendChild(form);

    const transfer = el('div', { class: 'hortensia__transfer' });
    transfer.innerHTML = `Prefer WhatsApp? <a href="${WA_BASE}?text=${encodeURIComponent("Hi! I'm visiting from the El Sanatorio website.")}" target="_blank" rel="noopener">Open conversation</a>`;
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

  function surfaceHandoffCard(reason) {
    if (state.handoffSurfaced) return;
    state.handoffSurfaced = true;
    const reasonLines = {
      phone_capture: 'Hi, I came from the El Sanatorio chat. I left my phone number — I prefer to continue here.',
      idle: 'Hi, I came from the El Sanatorio chat. Could you help me here?',
      repeat: 'Hi, I came from the El Sanatorio chat. The chat was going in circles — I prefer to continue with a human.',
      error: 'Hi, I tried to book through the website but the chat dropped.',
      escalate: 'Hi, I came from the El Sanatorio chat. I was transferred because I need to speak with Luz or Andrew.',
    };
    const reasonLine = reasonLines[reason] || reasonLines.phone_capture;
    const url = buildHandoffURL(reasonLine);

    const card = el('div', { class: 'hortensia__handoff' });
    const title = el('div', { class: 'hortensia__handoff-title' },
      reason === 'phone_capture' ? '✓ Your details are saved'
        : reason === 'idle' ? 'Are you still there, dear?'
        : reason === 'repeat' ? "We're going in circles"
        : reason === 'error' ? 'The line dropped'
        : 'Transferring you to a human'
    );
    const body = el('div', { class: 'hortensia__handoff-body' },
      reason === 'phone_capture' ? "So nothing gets lost and a human confirms your table, continue on WhatsApp — I'm bringing your context."
        : reason === 'idle' ? "In case you lost connection, here's the WhatsApp link with everything we talked about."
        : reason === 'repeat' ? 'Let me hand you to WhatsApp with the full context so a real person can take over.'
        : reason === 'error' ? "Switch to WhatsApp with all the context — I'll reply right away."
        : 'Luz or Andrew will reply directly on WhatsApp.'
    );
    const btn = el('a', {
      class: 'hortensia__handoff-cta',
      href: url, target: '_blank', rel: 'noopener'
    });
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M20.5 3.5A11.5 11.5 0 0 0 3.5 19l-1.4 5 5.1-1.3a11.5 11.5 0 1 0 13.3-19.2z"/>
      </svg>
      <span>Continue on WhatsApp</span>
    `;
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(btn);
    state.messagesEl.appendChild(card);
    state.messagesEl.scrollTop = state.messagesEl.scrollHeight;
  }

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
      const res = await fetch('/.netlify/functions/hortensia-chat-en', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          bot_name: state.botName,
          history: state.messages.slice(-10).map(({ text, who }) => ({ text, who })),
          user_text: text,
          collected: state.collected,
          locale: 'en'
        })
      });
      typing.remove();
      if (!res.ok) throw new Error('Network');
      const data = await res.json();
      if (data.session_id) state.sessionId = data.session_id;
      if (data.bot_name) state.botName = data.bot_name;
      const reply = (data.reply || pick(FALLBACK_LINES));

      if (reply && reply === state.lastBotReply && state.messages.length > 2) {
        addMsg(reply, 'bot');
        surfaceHandoffCard('repeat');
        return;
      }
      addMsg(reply, 'bot');

      if (data.wa_handoff && !state.handoffSurfaced) {
        surfaceHandoffCard(data.escalate ? 'escalate' : 'phone_capture');
      } else if (data.escalate && !state.handoffSurfaced) {
        surfaceHandoffCard('escalate');
      }
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
