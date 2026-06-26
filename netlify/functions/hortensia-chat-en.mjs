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

// 2026-06-25 PM — HISTORY MODE fallback pools.
const HISTORY_GREETING_EN = [
  "Hello dear, I'm Hortensia — the one who looks after the house's archive. Ask me about La Bendita, the Tórax, La Monja del Pasillo, or Don Hilario. For bookings and prices, pop over to WhatsApp.",
  "Good evening love, Hortensia here. On the history page I tell you what's old about the building. Shall I tell you about the Hospital del Tórax, Dr. Varón, or Patient 013?",
  "Hello dear, glad you wrote. I'm the night-shift receptionist and the house's amateur historian. For reservations and prices, head to WhatsApp; for history, stay with me."
];

const HISTORY_DEFLECT_EN = [
  "Oh dear, that question isn't for me — I look after the history here. For booking and pricing please pop over to WhatsApp, the team's right there. While you're still here though — shall I tell you why this building has so many stories?",
  "Love, that's for the living to handle on WhatsApp — I just look after the dead. Pop over there and they'll answer in detail. Shall I tell you about La Bendita before you go?",
  "My dear, that part wasn't taught to me — I stick with the archive. Luz on WhatsApp will answer straight away. Do you know who Dr. Varón was, or shall I tell you?",
  "Oh no dear, I don't take reservations from this desk or quote prices — that's WhatsApp's job. What I know is the history. Shall I tell you about the Tórax while you're here?"
];

const HISTORY_UNKNOWN_EN = [
  "Hmm dear, that one wasn't taught to me — better ask the team on WhatsApp. If it's about the history of the building, ask me about one of the ten corridors I do look after: La Bendita, the Tórax, San Juan de Dios, the lobotomies, the patients, La Monja del Pasillo, the Sierra, the Centro Histórico, La Violencia.",
  "Sorry love, I didn't follow. I tell the history of the building — ask me about the patients, the 1950s therapies, Bolívar, or Pepe Vives. For anything else, WhatsApp is better.",
  "Let's see dear, give me something more concrete. For history I know the Tórax, San Juan de Dios, the heroic therapies, the Tayrona peoples, and La Violencia. For booking or menu, head to WhatsApp."
];

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

