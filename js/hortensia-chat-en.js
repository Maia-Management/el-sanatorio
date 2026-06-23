/* ===========================================================================
   Hortensia (EN) — El Sanatorio's web receptionist chat widget, English
   2026-06-23
   Mirrors the Spanish hortensia-chat.js but speaks English. Same persona
   (Hortensia, night-shift receptionist), same character beats, English voice.
   Posts to /.netlify/functions/hortensia-chat-en for Gemini-backed replies.
   Falls back gracefully if the function is offline (offers WhatsApp deeplink).
   =========================================================================== */

(() => {
  'use strict';

  const WA_NUMBER = '19034598763';
  const WA_BASE = `https://wa.me/${WA_NUMBER}`;

  const NAMES = ['Hortensia']; // Andrew lock 2026-06-22: Hortensia only.

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
    const root = el('div', { class: 'hortensia', role: 'complementary', 'aria-label': 'Chat with the receptionist' });

    const bubble = el('button', {
      class: 'hortensia__bubble', type: 'button', 'aria-label': 'Open chat',
      title: 'Chat with Hortensia',
      onclick: () => {
        root.classList.toggle('is-open');
        if (root.classList.contains('is-open') && state.messages.length === 0) {
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
      const res = await fetch('/.netlify/functions/hortensia-chat-en', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          bot_name: state.botName,
          history: state.messages.slice(-10).map(({ text, who }) => ({ text, who })),
          user_text: text,
          locale: 'en'
        })
      });
      typing.remove();
      if (!res.ok) throw new Error('Network');
      const data = await res.json();
      if (data.session_id) state.sessionId = data.session_id;
      if (data.bot_name) state.botName = data.bot_name;
      const reply = (data.reply || pick(FALLBACK_LINES));
      addMsg(reply, 'bot');
      if (data.escalate) {
        const wa = el('a', {
          class: 'hortensia__msg hortensia__msg--bot',
          href: `${WA_BASE}?text=${encodeURIComponent("Hi, I was transferred from the website chat. " + text)}`,
          target: '_blank', rel: 'noopener'
        }, '→ Continue on WhatsApp with Hortensia');
        state.messagesEl.appendChild(wa);
        state.transferred = true;
      }
    } catch (err) {
      typing.remove();
      addMsg(pick(FALLBACK_LINES), 'bot');
      const wa = el('a', {
        class: 'hortensia__msg hortensia__msg--bot',
        href: `${WA_BASE}?text=${encodeURIComponent("Hi, I tried to book via the website but the chat dropped. " + text)}`,
        target: '_blank', rel: 'noopener'
      }, '→ Open WhatsApp');
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
