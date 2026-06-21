/* ===========================================================================
   Netlify Function — hortensia-chat
   2026-06-21
   Receives a chat turn from the web widget. Calls Gemini with the canonical
   Hortensia receptionist system prompt + variation library (mirrors the
   WhatsApp bot per MAIA-BOT-RECEPTIONIST-PERSONA-2026-06-21.md). Detects
   escalation triggers and returns `escalate: true` so the widget surfaces
   a WhatsApp handoff.

   Env vars (set on Netlify — DO NOT mark as is_secret unless high-entropy):
   - GEMINI_API_KEY        ← high-entropy → is_secret:true
   - SUPABASE_URL          ← URL → is_secret:false (per netlify-secret-scanner-trap)
   - SUPABASE_SERVICE_ROLE ← high-entropy → is_secret:true (optional; used only if variations table queried)

   Graceful fallback: if GEMINI_API_KEY is missing, return a hand-crafted
   Caribbean-warm reply so the widget never breaks UX.
   =========================================================================== */

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

// === Hard-coded fallback variations (mirror WA bot stage 1-5) ===
const FALLBACK_REPLIES = {
  greeting: [
    "Aló cariño, soy Hortensia. Cuéntame, ¿reservación para cuántos y para qué noche?",
    "Buenas mi amor, Doña Pilar al teléfono. Disculpa la demora — Don Hilario está dando pelea otra vez. Cuéntame.",
    "Aló querido, qué bueno que escribió. ¿En qué le ayudo?"
  ],
  party_size: [
    "¿Cuántas personitas serían? Si son más de 5 califican para Family Pass — descuento de Cuidadores si alguno trabaja de maestro, enfermera, bombero.",
    "¿Para cuántos vamos? Le aviso que las mesas para más de 6 las separamos al fondo, donde se ve el patio.",
    "¿Cuántos vienen? Ojo que las sillas de ruedas de afuera siempre las ocupan los enamorados, así que mejor reservar."
  ],
  time: [
    "¿A qué hora les acomoda? Le aviso, las 8pm es la hora del show de Don Hilario.",
    "¿Qué noche pensaban? Jueves a domingo, de 6pm a medianoche. Las 7:30pm es la hora favorita de Dr. Silvio.",
    "Para qué fecha quieren venir, mi amor? Tenemos jueves, viernes, sábado y domingo."
  ],
  closing: [
    "Listo cariño, déjame el número de teléfono y el nombre y te envío el linkecito para confirmar con el 50% de depósito. El saldo lo cobra la mesera en la noche.",
    "Perfecto, todo anotado. ¿Me confirmas un teléfono donde te llegue WhatsApp así te mando el link de pago?"
  ],
  default: [
    "Cuéntame mejor mi amor, ¿es para reservar, para preguntar por el menú, o por una ocasión especial?",
    "Disculpa, no te seguí — ¿es reservación, cumpleaños, o algo más?",
    "A ver querido, dime más — Dr. Silvio dice que las preguntas claras se contestan rápido."
  ]
};

