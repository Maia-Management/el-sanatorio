/* vert-sync.mjs — el-sanatorio ↔ Vert OS bridge.
 *
 * Both projects share the SAME Supabase instance (nxgndsnxugcevwriljlv aka
 * maia-os-production), so this is direct table I/O — no HTTP webhook, no
 * shared secret needed. Vert OS owns:
 *   - customer_activity (brand, phone)  — unified contact graph
 *   - optouts (phone, brand)            — suppression list (brand=null = global)
 *   - reservations (brand, …)           — shared bookings table
 *   - interactions (brand, kind, …)     — canonical event log (see 20260623-vert-interactions.sql)
 *
 * This module reads/writes those tables on behalf of the Sanatorio site so
 * Vert's segmentation, frequency caps, nurture-cron, cross-brand CRM, ad ROI,
 * and dashboards all see Sanatorio's customer events.
 *
 * Brand identifier is hardcoded 'el_sanatorio' (matches CHECK constraint
 * on reservations.brand + interactions.brand).
 */

const BRAND = 'el_sanatorio';

function env(name) { return globalThis.Netlify?.env?.get(name) || process.env[name] || ''; }

function getCfg() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('vert-sync: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  return { url, key };
}

function authHeaders() {
  const { key } = getCfg();
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

/** Normalize a Colombia-default E.164 phone string. Returns '' if unparseable. */
export function normalizePhone(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (/^57\d{10}$/.test(s)) return '+' + s;
  if (/^3\d{9}$/.test(s)) return '+57' + s;        // CO mobile w/o country code
  if (/^1\d{10}$/.test(s)) return '+' + s;         // US/CA
  return '+' + s;
}

/** Detect an E.164 (or Colombian) phone in free text. Returns '' if none. */
export function detectPhone(text) {
  if (!text) return '';
  const m = String(text).match(/(\+?\d[\d\s().-]{7,15}\d)/);
  if (!m) return '';
  return normalizePhone(m[1]);
}

/** Best-effort geo from Netlify request headers. */
export function geoFromRequest(req) {
  if (!req || !req.headers) return {};
  const country = req.headers.get('x-country') || req.headers.get('x-nf-geo') ? null : null;
  // Netlify provides x-country (alpha-2). Also x-nf-geo (JSON) on newer runtime.
  const c2 = req.headers.get('x-country');
  let nf = null;
  try {
    const raw = req.headers.get('x-nf-geo');
    if (raw) nf = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
  } catch {}
  return {
    country: c2 || nf?.country?.code || null,
    region: nf?.subdivision?.code || null,
    city: nf?.city || null,
  };
}

/** Upsert into customer_activity. Idempotent on (brand, phone). */
export async function syncToCustomerActivity({ phone, name, language, tags, isInbound } = {}) {
  const e164 = normalizePhone(phone);
  if (!e164) return { skipped: 'no-phone' };
  const { url } = getCfg();
  const now = new Date().toISOString();
  const row = {
    brand: BRAND,
    phone: e164,
    name: name || null,
    language: language || 'es',
    updated_at: now,
    ...(isInbound ? { last_inbound_at: now } : {}),
    ...(Array.isArray(tags) && tags.length ? { tags } : {}),
  };
  try {
    const r = await fetch(
      `${url}/rest/v1/customer_activity?on_conflict=brand,phone`,
      {
        method: 'POST',
        headers: { ...authHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      }
    );
    if (!r.ok) return { error: 'upsert', detail: (await r.text()).slice(0, 200) };
    return { ok: true };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

/** Lookup contact context across ALL Maia brands for a given phone. */
export async function lookupCustomerContext(phone) {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  const { url } = getCfg();
  try {
    const r = await fetch(
      `${url}/rest/v1/customer_activity?select=brand,name,language,order_count,last_order_at,last_inbound_at,tags&phone=eq.${encodeURIComponent(e164)}&limit=20`,
      { headers: authHeaders() }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;
    const sanatorio = rows.find((r) => r.brand === BRAND) || null;
    const otherBrands = rows.filter((r) => r.brand !== BRAND);
    return {
      phone: e164,
      sanatorio,
      otherBrands,
      orderCountTotal: rows.reduce((s, r) => s + (r.order_count || 0), 0),
      knownName: rows.find((r) => r.name)?.name || null,
    };
  } catch { return null; }
}

/** True when the phone has opted out of Sanatorio (brand match OR global). */
export async function isOptedOut(phone) {
  const e164 = normalizePhone(phone);
  if (!e164) return false;
  const { url } = getCfg();
  try {
    const r = await fetch(
      `${url}/rest/v1/optouts?select=brand&phone=eq.${encodeURIComponent(e164)}&or=(brand.is.null,brand.eq.${BRAND})&limit=1`,
      { headers: authHeaders() }
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return rows.length > 0;
  } catch { return false; }
}

/** Filter a list of phone numbers, returning only those NOT opted out. */
export async function filterOptedIn(phones) {
  const list = (phones || []).map(normalizePhone).filter(Boolean);
  if (!list.length) return [];
  const { url } = getCfg();
  try {
    const r = await fetch(
      `${url}/rest/v1/optouts?select=phone&phone=in.(${list.map(encodeURIComponent).join(',')})&or=(brand.is.null,brand.eq.${BRAND})`,
      { headers: authHeaders() }
    );
    if (!r.ok) return list;
    const optedOut = new Set((await r.json()).map((r) => r.phone));
    return list.filter((p) => !optedOut.has(p));
  } catch { return list; }
}

/** Insert a reservation into the SHARED reservations table. */
export async function recordReservation({ name, phone, partySize, date, time, source, channel, zone, notes } = {}) {
  const e164 = normalizePhone(phone);
  if (!name || !partySize || !date || !time) {
    return { error: 'name/partySize/date/time required' };
  }
  const ref = 'SAN-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const { url } = getCfg();
  const row = {
    reservation_ref: ref,
    brand: BRAND,
    zone: zone || null,
    source: source || 'web',
    channel: channel || 'el_sanatorio_lp',
    status: 'pending',
    customer_name: name,
    customer_phone: e164 || null,
    party_size: partySize,
    reservation_date: date,
    reservation_time: time,
    notes: notes || null,
  };
  try {
    const r = await fetch(`${url}/rest/v1/reservations`, {
      method: 'POST',
      headers: { ...authHeaders(), Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!r.ok) return { error: 'insert', detail: (await r.text()).slice(0, 200) };
    const [created] = await r.json();
    return { ok: true, ref, id: created?.id };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

/** Append to the canonical Vert interactions event log. Fire-and-forget. */
export async function recordInteraction({
  kind,
  source = 'web',
  phone,
  sessionId,
  page,
  geo,                  // { country, region, city }
  utm,                  // { utm_source, utm_medium, utm_campaign, utm_term, utm_content, fbclid, gclid }
  amount_cop,
  payload,
} = {}) {
  if (!kind) return { error: 'kind required' };
  const { url } = getCfg();
  const e164 = phone ? normalizePhone(phone) : null;
  const u = utm || {};
  const g = geo || {};
  const row = {
    brand: BRAND,
    kind,
    source,
    phone: e164 || null,
    session_id: sessionId || null,
    page: page || null,
    country: g.country || null,
    region: g.region || null,
    city: g.city || null,
    utm_source: u.utm_source || null,
    utm_medium: u.utm_medium || null,
    utm_campaign: u.utm_campaign || null,
    utm_term: u.utm_term || null,
    utm_content: u.utm_content || null,
    fbclid: u.fbclid || null,
    gclid: u.gclid || null,
    amount_cop: amount_cop == null ? null : Number(amount_cop),
    payload: payload || {},
  };
  try {
    const r = await fetch(`${url}/rest/v1/interactions`, {
      method: 'POST',
      headers: { ...authHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!r.ok) return { error: 'insert', detail: (await r.text()).slice(0, 200) };
    return { ok: true };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

/** Build a short Hortensia-prompt context line from a customer context object. */
export function contextLineFor(context, locale = 'es') {
  if (!context) return '';
  const en = locale.startsWith('en');
  const s = context.sanatorio;
  const total = context.orderCountTotal || 0;
  const parts = [];
  if (context.knownName) parts.push(en ? `Returning guest: ${context.knownName}` : `Cliente conocido: ${context.knownName}`);
  if (s?.last_order_at) parts.push(en ? `Last visit ${String(s.last_order_at).slice(0,10)}` : `Última visita ${String(s.last_order_at).slice(0,10)}`);
  if (s?.order_count) parts.push(en ? `${s.order_count} previous visits to Sanatorio` : `${s.order_count} visitas previas al Sanatorio`);
  if (context.otherBrands?.length) {
    const list = context.otherBrands.map((b) => b.brand).join(', ');
    parts.push(en ? `Also a customer at: ${list}` : `También cliente en: ${list}`);
  }
  if (s?.tags?.length) parts.push((en ? 'Tags: ' : 'Etiquetas: ') + s.tags.join(', '));
  return parts.length
    ? (en ? `[Vert context — ${parts.join(' · ')}]` : `[Contexto Vert — ${parts.join(' · ')}]`)
    : '';
}
