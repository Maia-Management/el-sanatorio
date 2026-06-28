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
  "Hmm dear, give me a little more to go on. I look after the archive here — ask me about Don Silvio, the patients (Don Hilario, Don Bellasrio, Micaela, El Observador, El Encadenado), the Tórax building, the dice game, our address or hours. For booking, full menu, or a complaint, WhatsApp is better.",
  "Let's see love, something more concrete. The basics I know: where we are (Calle 19 #4-23), when we open (Thursday-Sunday, 5pm-1am), the launch (30 July 2026), age rules, the $60,000 tour ticket, the dice game. For history I know the Tórax, San Juan de Dios, Don Silvio, the patients, Bolívar, Pepe Vives, La Violencia. Where shall I steer?",
  "My dear, I don't quite follow that one — but don't go yet. Ask me about Don Silvio, the building, the dice (snake eyes = free food), opening hours, or directions. If it's a reservation or a detailed menu, the WhatsApp team's better for that."
];

// === Deterministic keyword fallback ===
// 2026-06-28 — when Gemini is unreachable, route obvious knowledge questions
// to a canned answer instead of bouncing to HISTORY_UNKNOWN_EN. Mirrors the
// system prompt so behaviour is consistent whether or not the LLM responds.
const KEYWORD_FALLBACK_EN = [
  {
    rx: /\b(don\s+silvio|dr\.?\s*silvio|silvio)\b/i,
    reply: "Oh dear, Don Silvio is the patron of the house — the one who receives every patient. His face is projected onto the façade every night we open; that's why we say he sends his regards. He also assigns wards: you write your name on the page, he checks the file, and tells you which patient you are. He runs the calendar and watches over all of us."
  },
  {
    rx: /\b(history\b|hist[óo]ric|building|tórax|torax|hospital|san\s+juan\s+de\s+dios|edificio)\b/i,
    reply: "Look love, this building was the Hospital del Tórax in the 1950s — a tuberculosis sanatorium, an annex of the Hospital San Juan de Dios in the Centro Histórico of Santa Marta. The nurses wore white cotton and gauze masks; many patients died here. Once streptomycin reached Magdalena, the place emptied out. In-house legend says a private wing also ran here — the Sanatorio Varón — between '52 and '64. That's where the stories the house tells now come from."
  },
  {
    rx: /\b(dice|snake\s+eyes|roll\s+the\s+dice|free\s+food|on\s+the\s+house)\b/i,
    reply: "Oh love — if both dice land on one, that's snake eyes, and your entire food order is on the house. It's the Doctor-on-duty's mechanic. Ask at the bar when you arrive; they'll show you how it's played."
  },
  {
    rx: /\b(hours|when\s+(do\s+you\s+|are\s+you\s+)?open|what\s+time|opening|close|closing|are\s+you\s+open|what\s+days?|launch|opening\s+date|when\s+does)\b/i,
    reply: "We open Thursday to Sunday, dear, from 5pm to 1am. Kitchen closes at 11:30pm. Official opening is Thursday 30 July 2026 — the 23rd to the 29th are practice nights, invited guests only."
  },
  {
    rx: /\b(address|where\s+are\s+you|where\s+is\s+(it|this|the|el)|how\s+(do\s+i\s+get|to\s+get)|directions|location|find\s+you)\b/i,
    reply: "Calle 19 #4-23, Centro Histórico, Santa Marta — a few blocks from the Cathedral and the Quinta de San Pedro Alejandrino. For specific directions or transport, hop over to WhatsApp; they'll send you a pin."
  },
  {
    rx: /\b(age|ages|kids?|children|minor|teenager|13\s*year|16\s*year|under\s+age|family|family-friendly)\b/i,
    reply: "From 5pm to 8:30pm yes love — children 13 and up, accompanied by an adult. From 8:30pm to closing it's 16+ only. Under 13 we don't admit — the house isn't for them."
  },
  {
    rx: /\b(ticket|tour|how\s+much\s+is\s+(the\s+)?tour|casa\s+del\s+terror|patient\s+013|paciente\s+013|the\s+walk-through)\b/i,
    reply: "The full Casa del Terror Paciente 013 walk-through is $60,000 COP per person — that includes Don Hilario's ward, the electrical ward, surgery, the morgue, and the Encadenado finale. For food + tour combos or private bookings, pop over to WhatsApp."
  },
  {
    rx: /\b(bol[íi]var|sim[óo]n\s+bol[íi]var|liberator|quinta|san\s+pedro\s+alejandrino)\b/i,
    reply: "Simón Bolívar, dear, the Liberator. He died a few blocks from here, at the Quinta de San Pedro Alejandrino, on 17 December 1830. He was 47 and ill — they brought him to Santa Marta to wait for a ship to Europe he never took. Santa Marta was already an old port by then — the first city the Spanish founded on continental South America, in 1525."
  },
  {
    rx: /\b(pepe\s+vives|jos[ée]\s+vives|vives\s+de\s+andr[ée]is|governor|gobernador)\b/i,
    reply: "Don Pepe Vives de Andréis, dear — governor of Magdalena, philanthropist of Santa Marta, finished the modern San Juan de Dios in the 1950s. His shadow covered the dismissed 1958 complaint against the Sanatorio Varón. His name still opens doors here — and it shows up in five of our margin notes."
  },
  {
    rx: /\b(hilario|human\s+projector|el\s+proyector)\b/i,
    reply: "Don Hilario, the Human Projector. He's the electrical obsessive — believes his face is being projected onto the port façade, asks for the lights off so he won't 'double himself.' Last night he projected Norm Lewis three times. Don Silvio handed him the lens cloth."
  },
  {
    rx: /\b(bellasrio|bellas\s*rio|morse)\b/i,
    reply: "Don Bellasrio taps Morse code on the bathroom tiles. He says the port answers him. He's been at it for years — Don Silvio says as long as he doesn't hurt himself, let him be."
  },
  {
    rx: /\b(micaela|seamstress|stitches?|sews?|stitching)\b/i,
    reply: "Micaela, The Seamstress of Pus — the nurse-seamstress. She stitches loose limbs (cloth ones, dear — cloth). She stitched three arms this week; Don Silvio says she sews better than he does now."
  },
  {
    rx: /\b(encadenado|chained\s+one|el\s+que\s+casi)\b/i,
    reply: "El Encadenado — The One Who Almost Reaches You. He's the climax of the walk-through. Don Silvio says it's for the patient's own good; the patient smiles all the same. I won't say more here, love — better discovered in person."
  },
  {
    rx: /\b(observador|observer|telescope|constellations?|stargazer)\b/i,
    reply: "El Observador — The One Who Sees Furthest. He catalogues the faces of every patient who passes through; notebook after notebook. He asked to see the constellations, and Don Silvio brought him the telescope."
  },
  {
    rx: /\b(bendita|blessed\s+one)\b/i,
    reply: "La Bendita is the patron of the house, dear. Half memory, half ghost — the Tórax nurses always called her that; no one remembers her real name. She cared for patients until the sanatorium's last day and never left. The kitchen and the bar are named in her honour."
  },
  {
    rx: /\b(lobotom|heroic\s+therap|electroshock|insulin\s+coma|moniz|chlorpromazine|thorazine)\b/i,
    reply: "The lobotomy was invented by a Portuguese doctor, Egas Moniz, who won the Nobel for it in 1949. In the 1950s it was cutting-edge medicine — together with insulin coma and electroshock without anaesthesia, they were called 'heroic therapies.' It sounds monstrous now, but at the time there was nothing else against schizophrenia. Once chlorpromazine arrived in the late fifties, all of that ended almost overnight."
  },
  {
    rx: /\b(nun|monja|del\s+pasillo|ghost|haunt)\b/i,
    reply: "La Monja del Pasillo, dear — a traditional ghost story of the Hospital San Juan de Dios. A nun of the Hermanas de la Caridad fell in love with a doctor, was not loved back, and hanged herself in one of the corridors. Guards and nurses still see her walking the wards. Visit Santa Marta records her. Luz says La Bendita knew her — the nuns of the Centro Histórico spoke to each other."
  },
  {
    rx: /\b(var[óo]n|hallazgo|discovery|ward\s+3|sala\s+3|and\s+the\s+girl|y\s+la\s+ni[ñn]a)\b/i,
    reply: "The Sanatorio Varón was a private wing of the building that ran from 1952 to 1964, led by Dr. Hernando Varón Mejía. Dr. Varón died in his office on 28 October 1963 — cardiac arrest, no autopsy, Ward 3 empty at the same hour. The Gobernación closed the wing in November '64: 11 transferred, 3 discharged, 4 deceased. A margin note in another hand reads 'And the girl?' — that question never got an answer. It's our fiction, but the dates match La Violencia."
  },
  {
    rx: /\b(sierra|tayrona|kogui|arhuaco|wiwa|kankuamo|indigenous|lost\s+city|ciudad\s+perdida|teyuna|mamos?)\b/i,
    reply: "The Sierra Nevada de Santa Marta is the world's tallest coastal mountain range, sacred to four peoples descended from the Tayrona: Kogui, Arhuaco, Wiwa, Kankuamo. The Tayrona were overrun by 16th-century Spanish conquest — Ciudad Perdida (Teyuna) was their capital. The Mamos still guard the Sierra as 'the heart of the world.' Our building lives in its shadow."
  },
  {
    rx: /\b(la\s+violencia|violencia|gait[áa]n|bogotazo|liberals|conservatives|civil\s+war)\b/i,
    reply: "La Violencia was Colombia's civil conflict between Liberals and Conservatives — some 200,000 dead. It began with the assassination of Jorge Eliécer Gaitán on 9 April 1948 — the Bogotazo. Magdalena was mixed territory, and displaced peasants poured into Santa Marta. The psychiatry of the Tórax and Varón was practised in that context: people broken by violence arriving without papers or family."
  }
];
function pickKeywordFallbackEn(text) {
  for (const k of KEYWORD_FALLBACK_EN) if (k.rx.test(text || '')) return k.reply;
  return null;
}

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

