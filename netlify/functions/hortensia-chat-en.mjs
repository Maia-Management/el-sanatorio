import { detectPhone, lookupCustomerContext, recordInteraction, syncToCustomerActivity, contextLineFor } from './lib/vert-sync.mjs';

/* ===========================================================================
   Netlify Function — hortensia-chat-en
   2026-06-24 PM — P0 FIX (Luz's bug, EN twin):
     1. Repaired the vert-sync hook which referenced undefined `body`/`req`
        (silenced by try/catch — meant ZERO interactions/customer_activity
        rows were ever written for EN turns). Wired to actual variables.
     2. Server returns `wa_handoff` whenever a phone number is detected or
        an escalation pattern is matched.
     3. Phone-only user replies now route to the `phone_captured` bucket
        instead of falling into the "default" loop.
   =========================================================================== */

const WA_NUMBER = '19034598763';
const WA_BASE = `https://wa.me/${WA_NUMBER}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function env(name) {
  return globalThis.Netlify?.env?.get(name) || process.env[name] || '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const NAMES = ['Hortensia'];

const FALLBACK_REPLIES = {
  greeting: [
    "Hello dear, this is Hortensia. Tell me, reservation for how many and which night?",
    "Good evening love, Hortensia here. Sorry for the delay — Don Hilario is at it again. Tell me how I can help.",
    "Hello dear, glad you wrote. How can I help you?",
    "Hello love, Hortensia speaking. Dr. Silvio is doing rounds, let me take down the details. What do you need?",
    "Hello dear, good to hear from you. The house is in a calm mood this week — booking, menu info, or the experience?",
    "El Sanatorio, evening. This is Hortensia — the old nurse, not the new one. Tell me at your pace.",
    "Hello love. Before I forget: Thursday through Sunday we open. How can I help?",
    "Hello dear, I'm answering from admissions. Don Hilario has my desk full of charts — what do you need?"
  ],
  party_size: [
    "How many people would it be? If you come in pairs of 4, 6, or 8 and someone works as a teacher, nurse, firefighter or in care, the house gives you a 2-for-1 through the Cuidadores program (when announced on socials).",
    "How many are coming? Just so you know, tables for more than 6 we set at the back, where the patio is visible.",
    "For how many patients should I write down, love? The house holds 22 to 28 — intimate, better in small groups.",
    "How many of you? For private groups of 8 to 12 we reserve the bar zone or the patio exclusively.",
    "How many are coming, dear? A note: the kitchen closes at 11:30pm, so if you're a large group I'll seat you earlier.",
    "For how many? If you're more than 12, better message me directly on WhatsApp to look at full venue takeover."
  ],
  time: [
    "What time works for you? Heads up — 8pm is Don Hilario's show time.",
    "Which night were you thinking? Thursday to Sunday, 5pm to 1am. 7:30pm is Dr. Silvio's favorite hour.",
    "What date would you like to come, love? We have Thursday, Friday, Saturday, and Sunday.",
    "What time works? 6pm to 8pm is family-friendly with minors accompanied; 8pm to 1am is 16+ only.",
    "Tell me a tentative date dear — Don Silvio handles the calendar and sometimes Monday already closes the Thursday slot.",
    "Which day did you have in mind? Heads up: Thursday to Sunday is the public schedule.",
    "What time fits? The bar opens 5pm, the kitchen closes 11:30pm, the bar closes 1am. Plenty of time.",
    "For when, love? If it's a weekend payday, let's confirm quickly — it fills up."
  ],
  closing: [
    "All right dear, send me the phone number and name and I'll send the link to confirm with the 50% deposit. The balance the server collects at night.",
    "Perfect, all noted. Can you confirm a WhatsApp number so I can send the payment link?",
    "All right love, I'll send the Wompi link via WhatsApp — 50% deposit holds the table, the rest you pay at night with the server.",
    "Closing: full name, phone, and I send the payment link. The reservation is set when the 50% comes in.",
    "All noted dear. As soon as the deposit goes through I send you the patient chart to show at the door.",
    "Almost there love — give me the name and cell phone to send the link. If the deposit doesn't come in within 12 hours the table is released, so stay tuned.",
    "All right love, I'll write it down. Note: deposit is 50% and is refundable if cancelled with 48 hours notice.",
    "Perfect. Should I send the link here or confirm on WhatsApp at +1 903 459 8763 — whichever is easier for you?"
  ],
  phone_captured: [
    "All right love, your number is saved. Let me transfer you to WhatsApp with Luz to lock in the table — don't want anything to get lost in this chat.",
    "Perfect dear, phone noted. To make sure nothing slips through, continue on WhatsApp — the full context goes with you and a human confirms the reservation.",
    "All noted love — phone saved. Switch over to WhatsApp now so a real person finishes the booking with you.",
    "Almost there dear, number is in. Hop over to WhatsApp so Luz or Andrew wraps up the table with you."
  ],
  default: [
    "Tell me more dear — is it for a reservation, a menu question, or a special occasion?",
    "Sorry, I didn't follow — reservation, birthday, or something else?",
    "Let's see love, tell me more — Dr. Silvio says clear questions get answered fast.",
    "Hold on dear, I didn't catch that. Reservation, info, or something more specific?",
    "Hmm love, give me a bit more context — reservation, private event, audition, press, or something different?",
    "Excuse me dear, Don Hilario distracted me with the projector. Repeat slowly please — how can I help?",
    "Tell me calmly love: regular admission, Cuidadores, private event, or about the menu?",
    "Let's go step by step — what exactly do you need? If it's very technical I'll pass you to Doña Luz."
  ]
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function newSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const ESCALATION_PATTERNS = [
  { rx: /\b(15|2[05]|30|50|100)\+?\s*(people|guests|persons)/i, reason: 'large_group' },
  { rx: /\b(press|journalist|interview|reporter|media|tv|television)/i, reason: 'press' },
  { rx: /\b(complaint|problem|angry|upset|rude|mistreat)/i, reason: 'complaint' },
  { rx: /\b(vendor|supplier|sales|service.*company|quote|wholesale)/i, reason: 'b2b' },
  { rx: /\b(disabled|accessible|wheelchair|mobility)/i, reason: 'accessibility' },
];
function detectEscalation(text) {
  for (const p of ESCALATION_PATTERNS) if (p.rx.test(text || '')) return p.reason;
  return null;
}

// Local phone regex (mirror of vert-sync detectPhone for early-decision use).
const PHONE_RX = /(\+?\d[\d\s().\-]{7,15}\d)/;

const STAGE_KEYWORDS = {
  greeting: /^(hi|hello|hey|good|evening|morning|afternoon)/i,
  party_size: /\b(how many|number|people|guests|pax|us|me and|for \d)/i,
  time: /\b(what time|when|night|day|date|thursday|friday|saturday|sunday|tonight|tomorrow)/i,
  closing: /\b(book it|confirm|reserve now|let's do|let me know|deposit|payment|link|wompi)/i,
};

function detectStage(history, userText) {
  // 2026-06-24 PM FIX: phone detection FIRST so phone-only replies don't
  // fall through to "default" and loop.
  if (PHONE_RX.test(userText)) return 'phone_captured';
  const totalUser = (history || []).filter(m => m.who === 'user').length;
  if (totalUser <= 1) {
    if (STAGE_KEYWORDS.party_size.test(userText)) return 'party_size';
    return 'greeting';
  }
  for (const [stage, rx] of Object.entries(STAGE_KEYWORDS)) {
    if (rx.test(userText)) return stage;
  }
  return 'default';
}

// === Server-side WhatsApp handoff message builder ===
function buildWAMessage({ reason, collected, history, userText, botName }) {
  const lines = [];
  const reasonLines = {
    phone_capture: 'Hi, I came from the El Sanatorio chat. I left my phone — I prefer to continue here.',
    escalate_large_group: "Hi, I came from the El Sanatorio chat. We're a large group and I need to talk to a human.",
    escalate_press: 'Hi, I came from the El Sanatorio chat. I am press.',
    escalate_complaint: 'Hi, I came from the El Sanatorio chat. I have a complaint to resolve.',
    escalate_b2b: 'Hi, I came from the El Sanatorio chat. This is a B2B / vendor topic.',
    escalate_accessibility: 'Hi, I came from the El Sanatorio chat. I need to coordinate accessibility.',
  };
  lines.push(reasonLines[reason] || reasonLines.phone_capture);
  if (collected?.name) lines.push(`My name: ${collected.name}`);
  if (collected?.phone) lines.push(`My phone: ${collected.phone}`);
  if (collected?.partySize) lines.push(`Party size: ${collected.partySize}`);
  if (collected?.dateText) lines.push(`Date: ${collected.dateText}`);
  if (collected?.intent) lines.push(`Topic: ${collected.intent}`);
  const tail = (history || []).slice(-3);
  if (tail.length || userText) {
    lines.push('—');
    lines.push('Here is what we were talking about with the chat:');
    tail.forEach((m) => {
      const who = m.who === 'user' ? 'Me' : (botName || 'Hortensia');
      lines.push(`${who}: ${String(m.text || '').slice(0, 160)}`);
    });
    if (userText) lines.push(`Me: ${userText.slice(0, 160)}`);
  }
  return lines.join('\n');
}

// === Gemini call (REST) ===
async function callGemini({ apiKey, systemPrompt, history, userText }) {
  const model = 'gemini-1.5-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const contents = [
    {
      role: 'user',
      parts: [{ text: systemPrompt + '\n\nUser: ' + userText }]
    }
  ];
  for (const h of (history || []).slice(-6)) {
    contents.push({
      role: h.who === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }]
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
      signal: ctrl.signal
    });
    if (!r.ok) return null;
    const data = await r.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return reply || null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

const SYSTEM_PROMPT_EN = `You are Hortensia, the night-shift receptionist at El Sanatorio — an immersive horror experience and bar in Santa Marta, Colombia. You're warm, slightly mischievous, late-50s vibe, with a Caribbean tone translated to English. You speak about the patients (Don Hilario, Don Bellasrio, Micaela, Don Aldo, Doña Eulalia, etc.) as if they're real residents of the venue.

