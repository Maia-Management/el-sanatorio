import { detectPhone, lookupCustomerContext, recordInteraction, syncToCustomerActivity, contextLineFor } from './lib/vert-sync.mjs';

/* ===========================================================================
   Netlify Function — hortensia-chat
   2026-06-24 PM — P0 FIX (Luz's bug):
     1. Repaired the vert-sync hook which referenced undefined `body`/`req`
        (silenced by try/catch but it meant ZERO Hortensia turns were ever
        written to customer_activity / interactions tables).
     2. Server now returns `wa_handoff: true` and a `wa_message` (full
        conversation summary) whenever a phone number is detected in the
        latest user turn or in client-collected fields. The widget surfaces
        that as a handoff card → wa.me link → Andrew/Luz.
     3. Escalation patterns also force the handoff payload.

   Env vars (set on Netlify):
     - GEMINI_API_KEY        ← high-entropy → is_secret:true
     - SUPABASE_URL          ← URL → is_secret:false
     - SUPABASE_SERVICE_ROLE_KEY ← high-entropy → is_secret:true

   Graceful fallback: if GEMINI_API_KEY is missing, return a hand-crafted
   Caribbean-warm reply so the widget never breaks UX.
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

// === Hard-coded fallback variations (mirror WA bot stage 1-5) ===
const FALLBACK_REPLIES = {
  greeting: [
    "Aló cariño, soy Hortensia. Cuéntame, ¿reservación para cuántos y para qué noche?",
    "Buenas mi amor, Hortensia al teléfono. Disculpa la demora — Don Hilario está dando pelea otra vez. Cuéntame.",
    "Aló querido, qué bueno que escribió. ¿En qué le ayudo?",
    "Aló mi vida, Hortensia al habla. Don Silvio está pasando ronda, déjeme apuntarle yo. ¿Qué necesita?",
    "Hola cariño, qué bueno oírlo. La casa está cordial esta semana — ¿reserva, info del menú, o vienen por la experiencia?",
    "Aló, Sanatorio buenas. Aquí Hortensia — la enfermera vieja, no la nueva. Cuénteme con calma.",
    "Buenas mi amor. Antes que se me olvide: jueves a domingo abrimos. ¿En qué le ayudo?",
    "Aló querida, le contesto desde admisiones. Don Hilario me tiene el escritorio lleno de fichas — usted dirá."
  ],
  party_size: [
    "¿Cuántas personitas serían? Si vienen de a 4, 6 u 8 (siempre en pares) y alguno trabaja de maestro, enfermera, bombero o así, la casa los recibe 2 por 1 con el Programa Cuidadores.",
    "¿Para cuántos vamos? Le aviso que las mesas para más de 6 las separamos al fondo, donde se ve el patio.",
    "¿Cuántos vienen? Ojo que las sillas de ruedas de afuera siempre las ocupan los enamorados, así que mejor reservar.",
    "¿Para cuántos pacientes apunto, mi amor? La casa tiene aforo de 22 a 28 — íntimo, así de a poco mejor.",
    "¿Cuántitos serían? Para grupos privados de 8 a 12 reservamos zona bar o patio en exclusivo.",
    "¿Cuántos vienen, cariño? Si trabajan en lo que cuida (salud, educación, fuerza pública, mayores 65+) y van en pares, les hacemos 2 por 1.",
    "¿Cuántas personitas? Una cosita: la cocina cierra 11:30pm, entonces si son muchos los acomodo más temprano.",
    "¿Para cuántos? Si son más de 12, mejor llámeme directo al WhatsApp para mirar privatización del aforo completo."
  ],
  time: [
    "¿A qué hora les acomoda? Le aviso, las 8pm es la hora del show de Don Hilario.",
    "¿Qué noche pensaban? Jueves a domingo, de 6pm a medianoche. Las 7:30pm es la hora favorita de Dr. Silvio.",
    "Para qué fecha quieren venir, mi amor? Tenemos jueves, viernes, sábado y domingo.",
    "¿Qué horario les funciona? De 6pm a 8pm entran familias con menores acompañados; de 8pm a 1am ya solo mayores de 16.",
    "Dígame fecha tentativa querido — el calendario me lo abre Don Silvio y a veces el lunes ya no queda jueves.",
    "¿Qué día tenían en mente? Le adelanto: noches de Cuidadores son miércoles y domingo (aunque abrimos jueves a domingo al público).",
    "¿A qué hora caben? El bar abre 6pm, la cocina cierra 11:30pm, y la barra cierra 1am. Hay tiempo de sobra.",
    "¿Para cuándo, mi vida? Si es para fin de semana de quincena, mejor confirmemos rápido — se llena."
  ],
  closing: [
    "Listo cariño, déjame el número de teléfono y el nombre y te envío el linkecito para confirmar con el 50% de depósito. El saldo lo cobra la mesera en la noche.",
    "Perfecto, todo anotado. ¿Me confirmas un teléfono donde te llegue WhatsApp así te mando el link de pago?",
    "Listo mi amor, le mando el link de Wompi por WhatsApp — 50% de depósito aparta la mesa, el saldo lo paga en la noche con la mesera.",
    "Cerrando: nombre completo, teléfono, y le envío el link de pago. La reserva queda cuando entra el 50%.",
    "Anotado todo, querido. Apenas confirme el depósito le mandamos la ficha del paciente para enseñarla en la puerta.",
    "Ya casi cariño — deme el nombre y celular para mandarle el link. Si el depósito no entra en 12 horas la mesa se libera, así que pendiente.",
    "Listo mi vida, voy a apuntarlo. Le aviso: el depósito es 50% y se devuelve si cancela con 48 horas de antelación.",
    "Perfecto. ¿Le mando el link por aquí mismo o le confirmo por WhatsApp al +1 903 459 8763 — usted dirá cuál le queda más a la mano?"
  ],
  // 2026-06-24 PM new bucket — fired specifically when the user's reply
  // contains a phone number (the literal Luz bug). The bot acknowledges and
  // tells the user a human will pick up on WhatsApp — and the widget surfaces
  // the rich handoff card alongside this reply.
  phone_captured: [
    "Listo cariño, ya quedó anotado. Te paso al WhatsApp con doña Luz para confirmarte la mesa de una — no quiero que se pierda nada por aquí.",
    "Perfecto mi amor, número anotado. Para no marearte con el chat, sigue por WhatsApp — te llega el contexto completo y te confirman la reserva.",
    "Anotado todo querido, ya casi. Mejor sigue por WhatsApp así un humano de carne y hueso te termina la reserva — el link te lleva con todo el detalle.",
    "Listo mi vida, número guardado. Ahora pásate al WhatsApp así doña Luz o Andrew te terminan de cuadrar la mesa.",
  ],
  default: [
    "Cuéntame mejor mi amor, ¿es para reservar, para preguntar por el menú, o por una ocasión especial?",
    "Disculpa, no te seguí — ¿es reservación, cumpleaños, o algo más?",
    "A ver querido, dime más — Dr. Silvio dice que las preguntas claras se contestan rápido.",
    "Espéreme tantito mi vida, no le entendí. ¿Reserva, info, o algo más específico?",
    "Mmm cariño, deme un poco más de contexto — ¿reservación, evento privado, audición, prensa, o algo distinto?",
    "Discúlpeme querido, Don Hilario me distrajo con el proyector. Repita despacito por favor — ¿en qué le ayudo?",
    "Cuénteme con calma mi amor: ¿es por admisión normal, por Cuidadores, por evento privado, o por el menú?",
    "A ver, vamos por partes — ¿qué necesita exactamente? Si es algo muy técnico mejor le paso a doña Luz."
  ]
};

// Receptionist personas — distinct from patient personas.
const NAMES = ['Hortensia']; // Andrew lock 2026-06-22: Hortensia only.
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function pickVariationWeighted(stage, localFallback) {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return pick(localFallback);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(
      `${url}/rest/v1/el_sanatorio_bot_variations?stage=eq.${encodeURIComponent(stage)}&select=id,variant,used_count&order=used_count.asc&limit=24`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ctrl.signal }
    );
    if (!res.ok) return pick(localFallback);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return pick(localFallback);
    const pool = rows.slice(0, Math.min(3, rows.length));
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen?.id != null) {
      fetch(`${url}/rest/v1/el_sanatorio_bot_variations?id=eq.${chosen.id}`, {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ used_count: (chosen.used_count || 0) + 1 })
      }).catch(() => {});
    }
    return chosen?.variant || pick(localFallback);
  } catch {
    return pick(localFallback);
  } finally {
    clearTimeout(timer);
  }
}

function newSessionId() {
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

// === Phone detection (mirror of lib/vert-sync.mjs detectPhone, kept local
//     so we can pre-decide handoff before importing) ===
const PHONE_RX = /(\+?\d[\d\s().\-]{7,15}\d)/;

// === Server-side WhatsApp handoff message builder ===
function buildWAMessage({ reason, collected, history, userText, botName }) {
  const lines = [];
  const reasonLines = {
    phone_capture: 'Hola, vengo del chat de El Sanatorio. Le dejé mi celular, prefiero que sigamos por aquí.',
    escalate_large_group: 'Hola, vengo del chat de El Sanatorio. Somos un grupo grande y necesito hablar con un humano.',
    escalate_press: 'Hola, vengo del chat de El Sanatorio. Soy de prensa.',
    escalate_complaint: 'Hola, vengo del chat de El Sanatorio. Tengo una queja para resolver.',
    escalate_b2b: 'Hola, vengo del chat de El Sanatorio. Es un tema B2B / proveedor.',
    escalate_accessibility: 'Hola, vengo del chat de El Sanatorio. Necesito coordinar accesibilidad.',
  };
  lines.push(reasonLines[reason] || reasonLines.phone_capture);
  if (collected?.name) lines.push(`Mi nombre: ${collected.name}`);
  if (collected?.phone) lines.push(`Mi celular: ${collected.phone}`);
  if (collected?.partySize) lines.push(`Somos ${collected.partySize} personas`);
  if (collected?.dateText) lines.push(`Fecha: ${collected.dateText}`);
  if (collected?.intent) lines.push(`Asunto: ${collected.intent}`);
  const tail = (history || []).slice(-3);
  if (tail.length || userText) {
    lines.push('—');
    lines.push('Esto es lo que veníamos hablando con el chat:');
    tail.forEach((m) => {
      const who = m.who === 'user' ? 'Yo' : (botName || 'Hortensia');
      lines.push(`${who}: ${String(m.text || '').slice(0, 160)}`);
    });
    if (userText) lines.push(`Yo: ${userText.slice(0, 160)}`);
  }
  return lines.join('\n');
}

// === Gemini call (REST) ===
async function callGemini({ apiKey, systemPrompt, history, userText }) {
  const model = 'gemini-1.5-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const contents = [];
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

function buildSystemPrompt(botName, vertContextLine) {
  return `Eres ${botName}, recepcionista del turno noche de El Sanatorio S.A.S. en Santa Marta, Colombia.

${vertContextLine ? vertContextLine + '\n\n' : ''}CONTEXTO DEL VENUE:
- El Sanatorio es un restaurante-bar inmersivo en el edificio histórico del antiguo Hospital del Tórax — Calle 19 #4-23, Centro Histórico, Santa Marta.
- Abrimos jueves a domingo, 6pm-medianoche. El gran lanzamiento es el jueves 30 de julio 2026.
- Tu jefe es Dr. Silvio — médico negro sonriente con bata blanca y corbatín. Siempre ocupado con los pacientes.
- Pacientes ficticios que mencionas con afecto: Don Hilario (cree que su cara proyecta a Norm Lewis), Don Bellasrio (manda mensajes Morse al puerto), Micaela (cose miembros sueltos), Don Aldo (habla con la pared), Doña Eulalia (predice mañana).
- Precio entrada estándar: $50.000 COP por persona. VIP "Director's Cut": $75.000.
- Depósito 50% para confirmar reserva, saldo en la noche.
- Programa Cuidadores Santa Marta: si vienen de a 4, 6 u 8 personas (siempre en pares) y uno es maestro/enfermera/bombero/policía/médico/militar/madre cabeza/adulto mayor 65+/discapacidad/auxiliar de salud, la entrada es 2 por 1 — pagan la mitad del grupo, entran todos. Comida y trago a precio normal. Miércoles y domingo. Carnet vigente a la entrada.

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
- Si el usuario te da un número de teléfono: agradécele, dile que ya queda anotado, y dile que un humano lo va a contactar por WhatsApp para terminar la reserva — el sistema automático le presenta el link en pantalla.
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
  // Client-collected fields (name/phone/partySize/dateText/intent) — used to
  // build a richer wa_handoff payload server-side.
  const collected = (payload && typeof payload.collected === 'object' && payload.collected) ? payload.collected : {};

  const escalation = detectEscalation(userText);

  // [vert-sync hook] — Hortensia context injection
  // 2026-06-24 PM FIX: previously this block referenced undefined `body` and
  // `req` variables (silenced by try/catch but it meant ZERO rows were ever
  // written to customer_activity / interactions). Now wired to `payload` and
  // `request` properly so Vert OS sees every Hortensia turn.
  let vertContextLine = '';
  let detectedPhone = null;
  try {
    detectedPhone = detectPhone(userText) || collected?.phone || null;
    if (detectedPhone) {
      const ctx = await lookupCustomerContext(detectedPhone);
      vertContextLine = contextLineFor(ctx, 'es');
      await syncToCustomerActivity({
        phone: detectedPhone,
        name: collected?.name || ctx?.knownName,
        language: 'es',
        isInbound: true,
        tags: ['channel:hortensia'],
      });
    }
    await recordInteraction({
      kind: 'chat_turn',
      source: 'web',
      phone: detectedPhone,
      sessionId,
      page: request.headers?.get?.('referer') || null,
      payload: { last_user_message: userText.slice(0, 500), locale: 'es', collected },
    });
  } catch { /* never block the chat reply on sync */ }

  const apiKey = env('GEMINI_API_KEY');
  let reply = null;

  if (apiKey) {
    try {
      reply = await callGemini({
        apiKey,
        systemPrompt: buildSystemPrompt(botName, vertContextLine),
        history,
        userText
      });
    } catch (err) {
      console.error('hortensia-chat gemini failed', err?.message || err);
    }
  }

  if (!reply) {
    const lower = userText.toLowerCase();
    let bucket = 'default';
    // 2026-06-24 PM FIX: phone-detection bucket goes FIRST so a phone-only
    // reply doesn't fall through to 'default' (Luz's bug).
    if (PHONE_RX.test(userText)) bucket = 'phone_captured';
    else if (/^(hola|alo|buenas|hi|hello|hey|qu[eé] tal)/i.test(lower) && history.length < 2) bucket = 'greeting';
    else if (/\b(cu[aá]ntos|cuanta|gente|personas|invitados|para\s+\d)/.test(lower)) bucket = 'party_size';
    else if (/\b(hora|noche|jueves|viernes|sabado|s[áa]bado|domingo|cuando|cu[aá]ndo)/.test(lower)) bucket = 'time';
    else if (/\b(pago|pagar|reserv|deposito|dep[óo]sito|confirmar|link)/.test(lower)) bucket = 'closing';
    reply = await pickVariationWeighted(bucket, FALLBACK_REPLIES[bucket]);
    if (escalation) {
      reply = "Ay mi amor, esto necesita que hable directamente con doña Luz o con Andrew, yo no me meto en esas cosas. Mejor te paso al WhatsApp y allí te atienden de una.";
    }
  } else if (escalation) {
    reply += "\n\nMejor le paso el WhatsApp directo así doña Luz le contesta — +1 903 459 8763.";
  }

  // === Server-side WhatsApp handoff payload ===
  // ALL ROADS END IN WHATSAPP: any time we detect a phone OR an escalation
  // pattern, ship a wa_handoff to the client so the widget can surface a card.
  let wa_handoff = null;
  if (detectedPhone || escalation) {
    const reason = escalation ? `escalate_${escalation}` : 'phone_capture';
    const message = buildWAMessage({ reason, collected: { ...collected, phone: collected.phone || detectedPhone }, history, userText, botName });
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
    escalate_reason: escalation,
    wa_handoff,
  });
};

export const config = { path: '/.netlify/functions/hortensia-chat' };