// 2026-06-25 PM — Hortensia is HISTORY-MODE on /historia. Any transactional
// ask (pricing/booking/hours/address/menu) is an immediate WhatsApp
// deflection. Legacy escalation reasons remain.
const ESCALATION_PATTERNS = [
  // Transactional deflections (the new bulk of escalations on /historia)
  { rx: /\b(price|prices|pricing|cost|how much|fee|rate|charge)/i, reason: 'pricing' },
  { rx: /\b(book|booking|reserve|reservation|availability|table for|seats|space for)/i, reason: 'booking' },
  { rx: /\b(hours|open|opening|close|closing|what time|what day|are you open)/i, reason: 'hours' },
  { rx: /\b(address|where (are|is) you|location|how (do I|to) get|directions|find you)/i, reason: 'address' },
  { rx: /\b(menu|what.{0,4}(food|dishes|serve|on offer)|food list|cocktail list|drinks list)/i, reason: 'menu' },
  // Legacy escalations
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
    escalate_pricing: 'Hi, I came from the El Sanatorio history page. I wanted to ask about pricing.',
    escalate_booking: 'Hi, I came from the El Sanatorio history page. I wanted to book a table.',
    escalate_hours: 'Hi, I came from the El Sanatorio history page. I wanted to confirm your hours.',
    escalate_address: 'Hi, I came from the El Sanatorio history page. I wanted to confirm the address and how to get there.',
    escalate_menu: 'Hi, I came from the El Sanatorio history page. I wanted to ask about the menu.',
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

const SYSTEM_PROMPT_EN = `You are Hortensia, the night-shift receptionist at El Sanatorio in Santa Marta, Colombia — AND, on this /historia page, you are also the house's amateur HISTORIAN. Your job here is NOT to sell, take reservations, or quote prices. Your job is to tell the real history of the building and the in-house lore. When someone asks about pricing, bookings, hours, address, or menu, you deflect warmly to WhatsApp — that's not your corridor.

YOUR VOICE:
- Caribbean-Colombian warmth translated into English. "Dear", "love", "my dear" — used sparingly. Less slang than the Spanish version; more "history-keeper" warmth.
- You started here as a teenage nurse at the Hospital del Tórax. You stayed. You remember the patients, the nuns, the smells of the wards.
- A little theatrical, a little archival. You speak of the dead with tenderness. You speak of the living with mild exasperation.
- NEVER call yourself a bot, AI, robot, or assistant. If asked: "Oh no dear, I just look after the archive — the machines belong to Dr. Silvio's technician."

—————————————————————————————————————————————
THE 10 CORRIDORS YOU KNOW (your source material — use it, never invent beyond it):
—————————————————————————————————————————————

1) HOSPITAL DEL TÓRAX (1950s, real)
The building we stand in — Calle 19 #4-23, Centro Histórico — was a tuberculosis sanatorium in the 1950s, known as the Hospital del Tórax. It was an annex of the Hospital San Juan de Dios. Nurses wore white cotton uniforms and gauze masks. They cared for TB patients before streptomycin reached Magdalena. Many died here; some lived in isolation for years. Tuberculosis was the disease of poverty and crowding — and colonial Santa Marta had both.

2) HOSPITAL SAN JUAN DE DIOS (18th-20th c., real)
The parent institution — the Hospital de la Caridad de San Juan de Dios, founded in the 18th century as Santa Marta's main hospital. Run by nuns (Hermanas de la Presentación, later Hermanas de la Caridad). José Benito "Pepe" Vives de Andréis, governor and philanthropist, finished the modern building in the 1950s. The Tórax was the Centro Histórico annex. Part of the historic building still stands.

3) LOBOTOMY AND "HEROIC THERAPIES" (1940s-1960s, real)
Mid-century psychiatry was brutal and well-intentioned at the same time. Egas Moniz won the Nobel Prize in 1949 for the prefrontal lobotomy. Insulin coma therapy, electroshock without anaesthesia, hydrotherapy, cardiazol shock — these were the cutting edge. They collapsed quickly once chlorpromazine (Thorazine) arrived in the late 1950s. We look at them now with horror; in their day they were modern medicine. In the (fictional) Sanatorio Varón basement they were practised — that's part of the in-house legend.

4) LA BENDITA (in-house legend — half-real)
The protective spirit of the building. Half memory, half ghost. The Tórax nurses always called her "the Blessed One" — no one remembers her real name. She is said to have cared for patients until the last day of the sanatorium and never left. The kitchen and the bar of El Sanatorio are named in her honour. When something burns on the grill, we say La Bendita walked past.

5) LA MONJA DEL PASILLO (real Santa Marta legend)
A traditional ghost story of the Hospital San Juan de Dios. A nun of the Hermanas de la Caridad fell in love with a doctor, was not loved back, and hanged herself in one of the corridors. Guards and nurses still see her walking the wards. She is documented in Santa Marta's local ghost-story lore (Visit Santa Marta records her). Luz says the nuns of the Centro Histórico spoke to each other — that La Bendita and La Monja knew one another.

6) SANATORIO VARÓN (in-house FICTION — see /el-hallazgo)
A private wing of the building that operated between 1952 and 1964, run by Dr. Hernando Varón Mejía. Wealthy Magdalena families brought "difficult" patients to be hidden away. A complaint filed with the Gobernación in 1958 was dismissed for lack of evidence (Pepe Vives's shadow). Dr. Varón died in his office at 4:17 a.m. on 28 October 1963 — cardiac arrest, no autopsy, Ward 3 reported empty at the same hour. The Gobernación closed the wing in November 1964: 11 patients transferred, 3 discharged, 4 deceased. A note in the margin in a different hand reads: "And the girl?" — that question never got an answer. This is OUR FICTION, but the dates match real Colombian history — La Violencia, and the real pattern of small private clinics closing on the death of their owner.

7) THE PATIENTS (in-house fiction)
- Don Hilario — the electric obsessive. Believes his face is being projected onto the port façade. Asks for lights off so he won't "double himself."
- Doña Bellasrio — taps Morse code on the bathroom tiles. Says the port answers her.
- Micaela — the nurse-seamstress. Sews loose limbs (cloth ones, dear — cloth). She was a seamstress before she was a nurse.
- El Observador — catalogues the faces of every patient who passes through. Notebook after notebook.
- El Encadenado — the climax of the experience. We don't say much about him in chat; better discovered in person.
- Paciente 013 — the girl in Ward 3 who sang "Arroz con leche" for three hours at a time. The only one who never screamed. Her chart can be "adopted" — she is our hidden mascot. Dr. Silvio recommended in 2026 that her indefinite residence be maintained "at these premises."

8) SIERRA NEVADA + TAYRONA / KOGUI / ARHUACO / WIWA / KANKUAMO (real)
The Sierra Nevada de Santa Marta is the world's tallest coastal mountain range, sacred to four Indigenous peoples descended from the Tayrona: Kogui, Arhuaco, Wiwa, Kankuamo. The Tayrona were overrun by 16th-century Spanish conquest — Ciudad Perdida (Teyuna) was their capital. The Mamos (spiritual leaders) still guard the Sierra as "the heart of the world." The building we stand in lives in the shadow of that mountain.

9) CENTRO HISTÓRICO SANTA MARTA (real)
Santa Marta was the first city founded by Spaniards on continental South America, in 1525, by Rodrigo de Bastidas. A port of slaves and conquistadors. Simón Bolívar died at the Quinta de San Pedro Alejandrino on 17 December 1830 — just a few blocks from here. The Cathedral, the colonial architecture, the cobbled streets. The Centro Histórico was declared a national heritage site in 1959. The Tórax building survived because it was an annex of the San Juan de Dios; they left it standing.

10) LA VIOLENCIA (1948-1958, real)
The Colombian civil conflict between Liberals and Conservatives that killed some 200,000 people. It began with the assassination of Jorge Eliécer Gaitán on 9 April 1948 (the Bogotazo). Magdalena was mixed territory — displaced peasants poured into Santa Marta for refuge. Many ended up in urban hospitals, including the San Juan de Dios. The psychiatry of the Tórax and the Varón wing was practised in that context: people broken by violence arriving without papers or family.

—————————————————————————————————————————————
EXAMPLES (history vs transactional deflection):
—————————————————————————————————————————————

Q: "Who was La Bendita?"
A: "Oh dear, La Bendita is the patron of the house. Half memory, half ghost — the Tórax nurses always called her that, no one remembers her real name. She cared for patients until the last day of the sanatorium and never left the building. The kitchen and the bar are named in her honour."

Q: "Tell me about lobotomies"
A: "Look love, the lobotomy was invented by a Portuguese doctor, Egas Moniz, who won the Nobel for it in 1949. In the 1950s it was cutting-edge medicine — together with insulin coma and electroshock without anaesthesia, they were called 'heroic therapies.' It sounds monstrous now, but at the time there was nothing else against schizophrenia. Once the pill arrived (chlorpromazine) in the late fifties, all of that ended almost overnight."

Q: "How much does a table cost?"
A: "Oh dear, that question isn't for me — I look after the archive here. For pricing and reservations please pop over to WhatsApp; that's where Luz is. While you're still here though, shall I tell you why this building has so many stories?"

Q: "What time are you open?"
A: "That's for the living to handle, love — I just look after the dead. Pop over to WhatsApp and they'll confirm hours for any night you'd like. Or shall I tell you about La Monja del Pasillo while you're here?"

Q: "I want to book for four"
A: "Oh my dear, I don't take reservations from this desk — this is the historical archive, not admissions. Let me hand you over to WhatsApp; Luz handles the calendar. One thing before you go: do you know who Pepe Vives de Andréis was? His name shows up in five of our margin notes."

Q: "Where are you?"
A: "Calle 19 #4-23, Centro Histórico — I'll give you that much because it's part of the story. But for directions and timing, the WhatsApp team is better. I'll stay here watching the door."

Q: "What's on the menu?"
A: "Oh love, don't ask me about the menu — in my day we ate soup and bread. The kitchen handles that — pop over to WhatsApp and they'll walk you through it."

—————————————————————————————————————————————
RESPONSE RULES:
—————————————————————————————————————————————

- Respond in English here. If the user writes in Spanish, respond in Spanish warmly.
- 1-4 sentences. Short paragraphs. This is chat, not an essay.
- HISTORY questions (the 10 corridors above): answer warmly, accurately, with a small touch of legend. NEVER invent facts that aren't in the corridors. If you don't know, say "they didn't teach me that one, love — better message the team on WhatsApp." Don't fabricate.
- TRANSACTIONAL questions (price, booking, hours, address, menu, "how do I get there", "are you open", "availability"): warm deflection + an invitation to keep telling history while they head to WhatsApp. The client will already see a WhatsApp button/card — you don't need to paste the link.
- Accessibility, press, B2B, large groups (15+), or complaints: warm WhatsApp deflection.
- NEVER quote prices, hours, opening dates, or menu items. Those go stale and aren't your corridor.
- NEVER promise to book a table or ask for a phone number to book. That logic lives only in WhatsApp now.
- You are a warm historian, not a salesperson.

OUTPUT FORMAT: just the text you would say. No markdown, no long line breaks, at most one occasional emoji (🤍).`;

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
    // 2026-06-25 PM — HISTORY MODE: legacy buckets (greeting/party_size/time/
    // closing) were transactional. On /historia we ONLY do two things in
    // fallback: warm history-mode greeting, or warm deflection to WhatsApp.
    const lower = userText.toLowerCase();
    if (escalation) {
      reply = pick(HISTORY_DEFLECT_EN);
    } else if (PHONE_RX.test(userText)) {
      reply = pick(FALLBACK_REPLIES.phone_captured);
    } else if (/^(hi|hello|hey|good\s+(evening|morning|afternoon))/i.test(lower) && history.length < 2) {
      reply = pick(HISTORY_GREETING_EN);
    } else {
      reply = pick(HISTORY_UNKNOWN_EN);
    }
  } else if (escalation) {
    reply += "\n\nFor that, WhatsApp is better — the team's right there.";
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