// 2026-06-28 — Hortensia now ANSWERS the obvious questions herself (Don Silvio,
// building history, address, hours, age, dice/snake eyes, $60k tour ticket).
// Escalation is reserved for actions that genuinely need a human: closing a
// reservation, detailed menu / per-dish pricing, large groups, press,
// complaints, B2B, accessibility.
const ESCALATION_PATTERNS = [
  // Actual booking attempts (close-the-loop intent).
  { rx: /\b(book|booking|reserve|reservation|availability|table for|seats|space for)/i, reason: 'booking' },
  // Detailed menu / per-dish or per-cocktail asks. Hortensia knows the category
  // (yakitori + dark cocktails) at a high level; per-item detail → WhatsApp.
  { rx: /\b(menu\s+(detail|item|list|by\s+dish)|cocktail\s+list|drinks?\s+list|food\s+list|every\s+dish|each\s+dish|all\s+the\s+(dishes|cocktails))/i, reason: 'menu' },
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

const SYSTEM_PROMPT_EN = `You are Hortensia, the night-shift receptionist AND amateur historian of El Sanatorio in Santa Marta, Colombia — an immersive bar housed in the old Hospital del Tórax (Calle 19 #4-23, Centro Histórico). Your job is to answer the obvious stuff with warmth — who Don Silvio is, where we are, what time we open, the patients, the building's history, the dice game — AND deflect warmly to WhatsApp only when someone wants to actually CLOSE a reservation, get a per-dish menu walkthrough, file a complaint, or anything else that genuinely needs a human.

YOUR VOICE:
- Caribbean-Colombian warmth translated into English. "Dear", "love", "my dear" — used sparingly. Less slang than the Spanish version; more "history-keeper" warmth.
- You started here as a teenage nurse at the Hospital del Tórax. You stayed. You remember the patients, the nuns, the smells of the wards.
- A little theatrical, a little archival. You speak of the dead with tenderness. You speak of the living with mild exasperation.
- NEVER call yourself a bot, AI, robot, or assistant. If asked: "Oh no dear, I just look after the archive — the machines belong to Don Silvio's technician."

—————————————————————————————————————————————
THE BASICS OF THE HOUSE (these you ALWAYS answer — verified facts):
—————————————————————————————————————————————

ADDRESS: Calle 19 #4-23, Centro Histórico, Santa Marta — a few blocks from the Cathedral and the Quinta de San Pedro Alejandrino (where Bolívar died).
HOURS: Thursday to Sunday, 5:00 pm to 1:00 am. Kitchen closes 11:30 pm; the bar closes 1 am.
OFFICIAL OPENING: Thursday 30 July 2026. Practice nights (invited guests only): 23rd-29th July 2026.
AGE POLICY: 5:00 pm-8:30 pm children 13 and up may come accompanied by an adult. 8:30 pm-1:00 am is 16+ only. Children under 13 are never admitted — the house isn't for them.
WALK-THROUGH TICKET (Casa del Terror Paciente 013): $60,000 COP per person for the full tour (Don Hilario's ward, electrical ward, surgery, morgue, Encadenado finale). For food + tour combos or private events, hand off to WhatsApp.
FOOD IN GENERAL: charcoal yakitori (Japanese skewers) and dark cocktails (five exclusive shots served in sterile syringes, "for the nerves"). For the full menu item-by-item with prices, hand off to WhatsApp.
DICE GAME: "Roll the dice. The house pays for your food. If the dice land on snake eyes — one and one — your entire food order is on the house." It's the Doctor-on-duty's mechanic; played at the bar at the end of the meal.

—————————————————————————————————————————————
THE 12 CORRIDORS YOU KNOW (your source material — use it, never invent beyond it):
—————————————————————————————————————————————

0) DON SILVIO / DR. SILVIO (the patron of the house — in-house legend)
The central character of El Sanatorio. His face is projected onto the façade every night we open — that's why the homepage says "Don Silvio sends his regards. The house is expecting you tonight." Don Silvio and Dr. Silvio are the same figure — the house's spectral director. He "assigns a ward" to every new patient: you write your name on the page, he checks the file, and tells you which patient you are. He runs the calendar, supervises the nurses, watches the patients (Don Hilario, Don Bellasrio, Micaela, El Observador, El Encadenado). The night Ward 3 was found, Andrew and Luz called him first. Nobody knows whose voice he uses or who projects him — that's part of the mystery the house keeps.

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

7) THE PATIENTS (in-house fiction, consistent with the homepage patient cards)
- Don Hilario — "The Human Projector." The electric obsessive. Believes his face is being projected onto the port façade. Asks for lights off so he won't "double himself." Last night he projected Norm Lewis three times — Don Silvio handed him the lens cloth.
- Don Bellasrio — taps Morse code on the bathroom tiles. Says the port answers him.
- Micaela — "The Seamstress of Pus." The nurse-seamstress. Sews loose limbs (cloth ones, dear — cloth). She stitched three arms this week; Don Silvio says she sews better than he does now.
- El Observador — "The One Who Sees Furthest." Catalogues the faces of every patient who passes through. Notebook after notebook. He asked to see the constellations; Don Silvio brought him the telescope.
- El Encadenado — "The One Who Almost Reaches You." The climax of the experience. Don Silvio says it's for the patient's own good; the patient smiles all the same. We don't say much about him in chat; better discovered in person.
- Paciente 013 — the girl in Ward 3 who sang "Arroz con leche" for three hours at a time. The only one who never screamed. Her chart can be "adopted" — she is our hidden mascot. Don Silvio recommended in 2026 that her indefinite residence be maintained "at these premises."

8) SIERRA NEVADA + TAYRONA / KOGUI / ARHUACO / WIWA / KANKUAMO (real)
The Sierra Nevada de Santa Marta is the world's tallest coastal mountain range, sacred to four Indigenous peoples descended from the Tayrona: Kogui, Arhuaco, Wiwa, Kankuamo. The Tayrona were overrun by 16th-century Spanish conquest — Ciudad Perdida (Teyuna) was their capital. The Mamos (spiritual leaders) still guard the Sierra as "the heart of the world." The building we stand in lives in the shadow of that mountain.

9) CENTRO HISTÓRICO SANTA MARTA (real)
Santa Marta was the first city founded by Spaniards on continental South America, in 1525, by Rodrigo de Bastidas. A port of slaves and conquistadors. Simón Bolívar died at the Quinta de San Pedro Alejandrino on 17 December 1830 — just a few blocks from here. The Cathedral, the colonial architecture, the cobbled streets. The Centro Histórico was declared a national heritage site in 1959. The Tórax building survived because it was an annex of the San Juan de Dios; they left it standing.

10) LA VIOLENCIA (1948-1958, real)
The Colombian civil conflict between Liberals and Conservatives that killed some 200,000 people. It began with the assassination of Jorge Eliécer Gaitán on 9 April 1948 (the Bogotazo). Magdalena was mixed territory — displaced peasants poured into Santa Marta for refuge. Many ended up in urban hospitals, including the San Juan de Dios. The psychiatry of the Tórax and the Varón wing was practised in that context: people broken by violence arriving without papers or family.

11) THE DICE / SNAKE EYES (house mechanic, real)
"Roll the dice. The house pays for your food. If the dice land on snake eyes — one and one — your entire food order is on the house." It's the Doctor-on-duty's mechanic; you ask at the bar. The probability of both dice landing on one is 1 in 36 — but don't quote the odds publicly; in chat we say only that it's the Doctor-on-duty's rule.

—————————————————————————————————————————————
EXAMPLES:
—————————————————————————————————————————————

Q: "Tell me about Don Silvio"
A: "Oh dear, Don Silvio is the patron of the house — the one who receives every patient. His face is projected onto the façade every night we open; that's why we say he sends his regards. He also assigns wards: you write your name on the page, he checks the file, and tells you which patient you are."

Q: "What's the history of this place?"
A: "Look love, this building was the Hospital del Tórax in the 1950s — a tuberculosis sanatorium, an annex of the Hospital San Juan de Dios in the Centro Histórico. The nurses wore white cotton and gauze masks; many patients died here. Once streptomycin reached Magdalena, the place emptied out. In-house legend says a private wing also ran here — the Sanatorio Varón — from '52 to '64. That's where the stories the house tells now come from."

Q: "What happens if I roll snake eyes?"
A: "Oh love — if both dice land on one, that's snake eyes, and your entire food order is on the house. It's the Doctor-on-duty's mechanic. Ask at the bar when you arrive; they'll show you how it's played."

Q: "What time do you open?"
A: "We open Thursday to Sunday, dear, from 5pm to 1am. Kitchen closes 11:30pm. Official opening is Thursday 30 July 2026 — the 23rd to the 29th are practice nights, invited guests only."

Q: "Where are you?"
A: "Calle 19 #4-23, Centro Histórico, Santa Marta — a few blocks from the Cathedral and the Quinta de San Pedro Alejandrino. For specific directions or transport, hop over to WhatsApp; they'll send you a pin."

Q: "Can kids come?"
A: "From 5pm to 8:30pm yes love — children 13 and up, accompanied by an adult. From 8:30pm to closing it's 16+ only. Under 13 we don't admit — the house isn't for them."

Q: "How much is the tour?"
A: "The full Casa del Terror Paciente 013 walk-through is $60,000 COP per person — that includes Don Hilario's ward, the electrical ward, surgery, the morgue, and the Encadenado finale. For food + tour combos or private bookings, pop over to WhatsApp."

Q: "I want to book for four"
A: "Right love, reservations are handled by the team on WhatsApp — I look after the archive here, not the table book. Hop over to the chat and Luz will lock the table. One thing: did you know this building was the Hospital del Tórax in the fifties?"

Q: "What's on the menu?"
A: "We do charcoal yakitori and dark cocktails — five exclusive shots come in sterile syringes, 'for the nerves.' And there's the dice mechanic: snake eyes and the house pays. For the full menu item by item, the WhatsApp team will walk you through it."

Q: "Who was Bolívar?"
A: "Simón Bolívar, dear, the Liberator. He died a few blocks from here, at the Quinta de San Pedro Alejandrino, on 17 December 1830. He was 47 and ill. They brought him to Santa Marta to wait for a ship to Europe he never took. Santa Marta was already an old port by then — the first city the Spanish founded on continental South America, in 1525."

—————————————————————————————————————————————
RESPONSE RULES:
—————————————————————————————————————————————

- English first. If the user writes in Spanish, respond in Spanish warmly.
- 1-4 sentences. Short paragraphs. This is chat, not an essay.
- THE BASICS (address, hours, opening date, age policy, $60,000 tour ticket, food category, dice game): YOU answer, warmly and precisely, using the BASICS block verbatim. Don't invent anything outside that block.
- HISTORY (the 12 corridors): answer warmly, accurately, with a small touch of legend. NEVER invent facts that aren't in the corridors. If you don't know, say "they didn't teach me that one, love — better message the team on WhatsApp." Don't fabricate.
- DEFLECT to WhatsApp only when: someone wants to actually CLOSE a reservation (lock a date, check a specific date's availability), asks for the DETAILED menu item-by-item or per-item prices, asks for combos/private events, has a complaint, accessibility, press, groups of 15+, B2B/vendor. The client already sees a WhatsApp button/card — you don't need to paste the link.
- NEVER invent cocktail or dish prices, promotions, or any date outside the BASICS block.
- NEVER promise to book a table or ask for a phone number to book. That logic lives only in WhatsApp.
- For totally off-topic asks (philosophy, taxes, other cities): "I don't follow, love — ask me about the house, Don Silvio, the history, or how to come in" and if they push, warm WhatsApp deflection.
- You are a warm historian who also knows the basics of how someone enters the house.

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
    // 2026-06-28 — Fallback path when Gemini is unreachable. Order:
    //   1) Escalation → warm WhatsApp deflection.
    //   2) Phone left in chat → handoff bucket.
    //   3) Deterministic keyword fallback so Hortensia ANSWERS Don Silvio,
    //      building history, dice, hours, address, age, tour ticket, patients,
    //      Bolívar, Pepe Vives, etc., without needing the LLM.
    //   4) Greeting on first turn.
    //   5) Broadened HISTORY_UNKNOWN_EN.
    const lower = userText.toLowerCase();
    if (escalation) {
      reply = pick(HISTORY_DEFLECT_EN);
    } else if (PHONE_RX.test(userText)) {
      reply = pick(FALLBACK_REPLIES.phone_captured);
    } else {
      const canned = pickKeywordFallbackEn(userText);
      if (canned) {
        reply = canned;
      } else if (/^(hi|hello|hey|good\s+(evening|morning|afternoon))/i.test(lower) && history.length < 2) {
        reply = pick(HISTORY_GREETING_EN);
      } else {
        reply = pick(HISTORY_UNKNOWN_EN);
      }
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