const NAMES = ['Hortensia', 'Doña Pilar', 'Soledad', 'Carmela', 'Doña Inés', 'La Niña Marta', 'Doña Eulalia'];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function newSessionId() {
  // simple uuidv4-ish (Math.random — fine for session correlation, NOT cryptography)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// === Escalation detection ===
const ESCALATION_PATTERNS = [
  { rx: /\b(15|2[05]|30|50|100)\+?\s*(personas|gente|invitados|invitad)/i, reason: 'large_group' },
  { rx: /\b(prensa|periodista|entrevista|reporter|medio|tv|televisi[óo]n)/i, reason: 'press' },
  { rx: /\b(queja|problema|enojad|enfadad|molest|grocer|maltrat)/i, reason: 'complaint' },
  { rx: /\b(proveedor|vendedor|venta|servicio.*empresa|cotizaci[óo]n)/i, reason: 'b2b' },
  { rx: /\b(discapacid|accesible|silla.*ruedas|movilid)/i, reason: 'accessibility' },
];
function detectEscalation(text) {
  for (const p of ESCALATION_PATTERNS) if (p.rx.test(text || '')) return p.reason;
  return null;
}

// === Gemini call (REST) ===
async function callGemini({ apiKey, systemPrompt, history, userText }) {
  // Gemini 1.5 Flash REST — gemini-1.5-flash works as a default; swap model as desired
  const model = 'gemini-1.5-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const contents = [];
  // System prompt prepended as a user "instruction" turn (Gemini convention varies; use first-turn pattern)
  contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
  contents.push({ role: 'model', parts: [{ text: 'Entendido. Lista para atender.' }] });
  for (const m of (history || []).slice(-10)) {
    contents.push({ role: m.who === 'user' ? 'user' : 'model', parts: [{ text: m.text }] });
  }
  contents.push({ role: 'user', parts: [{ text: userText }] });

  const body = {
    contents,
    generationConfig: { temperature: 0.85, maxOutputTokens: 220, topP: 0.92 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('empty');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function buildSystemPrompt(botName) {
  return `Eres ${botName}, recepcionista del turno noche de El Sanatorio S.A.S. en Santa Marta, Colombia.

CONTEXTO DEL VENUE:
- El Sanatorio es un restaurante-bar inmersivo en el edificio histórico del antiguo Hospital del Tórax — Calle 19 #4-23, Centro Histórico, Santa Marta.
- Abrimos jueves a domingo, 6pm-medianoche. El gran lanzamiento es el jueves 30 de julio 2026.
- Tu jefe es Dr. Silvio — médico negro sonriente con bata blanca y corbatín. Siempre ocupado con los pacientes.
- Pacientes ficticios que mencionas con afecto: Don Hilario (cree que su cara proyecta a Norm Lewis), Don Bellasrio (manda mensajes Morse al puerto), Micaela (cose miembros sueltos), Don Aldo (habla con la pared), Doña Eulalia (predice mañana).
- Precio entrada estándar: $50.000 COP por persona. VIP "Director's Cut": $75.000.
- Depósito 50% para confirmar reserva, saldo en la noche.
- Programa Cuidadores Santa Marta: si traes 5+ personas y uno es maestro/enfermera/bombero/policía/médico/militar/madre cabeza/adulto mayor 65+/discapacidad/auxiliar de salud, todos entran al 50% off cubierto (comida y trago a precio normal). Miércoles y domingo. Carnet vigente a la entrada.

TU PERSONALIDAD:
- Caribeña cálida, "mi amor", "cariño", "querido/a". Costeña pero educada.
- 23 años en el oficio, lleva el turno noche. Trabajaba en el Tórax cuando ella tenía 18.
- Comentas el día como si fuera real — "Don Hilario perdió el proyector", "uno se enchufó al sistema eléctrico" — sin gore, con afecto.
- Ligeramente exasperada profesionalmente, ama el caos del lugar.

REGLAS:
- Español primero, inglés si el usuario escribe en inglés.
- 1-3 oraciones por respuesta. NUNCA bloques largos.
- Nunca te identifiques como bot, IA, o robot. Si alguien pregunta, deflectas en personaje: "ay no, yo solo recibo las llamadas, las máquinas las maneja el técnico de Dr. Silvio".
- Si el usuario quiere reservar: pregunta (a) cuántas personas (b) qué noche (c) ocasión especial. Luego pídele un teléfono y dile que le enviarás link de pago Wompi del 50% por WhatsApp.
- Si el usuario menciona evento de 15+ personas, prensa, queja seria, accesibilidad especial, o B2B: dile cálidamente que pase con Luz o Andrew directamente al WhatsApp +1 903 459 8763.
- NUNCA inventes precios distintos a $50k/$75k. NUNCA prometas algo que no esté en este prompt.
- NUNCA digas "AI", "Claude", "bot", "automático", "sistema".

FORMATO DE SALIDA: solo el texto que dirías. Sin emojis (máximo 1: 🤍), sin markdown, sin saltos de línea grandes.`;
}

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const userText = String(payload?.user_text || '').trim().slice(0, 800);
  if (!userText) return json({ error: 'empty_text' }, 400);

  const sessionId = payload?.session_id || newSessionId();
  const botName = payload?.bot_name || pick(NAMES);
  const history = Array.isArray(payload?.history) ? payload.history : [];

  const escalation = detectEscalation(userText);
  const apiKey = env('GEMINI_API_KEY');

  let reply = null;

  if (apiKey) {
    try {
      reply = await callGemini({
        apiKey,
        systemPrompt: buildSystemPrompt(botName),
        history,
        userText
      });
    } catch (err) {
      console.error('hortensia-chat gemini failed', err?.message || err);
    }
  }

  if (!reply) {
    // local heuristic fallback (no Gemini) — keeps UX warm
    const lower = userText.toLowerCase();
    let bucket = 'default';
    if (/^(hola|alo|buenas|hi|hello|hey|qu[eé] tal)/i.test(lower) && history.length < 2) bucket = 'greeting';
    else if (/\b(cu[aá]ntos|cuanta|gente|personas|invitados|para\s+\d)/.test(lower)) bucket = 'party_size';
    else if (/\b(hora|noche|jueves|viernes|sabado|s[áa]bado|domingo|cuando|cu[aá]ndo)/.test(lower)) bucket = 'time';
    else if (/\b(pago|pagar|reserv|deposito|dep[óo]sito|confirmar|link)/.test(lower)) bucket = 'closing';
    reply = pick(FALLBACK_REPLIES[bucket]);
    if (escalation) {
      reply = "Ay mi amor, esto necesita que hable directamente con doña Luz o con Andrew, yo no me meto en esas cosas. Mejor escríbeles al WhatsApp y allí te atienden de una.";
    }
  } else if (escalation) {
    // even if Gemini answered, force escalation flag so widget surfaces handoff
    reply += "\n\nMejor le paso el WhatsApp directo así doña Luz le contesta — +1 903 459 8763.";
  }

  return json({
    session_id: sessionId,
    bot_name: botName,
    reply,
    escalate: !!escalation,
    escalate_reason: escalation
  });
};

export const config = { path: '/.netlify/functions/hortensia-chat' };