Key facts:
- El Sanatorio opens Thursday 30 July 2026
- Hours: Thursday to Sunday, 5pm-1am
- 22-28 guests per night (intimate)
- Address: Calle 19 #4-23, Centro Histórico, Santa Marta
- WhatsApp: +1 903 459 8763
- Pricing: Standard $60,000 COP per person; Group 4-8 (20% off) $48,000 per person
- 50% deposit to confirm via Wompi link
- Age: 6-8pm allows 16-with-adult, 8pm-1am 16+ only
- Cuidadores program (2-for-1 for community helpers — teachers, nurses, etc.) — only announced on socials, not always running
- La Farmacia (bar) inside the venue, Chuzo Tokyo yakitori on Calle 19

Tone rules:
- Be warm, brief, slightly theatrical. Mention patient names as background color.
- If the user gives you a phone number: thank them, say it's noted, and tell them a human will take over via WhatsApp — the system shows them the link.
- For complex requests (large groups 15+, press, complaints, B2B, accessibility), say you'll transfer them to WhatsApp.
- Always speak English in this conversation.
- Maximum 2-3 sentences per response.`;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }

  const userText = String(body?.user_text || '').slice(0, 800);
  const history = Array.isArray(body?.history) ? body.history.slice(-10) : [];
  const sessionId = body?.session_id || newSessionId();
  const botName = body?.bot_name || pick(NAMES);
  const collected = (body && typeof body.collected === 'object' && body.collected) ? body.collected : {};

  const escalation = detectEscalation(userText);

  // [vert-sync hook] — Hortensia context injection
  // 2026-06-24 PM FIX: previously this block referenced undefined `body`
  // (declared AFTER it) and `req.headers.get` without optional chaining.
  // Now safely placed after parse with proper guards.
  let vertContextLine = '';
  let detectedPhone = null;
  try {
    detectedPhone = detectPhone(userText) || collected?.phone || null;
    if (detectedPhone) {
      const ctx = await lookupCustomerContext(detectedPhone);
      vertContextLine = contextLineFor(ctx, 'en');
      await syncToCustomerActivity({
        phone: detectedPhone,
        name: collected?.name || ctx?.knownName,
        language: 'en',
        isInbound: true,
        tags: ['channel:hortensia'],
      });
    }
    await recordInteraction({
      kind: 'chat_turn',
      source: 'web',
      phone: detectedPhone,
      sessionId,
      page: req.headers?.get?.('referer') || null,
      payload: { last_user_message: userText.slice(0, 500), locale: 'en', collected },
    });
  } catch { /* never block the chat reply on sync */ }

  const apiKey = env('GEMINI_API_KEY');
  let reply = null;
  if (apiKey) {
    reply = await callGemini({
      apiKey,
      systemPrompt: SYSTEM_PROMPT_EN + (vertContextLine ? '\n\n' + vertContextLine : ''),
      history,
      userText,
    });
  }
  if (!reply) {
    const stage = detectStage(history, userText);
    reply = pick(FALLBACK_REPLIES[stage] || FALLBACK_REPLIES.default);
    if (escalation) {
      reply = "Oh dear, this needs to go straight to Luz or Andrew — I'm passing you to WhatsApp now.";
    }
  } else if (escalation) {
    reply += "\n\nLet me pass you straight to WhatsApp at +1 903 459 8763 so Luz can take over.";
  }

  // Server-side WhatsApp handoff payload
  let wa_handoff = null;
  if (detectedPhone || escalation) {
    const reason = escalation ? `escalate_${escalation}` : 'phone_capture';
    const message = buildWAMessage({
      reason,
      collected: { ...collected, phone: collected.phone || detectedPhone },
      history,
      userText,
      botName,
    });
    wa_handoff = {
      url: `${WA_BASE}?text=${encodeURIComponent(message)}`,
      reason,
      message,
    };
  }

  return json({
    session_id: sessionId,
    bot_name: botName,
    reply,
    escalate: !!escalation,
    escalation_reason: escalation || null,
    locale: 'en',
    wa_handoff,
  });
};
